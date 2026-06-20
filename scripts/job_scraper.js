/**
 * scripts/job_scraper.js — Job News Scraper
 *
 * Tự động tìm repo Summer20XX-Internships mới nhất,
 * parse listings.json, gửi Discord webhook khi có job mới.
 *
 * Usage: node scripts/job_scraper.js
 * Cron: mỗi 6h
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';

const JOB_WEBHOOK = process.env.JOB_WEBHOOK_URL || '';
const DB_PATH = './data.db';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const HEADERS = { 'User-Agent': 'Serena/1.0' };
if (GITHUB_TOKEN) HEADERS['Authorization'] = `token ${GITHUB_TOKEN}`;

// ── Tìm repo internship mới nhất ───────────────────────────────────────────

async function findLatestRepo() {
  const res = await fetch('https://api.github.com/orgs/SimplifyJobs/repos?per_page=50', { HEADERS });
  const repos = await res.json();
  if (!Array.isArray(repos)) throw new Error(JSON.stringify(repos).slice(0, 200));

  const matches = repos
    .filter(r => /^Summer20\d\d-Internships$/i.test(r.name))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return matches[0]?.full_name; // e.g. 'SimplifyJobs/Summer2026-Internships'
}

// ── Fetch listings.json ────────────────────────────────────────────────────

async function fetchListings(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/.github/scripts/listings.json`, { HEADERS });
  const info = await res.json();
  if (!info.download_url) throw new Error('No download_url');

  const raw = await fetch(info.download_url);
  return JSON.parse(await raw.text());
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
  console.log('[JobScraper] Starting...');

  try {
    // 1. Tìm repo mới nhất
    const repo = await findLatestRepo();
    if (!repo) { console.log('[JobScraper] No internship repo found'); return; }
    console.log('[JobScraper] Repo:', repo);

    // 2. Fetch listings
    const listings = await fetchListings(repo);
    console.log(`[JobScraper] ${listings.length} total jobs`);

    // 3. So sánh với cache
    const db = new DatabaseSync(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
    const prev = db.prepare("SELECT value FROM job_cache WHERE key='seen_ids'").get();
    const seenIds = new Set(prev ? JSON.parse(prev.value) : []);
    db.close();

    // 4. Filter jobs mới + phù hợp
    const keywords = /backend|software engineer|swe|devops|fullstack|full.stack|data engineer|ml engineer|ai engineer/i;
    const newJobs = listings.filter(j =>
      j.active &&
      j.is_visible &&
      !seenIds.has(j.id) &&
      keywords.test(j.title)
    );

    console.log(`[JobScraper] ${newJobs.length} new matching jobs`);

    if (newJobs.length > 0) {
      // Gửi webhook (tối đa 5 jobs)
      const lines = newJobs.slice(0, 5).map(j =>
        `**${j.company_name}** — ${j.title}\n📍 ${j.locations?.join(', ') || 'Remote'}\n🔗 ${j.url}`
      ).join('\n\n');

      const ok = await sendWebhook({
        embeds: [{
          color: 0x1D9E75,
          title: `🚀 ${newJobs.length} Internship mới phù hợp!`,
          description: lines,
          footer: { text: `Source: ${repo} · Nộp sớm = lợi thế` },
          timestamp: new Date().toISOString(),
        }],
      });
      console.log(`[JobScraper] Webhook sent: ${ok ? 'OK' : 'FAILED'}`);
    }

    // 5. Update cache (lưu IDs đã thấy)
    const allIds = [...seenIds, ...newJobs.map(j => j.id)];
    const db2 = new DatabaseSync(DB_PATH);
    db2.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
    db2.prepare("INSERT OR REPLACE INTO job_cache VALUES ('seen_ids', ?)").run(JSON.stringify(allIds));
    db2.close();

  } catch (err) {
    console.error('[JobScraper] Error:', err.message);
  }
}

main();
