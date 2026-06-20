/**
 * lib/health_check.js — Morning Health Check (Step 5: Automate)
 *
 * Tự động check sức khỏe hệ thống mỗi sáng.
 * Gửi Discord alert nếu có service nào fail.
 *
 * Usage: import { runHealthCheck } from './health_check.js';
 * Cron: 8AM mỗi ngày
 */

import { getLogger } from './logger.js';

const logger = getLogger('HealthCheck');

/**
 * Check từng service và trả về status.
 * @returns {{ healthy: boolean, checks: Record<string, boolean>, errors: string[] }}
 */
export async function runHealthCheck() {
  const checks = {};
  const errors = [];

  // 1. LLM check
  try {
    const { ask } = await import('./llm.js');
    const result = await ask('ping', { maxTokens: 10, timeoutMs: 5000 });
    checks.llm = result?.provider !== 'static';
    if (!checks.llm) errors.push('LLM: all providers returning static fallback');
  } catch (err) {
    checks.llm = false;
    errors.push(`LLM: ${err.message}`);
  }

  // 2. Vector DB check
  try {
    const { search } = await import('./vector_store.js');
    const { embedText } = await import('./embeddings.js');
    const emb = await embedText('test');
    await search(emb, 1);
    checks.vectorDb = true;
  } catch (err) {
    checks.vectorDb = false;
    errors.push(`VectorDB: ${err.message}`);
  }

  // 3. Discord bot check (nếu client available)
  try {
    const client = globalThis.discordClient;
    checks.discord = client?.isReady?.() ?? false;
    if (!checks.discord) errors.push('Discord: client not ready');
  } catch {
    checks.discord = false;
    errors.push('Discord: client not available');
  }

  // 4. Job scraper check (GitHub API)
  try {
    const res = await fetch('https://api.github.com/orgs/SimplifyJobs/repos?per_page=1', {
      headers: { 'User-Agent': 'Serena/1.0' },
    });
    checks.jobScraper = res.ok;
    if (!checks.jobScraper) errors.push(`JobScraper: GitHub API ${res.status}`);
  } catch (err) {
    checks.jobScraper = false;
    errors.push(`JobScraper: ${err.message}`);
  }

  const healthy = Object.values(checks).every(Boolean);

  if (!healthy) {
    logger.warn('[HealthCheck] Failed checks:', errors.join('; '));
  } else {
    logger.info('[HealthCheck] All systems healthy');
  }

  return { healthy, checks, errors };
}

/**
 * Format health check result cho Discord webhook.
 */
export function formatHealthMessage({ healthy, checks, errors }) {
  const icon = healthy ? '✅' : '⚠️';
  const lines = [
    `${icon} **Morning Health Check** — ${healthy ? 'All systems operational' : `${errors.length} issue(s) detected`}`,
    '',
    `🤖 LLM: ${checks.llm ? '🟢' : '🔴'}`,
    `🗄️ Vector DB: ${checks.vectorDb ? '🟢' : '🔴'}`,
    `💬 Discord: ${checks.discord ? '🟢' : '🔴'}`,
    `💼 Job Scraper: ${checks.jobScraper ? '🟢' : '🔴'}`,
  ];

  if (!healthy) {
    lines.push('', '**Errors:**');
    for (const err of errors.slice(0, 5)) {
      lines.push(`• ${err}`);
    }
  }

  return lines.join('\n');
}
