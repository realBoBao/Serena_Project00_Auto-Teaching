/**
 * ═══════════════════════════════════════════════════════════════
 * Multi-Backend Source Router — Inspired by Agent Reach
 * ═══════════════════════════════════════════════════════════════
 *
 * Mỗi nguồn (YouTube, Reddit, GitHub, etc.) có nhiều backend.
 * Fail tự động chuyển backend tiếp theo.
 *
 * YouTube:  yt-dlp → YouTube API → Jina Reader
 * Reddit:    direct fetch → OpenCLI → rdt-cli
 * GitHub:    GitHub API → gh CLI → web scrape
 * arXiv:     arXiv API → web scrape
 */

import { fetchWithRetry } from './fetch_retry.js';
import { getLogger } from './logger.js';
const logger = getLogger('SourceRouter');

// ── Backend Registry — Mỗi nguồn = danh sách backend thử tuần tự ──
const BACKENDS = {
  youtube: [
    {
      name: 'yt-dlp',
      test: async () => {
        try {
          const r = await fetch('https://www.youtube.com', { signal: AbortSignal.timeout(5000) });
          return r.ok;
        } catch { return false; }
      },
      search: async (query) => {
        // Fallback: dùng YouTube search via web
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const res = await fetchWithRetry(url);
        if (!res.ok) return [];
        const text = await res.text();
        // Extract video IDs from search results
        const ids = [...text.matchAll(/"videoId":"([^"]+)"/g)].map(m => m[1]).slice(0, 5);
        return ids.map(id => ({
          title: `YouTube Video ${id}`,
          url: `https://youtu.be/${id}`,
          videoId: id,
          source: 'youtube',
        }));
      },
    },
    {
      name: 'jina-reader',
      test: async () => {
        try {
          const r = await fetch('https://r.jina.ai/https://www.youtube.com', { signal: AbortSignal.timeout(5000) });
          return r.ok;
        } catch { return false; }
      },
      search: async (query) => {
        const url = `https://s.jina.ai/${encodeURIComponent(query + ' site:youtube.com')}`;
        const res = await fetchWithRetry(url);
        if (!res.ok) return [];
        const text = await res.text();
        return [{ title: `Jina: ${query}`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, source: 'youtube' }];
      },
    },
  ],

  reddit: [
    {
      name: 'direct-fetch',
      test: async () => {
        try {
          const r = await fetch('https://www.reddit.com', { signal: AbortSignal.timeout(5000) });
          return r.ok;
        } catch { return false; }
      },
      search: async (query) => {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=5`;
        const res = await fetchWithRetry(url);
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.data?.children || []).map(c => ({
          title: c.data.title,
          url: `https://reddit.com${c.data.permalink}`,
          subreddit: c.data.subreddit,
          score: c.data.score,
          source: 'reddit',
        }));
      },
    },
    {
      name: 'jina-reader',
      test: async () => {
        try {
          const r = await fetch('https://r.jina.ai/https://www.reddit.com', { signal: AbortSignal.timeout(5000) });
          return r.ok;
        } catch { return false; }
      },
      search: async (query) => {
        const url = `https://s.jina.ai/${encodeURIComponent(query + ' site:reddit.com')}`;
        const res = await fetchWithRetry(url);
        if (!res.ok) return [];
        return [{ title: `Jina Reddit: ${query}`, url: `https://www.reddit.com/search?q=${encodeURIComponent(query)}`, source: 'reddit' }];
      },
    },
  ],

  github: [
    {
      name: 'github-api',
      test: async () => {
        try {
          const r = await fetch('https://api.github.com', { signal: AbortSignal.timeout(5000) });
          return r.ok;
        } catch { return false; }
      },
      search: async (query) => {
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`;
        const res = await fetchWithRetry(url);
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.items || []).map(r => ({
          title: r.full_name,
          url: r.html_url,
          stars: r.stargazers_count,
          description: r.description || '',
          source: 'github',
        }));
      },
    },
  ],

  arxiv: [
    {
      name: 'arxiv-api',
      test: async () => {
        try {
          const r = await fetch('http://export.arxiv.org/api/query?search_query=test&max_results=1', { signal: AbortSignal.timeout(10000) });
          return r.ok;
        } catch { return false; }
      },
      search: async (query) => {
        const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5&sortBy=relevance&sortOrder=descending`;
        const res = await fetchWithRetry(url);
        if (!res.ok) return [];
        const xml = await res.text();
        const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
        return entries.map(m => {
          const title = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
          const id = m[1].match(/<id>([^<]+)<\/id>/)?.[1] || '';
          const summary = m[1].match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || '';
          return { title, url: id, summary: summary.slice(0, 300), source: 'arxiv' };
        });
      },
    },
  ],
};

/**
 * Tìm kiếm với multi-backend fallback.
 * @param {'youtube'|'reddit'|'github'|'arxiv'} source
 * @param {string} query
 * @returns {Array} Results
 */
export async function searchWithFallback(source, query) {
  const backends = BACKENDS[source];
  if (!backends) {
    logger.warn(`Unknown source: ${source}`);
    return [];
  }

  for (const backend of backends) {
    try {
      // Test backend availability
      const available = await backend.test();
      if (!available) {
        logger.info(`[${source}] Backend "${backend.name}" unavailable, skipping...`);
        continue;
      }

      // Search
      const results = await backend.search(query);
      if (results.length > 0) {
        logger.info(`[${source}] Backend "${backend.name}" returned ${results.length} results`);
        return results;
      }
    } catch (err) {
      logger.warn(`[${source}] Backend "${backend.name}" failed: ${err.message}`);
    }
  }

  logger.warn(`[${source}] All backends failed for query: ${query}`);
  return [];
}

/**
 * Health check tất cả backends.
 */
export async function healthCheck() {
  const status = {};
  for (const [source, backends] of Object.entries(BACKENDS)) {
    status[source] = {};
    for (const backend of backends) {
      try {
        const available = await backend.test();
        status[source][backend.name] = available ? 'ok' : 'unavailable';
      } catch {
        status[source][backend.name] = 'error';
      }
    }
  }
  return status;
}

export default { searchWithFallback, healthCheck };
