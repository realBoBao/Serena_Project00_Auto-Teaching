/**
 * ═══════════════════════════════════════════════════════════════
 * Nightly Scraper — Tự động cào dữ liệu vào 2-4h sáng
 * ═══════════════════════════════════════════════════════════════
 *
 * 6 nguồn:
 * 1. arXiv papers (cs.*, stat.ML)
 * 2. StackOverflow top questions
 * 3. HackerNews top stories
 * 4. GitHub trending repos
 * 5. Reddit (r/programming, r/MachineLearning, r/devops)
 * 6. YouTube tech videos
 *
 * Luồng: Scrape → Chunk → Embed → Upsert Qdrant → Temporal KG
 *
 * Cron: 0 2 * * * (2:00 AM daily)
 */

import { fetchWithRetry } from '../lib/fetch_retry.js';
import { chunkText } from './lib/chunking.js';
import { embedText, embedTextsBatch } from './lib/embeddings.js';
import { upsertAcademic, upsertSystem, upsertDaily } from './lib/vector_collections.js';
import { getLogger } from './lib/logger.js';
import { TemporalKG } from './lib/temporal_kg.js';

const logger = getLogger('NightlyScraper');

// ── Config ──
const CONFIG = {
  arxiv: { maxResults: 10, categories: ['cs.AI', 'cs.LG', 'cs.CL', 'cs.SE', 'cs.DS'] },
  stackoverflow: { maxResults: 10, sort: 'votes' },
  hackernews: { maxResults: 10 },
  github: { maxResults: 10, minStars: 50 },
  reddit: { maxResults: 5, subreddits: ['programming', 'MachineLearning', 'devops'] },
  youtube: { maxResults: 5, query: 'software engineering tutorial' },
};

// ═══════════════════════════════════════════════════════════════
// 1. arXiv Papers
// ═══════════════════════════════════════════════════════════════
async function scrapeArxiv() {
  logger.info('[arXiv] Scraping...');
  const results = [];

  for (const cat of CONFIG.arxiv.categories) {
    try {
      const query = encodeURIComponent(`cat:${cat} AND "software" OR "engineering" OR "algorithm"`);
      const url = `http://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=3&sortBy=submittedDate&sortOrder=descending`;

      const res = await fetchWithRetry(url);
      if (!res.ok) continue;

      const xml = await res.text();
      const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

      for (const entry of entries) {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, ' ');
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().replace(/\s+/g, ' ');
        const id = entry.match(/<id>([^<]+)<\/id>/)?.[1]?.trim();

        if (title && summary) {
          results.push({
            title,
            content: summary,
            source: 'arxiv',
            url: id,
            category: cat,
          });
        }
      }
    } catch (err) {
      logger.warn(`[arXiv] ${cat} error:`, err.message);
    }
  }

  logger.info(`[arXiv] Found ${results.length} papers`);
  return results;
}

