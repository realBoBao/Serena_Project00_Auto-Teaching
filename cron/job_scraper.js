#!/usr/bin/env node
/**
 * cron/job_scraper.js — Scrape job postings và gửi qua JOB_WEBHOOK_URL
 *
 * Nguồn: SimplifyJobs (GitHub), RemoteOK, WeWorkRemotely
 * Usage: node cron/job_scraper.js
 * Cron: 6AM + 12PM + 6PM PDT daily (via GitHub Actions)
 */

import 'dotenv/config';

const JOB_WEBHOOK = process.env.JOB_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;

if (!JOB_WEBHOOK) {
  console.error('❌ JOB_WEBHOOK_URL not set in .env');
  process.exit(1);
}

// ── Helpers ──
function stripHtml(s) { return s.replace(/<[^>]+>/g, '').trim(); }

function parseSimplifyHtml(text, limit, source) {
  const tbodyMatch = text.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];
  const rows = tbodyMatch[1].split(/<tr>/).filter(r => r.includes('<td>'));
  return rows.slice(0, limit).map(r => {
    const cells = r.split(/<td>/).filter(c => c.includes('</td>'));
    const vals = cells.map(c => {
      const end = c.indexOf('</td>');
      const html = c.slice(0, end);
      const link = html.match(/href="([^"]+)"/)?.[1] || '';
      const text = stripHtml(html);
      return { text, link };
    });
    return {
      company: vals[0]?.text || 'Unknown',
      role: vals[1]?.text || 'Unknown',
      location: vals[2]?.text || 'Remote',
      link: vals[3]?.link || '#',
      source,
    };
  }).filter(j => j.company !== 'Unknown');
}

// ── Job sources ──
async function fetchSimplifyJobs(limit = 10) {
  try {
    const res = await fetch('https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md');
    if (!res.ok) throw new Error(`SimplifyJobs ${res.status}`);
    const text = await res.text();
    return parseSimplifyHtml(text, limit, 'SimplifyJobs');
  } catch (err) {
    console.warn('[JobScraper] SimplifyJobs failed:', err.message);
    return [];
  }
}

async function fetchNewGradPositions(limit = 10) {
  try {
    const res = await fetch('https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md');
    if (!res.ok) throw new Error(`NewGradPositions ${res.status}`);
    const text = await res.text();
    return parseSimplifyHtml(text, limit, 'NewGradPositions');
  } catch (err) {
    console.warn('[JobScraper] NewGradPositions failed:', err.message);
    return [];
  }
}

async function fetchRemoteOK(limit = 10) {
  try {
    const res = await fetch('https://remoteok.com/api?tag=dev', {
      headers: { 'User-Agent': 'Serena-Brain/1.0' },
    });
    if (!res.ok) throw new Error(`RemoteOK ${res.status}`);
    const data = await res.json();
    return (data || []).slice(1, limit + 1).map(j => ({
      company: j.company || 'Unknown',
      role: j.position || 'Unknown',
      title: j.position || 'Unknown', // ← thêm để isRelevant check được
      location: j.location || 'Remote',
      link: j.url || j.apply_url || '#',
      source: 'RemoteOK',
    }));
  } catch (err) {
    console.warn('[JobScraper] RemoteOK failed:', err.message);
    return [];
  }
}

