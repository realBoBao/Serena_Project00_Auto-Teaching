/**
 * scripts/job_scraper.js — Job News Scraper v2
 *
 * Tổng hợp jobs từ nhiều nguồn:
 * 1. SimplifyJobs/Summer20XX-Internships (GitHub)
 * 2. Hacker News "Who is Hiring" (monthly thread)
 * 3. Greenhouse API (public, no auth)
 * 4. Lever API (public, no auth)
 *
 * Link validation: check HTTP status trước khi gửi webhook.
 *
 * Usage:
 *   node scripts/job_scraper.js           — normal run
 *   node scripts/job_scraper.js --reset   — clear cache, re-alert all new jobs
 * Cron: mỗi 6h
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';

const JOB_WEBHOOK = process.env.JOB_WEBHOOK_URL || '';
const DB_PATH = './data.db';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const HEADERS = { 'User-Agent': 'Serena/1.0' };
if (GITHUB_TOKEN) HEADERS['Authorization'] = `token ${GITHUB_TOKEN}`;

const KEYWORDS = /backend|software engineer|swe|devops|fullstack|full.stack|data engineer|ml engineer|ai engineer|node\.js|python|golang|rust/i;

// ── Freshness filter: chỉ giữ jobs updated trong N ngày ──
const FRESHNESS_DAYS = 14;
const FRESHNESS_MS = FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

// ── Link Validation ────────────────────────────────────────────────────────

async function validateLink(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Serena/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return res.ok || res.status === 301 || res.status === 302;
  } catch {
    return false;
  }
}

// ── 1. SimplifyJobs (GitHub) ────────────────────────────────────────────────

async function findLatestRepo() {
  const res = await fetch('https://api.github.com/orgs/SimplifyJobs/repos?per_page=50', { HEADERS });
  const repos = await res.json();
  if (!Array.isArray(repos)) throw new Error(JSON.stringify(repos).slice(0, 200));

  const matches = repos
    .filter(r => /^Summer20\d\d-Internships$/i.test(r.name))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return matches[0]?.full_name;
}

async function fetchSimplifyJobs(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/.github/scripts/listings.json`, { HEADERS });
  const info = await res.json();
  if (!info.download_url) throw new Error('No download_url');

  const raw = await fetch(info.download_url);
  const listings = JSON.parse(await raw.text());

  const now = Date.now();
  return listings
    .filter(j => {
      if (!j.active || !j.is_visible) return false;
      if (!KEYWORDS.test(j.title)) return false;
      // Filter gần hết hạn: chỉ giữ jobs updated trong FRESHNESS_DAYS
      if (j.date_updated) {
        const updatedMs = j.date_updated * 1000; // Unix timestamp → ms
        if (now - updatedMs > FRESHNESS_MS) return false;
      }
      return true;
    })
    .map(j => ({
      id: `simplify:${j.id}`,
      company_name: j.company_name,
      title: j.title,
      url: j.url,
      locations: j.locations || [],
      source: 'SimplifyJobs',
    }));
}

// ── 2. Hacker News "Who is Hiring" ─────────────────────────────────────────

async function fetchHNHiring() {
  try {
    const searchRes = await fetch(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=ask_hn&hitsPerPage=1'
    );
    const search = await searchRes.json();
    const threadId = search.hits[0]?.objectID;
    if (!threadId) return [];

    const threadRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    const thread = await threadRes.json();
    if (!thread?.kids?.length) return [];

    const commentIds = thread.kids.slice(0, 30);
    const comments = await Promise.allSettled(
      commentIds.map(id =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
      )
    );

    return comments
      .filter(c => c.status === 'fulfilled' && c.value?.text)
      .map(c => c.value)
      .filter(j => {
        const text = j.text.toLowerCase();
        return (text.includes('backend') || text.includes('software') ||
                text.includes('devops') || text.includes('fullstack') ||
                text.includes('node') || text.includes('python')) &&
               (text.includes('hiring') || text.includes('intern') || text.includes('remote'));
      })
      .map(j => {
        const text = j.text.replace(/<[^>]+>/g, '').trim();
        const companyMatch = text.match(/^([^|,\n]+)/);
        const company = companyMatch ? companyMatch[1].trim().slice(0, 50) : 'HN Company';
        return {
          id: `hn:${j.id}`,
          company_name: company,
          title: text.slice(0, 120),
          url: `https://news.ycombinator.com/item?id=${j.id}`,
          locations: [],
          source: 'HN Hiring',
        };
      });
  } catch (err) {
    console.warn('[JobScraper] HN fetch failed:', err.message);
    return [];
  }
}

// ── 3. Greenhouse API (public) ──────────────────────────────────────────────

const GREENHOUSE_COMPANIES = [
  'stripe', 'airbnb', 'dropbox', 'figma', 'notion', 'vercel',
  'supabase', 'planetscale', 'railway', 'render', 'flyio',
];

async function fetchGreenhouseJobs() {
  const allJobs = [];

  for (const company of GREENHOUSE_COMPANIES) {
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
        { headers: { 'User-Agent': 'Serena/1.0' } }
      );
      if (!res.ok) continue;

      const data = await res.json();
      const jobs = (data.jobs || [])
        .filter(j => KEYWORDS.test(j.title))
        .map(j => ({
          id: `greenhouse:${company}:${j.id}`,
          company_name: company.charAt(0).toUpperCase() + company.slice(1),
          title: j.title,
          url: j.absolute_url,
          locations: j.locations?.map(l => l.name) || [],
          source: 'Greenhouse',
        }));

      allJobs.push(...jobs);
    } catch { /* skip failed company */ }
  }

  return allJobs;
}

// ── 4. Lever API (public) ───────────────────────────────────────────────────

