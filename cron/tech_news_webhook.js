#!/usr/bin/env node
/**
 * cron/tech_news_webhook.js — Lightweight tech news digest (TẬP CON của Pipeline)
 *
 * Chỉ fetch HN + Reddit + GitHub + arXiv → gửi Discord
 * Không scrape sâu, không embed, không tạo flashcard
 *
 * Usage: node cron/tech_news_webhook.js [topic]
 * Cron: 5x/day PDT (8AM, 11AM, 2PM, 5PM, 8PM)
 */

import 'dotenv/config';

const TECH_WEBHOOK = process.env.TECH_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
if (!TECH_WEBHOOK) { console.error('❌ TECH_WEBHOOK_URL not set'); process.exit(1); }

const TECH_TOPICS = [
  'artificial intelligence', 'machine learning', 'distributed systems',
  'cloud computing', 'cybersecurity', 'devops', 'microservices',
  'kubernetes', 'rust programming', 'golang', 'typescript',
  'python', 'system design', 'database optimization', 'API design',
  'networking', 'open source', 'edge computing', 'IoT',
];

// ── Dedup: file-based sent history (works on VPS + GitHub Actions) ──
const SENT_HISTORY_PATH = './data/tech_news_sent.json';

function loadSentHistory() {
  try {
    const { readFileSync } = require('fs');
    return JSON.parse(readFileSync(SENT_HISTORY_PATH, 'utf8'));
  } catch { return { topics: {}, urls: {} }; }
}

function saveSentHistory(history) {
  try {
    const { writeFileSync, mkdirSync } = require('fs');
    mkdirSync('./data', { recursive: true });
    writeFileSync(SENT_HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch { /* ignore */ }
}

function isTopicSentToday(topic) {
  const history = loadSentHistory();
  const today = new Date().toISOString().slice(0, 10);
  return history.topics[topic] === today;
}

function recordSentTopic(topic, urls) {
  const history = loadSentHistory();
  const today = new Date().toISOString().slice(0, 10);
  history.topics[topic] = today;
  for (const url of urls) {
    if (url) history.urls[url] = today;
  }
  // Prune: chỉ giữ 7 ngày gần nhất
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(history.topics)) { if (history.topics[k] < cutoff) delete history.topics[k]; }
  for (const k of Object.keys(history.urls)) { if (history.urls[k] < cutoff) delete history.urls[k]; }
  saveSentHistory(history);
}

// ── Crawlee scraper (shared instance, MemoryStorage only) ──
async function getCrawler() {
  const { CheerioCrawler, Configuration, MemoryStorage } = await import('crawlee');
  const config = new Configuration({
    storageClient: new MemoryStorage(),
    purgeOnStart: true,
  });
  return new CheerioCrawler({
    maxConcurrency: 5,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 30,
    preNavigationHooks: [
      ({ request }) => {
        request.headers = {
          ...request.headers,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        };
      },
    ],
  }, config);
}

async function fetchHN(query, limit = 10) {
  try {
    // HN Algolia API — dùng fetch cho nhanh (JSON endpoint)
    const r = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.hits || []).map(h => ({ title: h.title || 'Untitled', url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, pts: h.points || 0 }));
  } catch { return []; }
}

async function fetchReddit(query, limit = 10) {
  try {
    // Reddit JSON API — dùng Crawlee để có retry + rate-limit
    const crawler = await getCrawler();
    const results = [];

    crawler.requestHandler = async ({ $, request, body }) => {
      try {
        const json = typeof body === 'string' ? JSON.parse(body) : body;
        const children = json?.data?.children || [];
        for (const c of children) {
          if (c.data && !c.data.stickied) {
            results.push({
              title: c.data.title || 'Untitled',
              url: `https://reddit.com${c.data.permalink || ''}`,
              pts: c.data.score || 0,
            });
          }
        }
      } catch { /* skip */ }
    };

    await crawler.run([`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=week&limit=${limit}`]);
    return results.slice(0, limit);
  } catch { return []; }
}