async function fetchWeWorkRemotely(limit = 10) {
  try {
    const res = await fetch('https://weworkremotely.com/remote-jobs.rss', {
      headers: { 'User-Agent': 'Serena-Brain/1.0' },
    });
    if (!res.ok) throw new Error(`WeWorkRemotely ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items.slice(0, limit).map(m => {
      const item = m[1];
      const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || 'Unknown';
      const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '#';
      const desc = item.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<[^>]+>/g, '').slice(0, 100) || '';
      return {
        company: title.split('—')[0]?.split('-')[0]?.trim() || 'Unknown',
        role: title,
        location: 'Remote',
        link,
        source: 'WeWorkRemotely',
        description: desc,
      };
    });
  } catch (err) {
    console.warn('[JobScraper] WeWorkRemotely failed:', err.message);
    return [];
  }
}

async function main() {
  console.log('[JobScraper] Fetching job postings...');

  const [simplify, newgrad, remoteok, wework] = await Promise.all([
    fetchSimplifyJobs(10),
    fetchNewGradPositions(10),
    fetchRemoteOK(10),
    fetchWeWorkRemotely(10),
  ]);

  // ── Filter: Chỉ giữ jobs phù hợp với tech profile ──
  const REQUIRED_KEYWORDS = [
    'backend', 'software engineer', 'node.js', 'javascript', 'typescript',
    'devops', 'fullstack', 'full-stack', 'python', 'cloud', 'infrastructure',
    'swe', 'intern', 'developer', 'programming', 'api', 'database',
    'kubernetes', 'docker', 'microservices', 'distributed systems',
  ];
  const EXCLUDE_KEYWORDS = [
    'store manager', 'data entry', 'paralegal', 'sales agent',
    'no experience required', 'military', 'national guard',
    'manufacturing', 'real estate', 'insurance agent', 'retail',
    'appointment setter', 'document review', 'outside sales',
    'operations roles', 'membership offers', 'assistant store',
    'financial accountant', 'account manager', 'credit card',
    'business strategy', 'oracle services', 'workday',
    'cyber', 'project scheduling', 'project assistant',
    'data analyst', 'analytics and bi', 'data warehouse',
    'msp service delivery', 'director of operations',
  ];

  function isRelevant(title = '', company = '', role = '') {
    const text = (title + ' ' + company + ' ' + role).toLowerCase();
    const hasRequired = REQUIRED_KEYWORDS.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    const hasExcluded = EXCLUDE_KEYWORDS.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    return hasRequired && !hasExcluded;
  }

  const rawJobs = [...simplify, ...newgrad, ...remoteok, ...wework];
  const filteredJobs = rawJobs.filter(j => isRelevant(j.title, j.company, j.role));

  if (filteredJobs.length < rawJobs.length) {
    console.log(`[JobScraper] Filtered: ${rawJobs.length} → ${filteredJobs.length} (removed ${rawJobs.length - filteredJobs.length} irrelevant)`);
  }

  // ── Dedup: Chống gửi trùng bằng cách đọc Lịch sử Discord (Cloud-safe) ──
  console.log(`[JobScraper] Đang kiểm tra lịch sử Discord để lọc trùng...`);
  const sentUrls = new Set();
  try {
    const webhookMatch = JOB_WEBHOOK.match(/webhooks\/(\d+)\//);
    if (webhookMatch) {
      const channelId = webhookMatch[1];
      const histRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, {
        headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      });
      if (histRes.ok) {
        const messages = await histRes.json();
        messages.forEach(msg => {
          (msg.embeds || []).forEach(embed => {
            const desc = embed.description || '';
            // Rút trích tất cả URL trong markdown [Apply](url)
            const links = [...desc.matchAll(/\[Apply\]\((https?:\/\/[^\)]+)\)/g)];
            links.forEach(match => sentUrls.add(match[1]));
          });
        });
      }
    }
  } catch (err) {
    console.warn('[JobScraper] Lỗi đọc Discord History:', err.message);
  }

  // Lọc ra những job chưa từng xuất hiện trong 100 tin nhắn gần nhất
  const dedupedJobs = filteredJobs.filter(j => !sentUrls.has(j.link || ''));

  if (dedupedJobs.length < filteredJobs.length) {
    console.log(`[JobScraper] Dedup: ${filteredJobs.length} → ${dedupedJobs.length} (removed already sent)`);
  }

  if (dedupedJobs.length === 0) {
    console.log('[JobScraper] No new jobs after filter + dedup.');
    return;
  }

  console.log(`[JobScraper] Sending ${dedupedJobs.length} relevant jobs`);

  // Build Discord embed
  const jobsByType = {};
  for (const j of dedupedJobs) {
    if (!jobsByType[j.source]) jobsByType[j.source] = [];
    jobsByType[j.source].push(j);
  }

  const summary = Object.entries(jobsByType).map(([s, jobs]) => `${s}: ${jobs.length}`).join(' | ');

  const jobLines = dedupedJobs.slice(0, 15).map((j, i) => {
    const link = j.link && j.link !== '#' ? `[Apply](${j.link})` : '';
    return `**${i + 1}.** [${j.source}] **${j.company}** — ${j.role} (${j.location}) ${link}`;
  });

  // Use PDT date for consistency
  const pdtDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const embed = {
    title: `💼 Job Alerts — ${pdtDate}`,
    description: [
      `📦 **Total Jobs:** ${dedupedJobs.length} | 📊 **By Source:** ${summary}`,
      ``,
      ...jobLines,
    ].join('\n').slice(0, 4000),
    color: 0x43b581,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(JOB_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (res.ok) {
      console.log('[JobScraper] ✅ Webhook sent successfully');
    } else {
      console.error('[JobScraper] ❌ Webhook failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[JobScraper] ❌ Webhook error:', err.message);
  }
}

main().catch(err => {
  console.error('[JobScraper] Fatal:', err.message);
});
