/**
 * scripts/job_scraper.js — Job News Scraper
 * Scrape SimplifyJobs/Summer2026-Internships mỗi 6h
 * Usage: node scripts/job_scraper.js
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';

const JOB_WEBHOOK_URL = process.env.JOB_WEBHOOK_URL || '';
const DB_PATH = './data.db';
const REPO = 'SimplifyJobs/Summer2026-Internships';

async function fetchReadme() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/README.md`, {
    headers: { 'User-Agent': 'Serena/1.0' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf8');
}

async function sendWebhook(payload) {
  if (!JOB_WEBHOOK_URL) {
    console.log('[JobScraper] JOB_WEBHOOK_URL not set');
    return false;
  }
  const res = await fetch(JOB_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

async function main() {
  console.log('[JobScraper] Starting...');

  try {
    const content = await await fetchReadme();

    // So sánh với version cũ
    const db = new DatabaseSync(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
    const prev = db.prepare("SELECT value FROM job_cache WHERE key='readme'").get();
    const prevContent = prev?.value || '';
    db.close();

    if (content === prevContent) {
      console.log('[JobScraper] No new jobs (README unchanged)');
      return;
    }

    // Parse markdown table rows
    const prevLines = new Set(prevContent.split('\n'));
    const newLines = content.split('\n').filter(l => !prevLines.has(l) && l.includes('|') && l.includes('http'));

    // Filter by keywords
    const keywords = ['backend', 'software engineer', 'swe', 'devops', 'infrastructure', 'data engineer', 'ml engineer', 'ai engineer'];
    const newJobs = newLines.filter(line => {
      const lower = line.toLowerCase();
      return keywords.some(kw => lower.includes(kw));
    }).slice(0, 5);

    if (newJobs.length > 0) {
      const ok = await sendWebhook({
        embeds: [{
          color: 0x1D9E75,
          title: `🚀 ${newJobs.length} Internship mới phù hợp!`,
          description: newJobs.join('\n'),
          footer: { text: 'SimplifyJobs · Nộp sớm = lợi thế' },
          timestamp: new Date().toISOString(),
        }],
      });
      console.log(`[JobScraper] Sent ${newJobs.length} jobs — ${ok ? 'OK' : 'FAILED'}`);
    } else {
      console.log('[JobScraper] No matching jobs found');
    }

    // Save new version
    const db2 = new DatabaseSync(DB_PATH);
    db2.exec(`CREATE TABLE IF NOT EXISTS job_cache (key TEXT PRIMARY KEY, value TEXT)`);
    db2.prepare("INSERT OR REPLACE INTO job_cache VALUES ('readme', ?)").run(content);
    db2.close();
  } catch (err) {
    console.error('[JobScraper] Error:', err.message);
  }
}

main();