async function fetchGitHub(query, limit = 10) {
  try {
    // GitHub API — fetch là đủ (JSON, có rate-limit header rõ ràng)
    const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+created:>2024-01-01&sort=stars&order=desc&per_page=${limit}`, {
      headers: { 'User-Agent': 'Serena-Brain/1.0', 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.items || []).slice(0, limit).map(r => ({ title: r.full_name || 'Untitled', url: r.html_url || '', pts: r.stargazers_count || 0 }));
  } catch { return []; }
}

async function fetchArXiv(query, limit = 5) {
  try {
    // ArXiv API — fetch là đủ (XML đơn giản)
    const r = await fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`);
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => ({
      title: m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, ' ') || 'Untitled',
      url: m[1].match(/<id>([^<]+)<\/id>/)?.[1] || '',
      pts: 0,
    }));
  } catch { return []; }
}

function pickRandomTopic() {
  return TECH_TOPICS[Math.floor(Math.random() * TECH_TOPICS.length)];
}

async function main() {
  const topic = process.argv[2] || pickRandomTopic();

  if (isTopicSentToday(topic)) {
    console.log(`[TechNews] Already sent "${topic}" today — skip`);
    return;
  }

  console.log(`[TechNews] Fetching: "${topic}"`);

  const [hn, reddit, github, arxiv] = await Promise.all([
    fetchHN(topic, 10), fetchReddit(topic, 10), fetchGitHub(topic, 10), fetchArXiv(topic, 5),
  ]);

  let all = [
    ...hn.map(n => ({ ...n, src: 'HN', score: Math.min(1, n.pts / 500) })),
    ...reddit.map(n => ({ ...n, src: 'Reddit', score: Math.min(1, n.pts / 200) })),
    ...github.map(n => ({ ...n, src: 'GitHub', score: Math.min(1, n.pts / 1000) })),
    ...arxiv.map(n => ({ ...n, src: 'arXiv', score: 0.75 })),
  ];

  // ── Intra-run URL dedup (same URL from multiple sources) ──
  const seenUrls = new Set();
  all = all.filter(n => {
    if (!n.url || seenUrls.has(n.url)) return false;
    seenUrls.add(n.url);
    return true;
  });

  // ── Inter-run URL dedup via sent history ──
  const history = loadSentHistory();
  const sentUrls = new Set(Object.keys(history.urls));
  if (sentUrls.size > 0) {
    const before = all.length;
    all = all.filter(n => !sentUrls.has(n.url));
    if (all.length < before) {
      console.log(`[TechNews] Dedup: ${before} → ${all.length} (removed ${before - all.length} previously sent)`);
    }
  }

  // Nếu không còn gì mới → skip, không gửi trùng
  if (!all.length) {
    console.log('[TechNews] No new sources today — skip (no duplicate send)');
    return;
  }
  all.sort((a, b) => b.score - a.score);

  const lines = all.slice(0, 15).map((n, i) => {
    const bar = '█'.repeat(Math.round(n.score * 10)) + '░'.repeat(10 - Math.round(n.score * 10));
    return `**${i + 1}.** [${n.src}] [${n.title.slice(0, 60)}](${n.url})\n   📊 ${n.score.toFixed(2)} ${bar}`;
  });

  const types = {};
  for (const n of all) types[n.src] = (types[n.src] || 0) + 1;

  // Use PDT date for consistency with other embeds
  const pdtDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const embed = {
    title: `📰 Tech News: "${topic}" — ${pdtDate}`,
    description: [
      `📦 **Total:** ${all.length} | 📊 **By Type:** ${Object.entries(types).map(([t, c]) => `${t}: ${c}`).join(' | ')}`,
      '', ...lines,
    ].join('\n').slice(0, 4000),
    color: 0x00aa55,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(TECH_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) });
    if (res.ok) {
      console.log(`[TechNews] ✅ Sent ${all.length} items`);
      // Record sent topic + URLs để lần sau không trùng
      recordSentTopic(topic, all.map(n => n.url));
    } else {
      console.error('[TechNews] ❌ Failed:', res.status);
    }
  } catch (err) { console.error('[TechNews] ❌ Error:', err.message); }
}

main().catch(e => { console.error('[TechNews] Fatal:', e.message); process.exit(1); });