const LEVER_COMPANIES = [
  'netflix', 'uber', 'lyft', 'square', 'shopify', 'twilio',
  'datadog', 'snowflake', 'mongodb', 'elastic', 'grafana',
];

async function fetchLeverJobs() {
  const allJobs = [];

  for (const company of LEVER_COMPANIES) {
    try {
      const res = await fetch(
        `https://api.lever.co/v0/postings/${company}?mode=json`,
        { headers: { 'User-Agent': 'Serena/1.0' } }
      );
      if (!res.ok) continue;

      const jobs = await res.json();
      const filtered = (Array.isArray(jobs) ? jobs : [])
        .filter(j => KEYWORDS.test(j.text || j.title || ''))
        .map(j => ({
          id: `lever:${company}:${j.id || j.createdAt}`,
          company_name: company.charAt(0).toUpperCase() + company.slice(1),
          title: (j.text || j.title || '').slice(0, 100),
          url: j.hostedUrl || j.applyUrl || `https://jobs.lever.co/${company}`,
          locations: j.categories?.location ? [j.categories.location] : [],
          source: 'Lever',
        }));

      allJobs.push(...filtered);
    } catch { /* skip failed company */ }
  }

  return allJobs;
}

// ── Discord Webhook ────────────────────────────────────────────────────────

async function sendWebhook(payload) {
  if (!JOB_WEBHOOK) { console.log('[JobScraper] JOB_WEBHOOK_URL not set'); return false; }
  const res = await fetch(JOB_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const resetCache = process.argv.includes('--reset');
  console.log(`[JobScraper] Starting v2${resetCache ? ' (CACHE RESET)' : ''}...`);

  try {
    // ── Fetch tất cả nguồn song song ──
    const [simplifyJobs, hnJobs, greenhouseJobs, leverJobs] = await Promise.allSettled([
      (async () => {
        const repo = await findLatestRepo();
        if (!repo) return [];
        return fetchSimplifyJobs(repo);
      })(),
      fetchHNHiring(),
      fetchGreenhouseJobs(),
      fetchLeverJobs(),
    ]);

    const allNewJobs = [
      ...(simplifyJobs.status === 'fulfilled' ? simplifyJobs.value : []),
      ...(hnJobs.status === 'fulfilled' ? hnJobs.value : []),
      ...(greenhouseJobs.status === 'fulfilled' ? greenhouseJobs.value : []),
      ...(leverJobs.status === 'fulfilled' ? leverJobs.value : []),
    ];

    console.log(`[JobScraper] Total fetched: ${allNewJobs.length} jobs`);

    // ── Reset cache nếu --reset flag ──
    if (resetCache) {
      const dbReset = new DatabaseSync(DB_PATH);
      dbReset.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
      dbReset.prepare("DELETE FROM job_cache WHERE key='seen_ids'").run();
      dbReset.close();
      console.log('[JobScraper] Cache reset — all jobs will be treated as new');
    }

    // ── So sánh với cache ──
    const db = new DatabaseSync(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
    const prev = db.prepare("SELECT value FROM job_cache WHERE key='seen_ids'").get();
    const seenIds = new Set(prev ? JSON.parse(prev.value) : []);
    db.close();

    const newJobs = allNewJobs.filter(j => !seenIds.has(j.id));
    console.log(`[JobScraper] New jobs (before validation): ${newJobs.length}`);

    // ── Validate links (chỉ check SimplifyJobs vì HN/Greenhouse/Lever thường OK) ──
    const validatedJobs = [];
    for (const job of newJobs) {
      if (job.source === 'SimplifyJobs') {
        const isValid = await validateLink(job.url);
        if (isValid) {
          validatedJobs.push(job);
        } else {
          console.log(`[JobScraper] SKIP (dead link): ${job.company_name} - ${job.title.slice(0, 50)}`);
        }
      } else {
        validatedJobs.push(job); // HN/Greenhouse/Lever không cần validate
      }
    }

    console.log(`[JobScraper] New jobs (after validation): ${validatedJobs.length}`);

    if (validatedJobs.length > 0) {
      // Group theo source
      const bySource = {};
      for (const j of validatedJobs) {
        bySource[j.source] = bySource[j.source] || [];
        bySource[j.source].push(j);
      }

      // Gửi webhook (tối đa 8 jobs)
      const lines = validatedJobs.slice(0, 8).map(j =>
        `**${j.company_name}** — ${j.title}\n📍 ${j.locations?.join(', ') || 'Remote/Various'}\n🔗 ${j.url}`
      ).join('\n\n');

      const sourceSummary = Object.entries(bySource)
        .map(([src, jobs]) => `${src}: ${jobs.length}`)
        .join(' | ');

      const ok = await sendWebhook({
        embeds: [{
          color: 0x1D9E75,
          title: `🚀 ${validatedJobs.length} việc làm mới tổng hợp!`,
          description: lines,
          footer: { text: `Nguồn: ${sourceSummary} · Nộp sớm = lợi thế` },
          timestamp: new Date().toISOString(),
        }],
      });
      console.log(`[JobScraper] Webhook sent: ${ok ? 'OK' : 'FAILED'}`);
    } else {
      console.log('[JobScraper] No new jobs to report');
    }

    // ── Update cache (lưu cả invalid IDs để không check lại) ──
    const allIds = [...seenIds, ...validatedJobs.map(j => j.id)];
    const db2 = new DatabaseSync(DB_PATH);
    db2.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
    db2.prepare("INSERT OR REPLACE INTO job_cache VALUES ('seen_ids', ?)").run(JSON.stringify(allIds));
    db2.close();

    console.log(`[JobScraper] Cache updated: ${allIds.length} total IDs`);

  } catch (err) {
    console.error('[JobScraper] Error:', err.message);
  }
}

main();