// ═══════════════════════════════════════════════════════════════
// 2. StackOverflow
// ═══════════════════════════════════════════════════════════════
async function scrapeStackOverflow() {
  logger.info('[SO] Scraping...');
  try {
    const url = `https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&tagged=javascript;python;algorithms;data-structures&site=stackoverflow&pagesize=${CONFIG.stackoverflow.maxResults}&filter=withbody`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || []).map(q => ({
      title: q.title,
      content: (q.body || '').replace(/<[^>]+>/g, '').slice(0, 2000),
      source: 'stackoverflow',
      url: q.link,
      category: 'programming',
      score: q.score,
    }));
  } catch (err) {
    logger.warn('[SO] Error:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. HackerNews
// ═══════════════════════════════════════════════════════════════
async function scrapeHackerNews() {
  logger.info('[HN] Scraping...');
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=software+engineering+OR+programming+OR+algorithm&tags=story&hitsPerPage=${CONFIG.hackernews.maxResults}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.hits || []).map(h => ({
      title: h.title,
      content: h.story_text || h.title,
      source: 'hackernews',
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      category: 'tech-news',
      points: h.points,
    }));
  } catch (err) {
    logger.warn('[HN] Error:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. GitHub Trending
// ═══════════════════════════════════════════════════════════════
async function scrapeGitHub() {
  logger.info('[GitHub] Scraping...');
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=${CONFIG.github.maxResults}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || []).map(r => ({
      title: r.full_name,
      content: `${r.description || ''}\n\nStars: ${r.stargazers_count} | Language: ${r.language || 'N/A'} | Topics: ${(r.topics || []).join(', ')}`,
      source: 'github',
      url: r.html_url,
      category: 'open-source',
    }));
  } catch (err) {
    logger.warn('[GitHub] Error:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. Reddit
// ═══════════════════════════════════════════════════════════════
async function scrapeReddit() {
  logger.info('[Reddit] Scraping...');
  const results = [];

  for (const sub of CONFIG.reddit.subredits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/hot.json?limit=${CONFIG.reddit.maxResults}`;
      const res = await fetchWithRetry(url);
      if (!res.ok) continue;

      const data = await res.json();
      const posts = data?.data?.children || [];

      for (const post of posts) {
        const p = post.data;
        results.push({
          title: p.title,
          content: p.selftext || p.title,
          source: 'reddit',
          url: `https://reddit.com${p.permalink}`,
          category: sub,
          subreddit: sub,
        });
      }
    } catch (err) {
      logger.warn(`[Reddit] r/${sub} error:`, err.message);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// 6. YouTube
// ═══════════════════════════════════════════════════════════════
async function scrapeYouTube() {
  logger.info('[YouTube] Scraping...');
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      logger.warn('[YouTube] No API key, skipping');
      return [];
    }

    const publishedAfter = new Date(Date.now() - 7 * 86400000).toISOString();
    const params = new URLSearchParams({
      part: 'snippet',
      q: CONFIG.youtube.query,
      type: 'video',
      maxResults: CONFIG.youtube.maxResults.toString(),
      order: 'viewCount',
      publishedAfter,
      key: apiKey,
    });

    const url = `https://www.googleapis.com/youtube/v3/search?${params}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || []).map(item => ({
      title: item.snippet.title,
      content: `${item.snippet.description}\n\nChannel: ${item.snippet.channelTitle}`,
      source: 'youtube',
      url: `https://youtu.be/${item.id.videoId}`,
      category: 'video',
    }));
  } catch (err) {
    logger.warn('[YouTube] Error:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Pipeline: Scrape → Chunk → Embed → Upsert
// ═══════════════════════════════════════════════════════════════
async function processAndStore(items, collection, sourceLabel) {
  if (!items.length) return { stored: 0 };

  let stored = 0;

  for (const item of items) {
    try {
      const content = item.content || item.title || '';
      if (content.length < 50) continue;

      // Chunk
      const chunks = chunkText(content, 600, 120);
      if (!chunks.length) continue;

      // Embed
      const embeddings = await embedTextsBatch(chunks);
      if (!embeddings || !embeddings.length) {
        logger.warn(`[${sourceLabel}] Embedding failed for "${item.title?.slice(0, 40)}"`);
        continue;
      }

      // Upsert to Qdrant
      const docId = `${sourceLabel}:${item.title?.slice(0, 40) || Date.now()}`;
      await upsertAcademic(docId, {
        url: item.url || '',
        project: item.category || sourceLabel,
        category: item.category || sourceLabel,
        type: 'article',
      }, chunks, embeddings);

      // Add to Temporal KG
      try {
        TemporalKG.addFact({
          sourceEntity: sourceLabel,
          targetEntity: item.title?.slice(0, 60) || 'unknown',
          relationship: 'contains_info_about',
          source: 'nightly_scraper',
          confidence: 0.7,
        });
      } catch { /* KG optional */ }

      stored++;
    } catch (err) {
      logger.warn(`[${sourceLabel}] Process error:`, err.message);
    }
  }

  return { stored };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
export async function runNightlyScraper() {
  const start = Date.now();
  logger.info('═══════════════════════════════════════════');
  logger.info('[NightlyScraper] Starting at', new Date().toISOString());
  logger.info('═══════════════════════════════════════════');

  // Scrape all sources in parallel
  const [arxiv, so, hn, github, reddit, youtube] = await Promise.all([
    scrapeArxiv(),
    scrapeStackOverflow(),
    scrapeHackerNews(),
    scrapeGitHub(),
    scrapeReddit(),
    scrapeYouTube(),
  ]);

  const allItems = [...arxiv, ...so, ...hn, ...github, ...reddit, ...youtube];
  logger.info(`[NightlyScraper] Total scraped: ${allItems.length} items`);

  // Process and store
  const result = await processAndStore(allItems, 'academic-docs', 'nightly');

  const duration = ((Date.now() - start) / 1000).toFixed(0);
  logger.info(`[NightlyScraper] Done! Stored: ${result.stored} docs in ${duration}s`);

  return {
    scraped: allItems.length,
    stored: result.stored,
    breakdown: {
      arxiv: arxiv.length,
      stackoverflow: so.length,
      hackernews: hn.length,
      github: github.length,
      reddit: reddit.length,
      youtube: youtube.length,
    },
    duration: `${duration}s`,
  };
}

// CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runNightlyScraper()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error(err); process.exit(1); });
}
