/**
 * lib/lazy_knowledge.js — Lazy Knowledge Pointers (Tier 1)
 *
 * Stores only TOC/metadata from large repos (awesome-scalability, TeachYourselfCS,
 * the-book-of-secret-knowledge). Full content is fetched JIT from GitHub raw URLs
 * when user asks about a matching topic.
 *
 * This gives 100% knowledge coverage with ~50KB storage instead of embedding
 * hundreds of thousands of lines.
 *
 * @module lib/lazy_knowledge
 */
import { open } from './sqlite_adapter.js';
import path from 'path';
import { getLogger } from './logger.js';
import { scrapeUrl } from './web_scraper.js';

const logger = getLogger('LazyKnowledge');
const DB_PATH = path.resolve('./data/lazy_knowledge.db');

let _db = null;

async function getDb() {
  if (_db) return _db;
  _db = await open({ filename: DB_PATH, driver: null });
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_pointers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      topic TEXT NOT NULL,
      url TEXT,
      type TEXT DEFAULT 'heading',
      parent TEXT DEFAULT '',
      fetched_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kp_repo ON knowledge_pointers(repo);
    CREATE INDEX IF NOT EXISTS idx_kp_topic ON knowledge_pointers(topic);
  `);
  return _db;
}

/**
 * Load TOC JSON files into SQLite.
 * Run once during setup or when repos are updated.
 */
export async function loadTocFiles() {
  const db = await getDb();
  const fs = await import('fs');

  const files = [
    { repo: 'awesome-scalability', file: './data/toc_awesome_scalability.json' },
    { repo: 'TeachYourselfCS-vi', file: './data/toc_TeachYourselfCS_vi.json' },
    { repo: 'the-book-of-secret-knowledge', file: './data/toc_the_book_of_secret_knowledge.json' },
  ];

  let total = 0;
  for (const { repo, file } of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      await db.run('DELETE FROM knowledge_pointers WHERE repo = ?', repo);

      let parent = '';
      for (const entry of data) {
        if (entry.type === 'heading') {
          parent = entry.text;
          await db.run(
            'INSERT INTO knowledge_pointers (repo, topic, url, type, parent) VALUES (?, ?, ?, ?, ?)',
            repo, entry.text, null, 'heading', ''
          );
        } else if (entry.type === 'link') {
          // Convert relative GitHub links to raw URLs
          let url = entry.url;
          if (url.startsWith('#')) {
            url = `https://github.com/${repo === 'awesome-scalability' ? 'binhnguyennus/awesome-scalability' : repo === 'TeachYourselfCS-vi' ? 'htdat/TeachYourselfCS-vi' : 'trimstray/the-book-of-secret-knowledge'}#${url.slice(1)}`;
          } else if (!url.startsWith('http')) {
            url = `https://raw.githubusercontent.com/${repo === 'awesome-scalability' ? 'binhnguyennus/awesome-scalability/master' : repo === 'TeachYourselfCS-vi' ? 'htdat/TeachYourselfCS-vi/main' : 'trimstray/the-book-of-secret-knowledge/master'}/${url}`;
          }
          await db.run(
            'INSERT INTO knowledge_pointers (repo, topic, url, type, parent) VALUES (?, ?, ?, ?, ?)',
            repo, entry.text, url, 'link', parent
          );
        }
        total++;
      }
      logger.info(`[LazyKnowledge] Loaded ${data.length} entries from ${repo}`);
    } catch (err) {
      logger.warn(`[LazyKnowledge] Failed to load ${repo}: ${err.message}`);
    }
  }

  const count = await db.get('SELECT COUNT(*) as c FROM knowledge_pointers');
  logger.info(`[LazyKnowledge] Total pointers: ${count.c}`);
  return total;
}

/**
 * Search knowledge pointers by topic keyword.
 * @param {string} query — User's question/topic
 * @param {number} [limit=5]
 * @returns {Promise<Array>}
 */
export async function searchPointers(query, limit = 5) {
  try {
    const db = await getDb();
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    // Build OR query for each term
    const conditions = terms.map(() => 'LOWER(topic) LIKE ?').join(' OR ');
    const params = terms.map(t => `%${t}%`);

    return await db.all(
      `SELECT repo, topic, url, type, parent FROM knowledge_pointers
       WHERE ${conditions}
       LIMIT ?`,
      ...params, limit
    );
  } catch { return []; }
}

/**
 * JIT fetch: Get full content for a knowledge pointer.
 * Only called when user actually asks about a topic.
 * @param {object} pointer — { repo, topic, url }
 * @returns {string|null} Full markdown content
 */
export async function fetchPointerContent(pointer) {
  if (!pointer.url) return null;

  let fetchUrl = pointer.url;

  // Strip GitHub anchor fragments — raw.githubusercontent.com doesn't support them
  // Instead, fetch the full README and extract the relevant section
  const anchorIdx = fetchUrl.indexOf('#');
  const anchor = anchorIdx > -1 ? fetchUrl.slice(anchorIdx + 1) : null;
  if (anchorIdx > -1) fetchUrl = fetchUrl.slice(0, anchorIdx);

  // Convert GitHub page URLs to raw content
  if (fetchUrl.includes('github.com') && !fetchUrl.includes('raw.githubusercontent.com')) {
    fetchUrl = fetchUrl
      .replace('github.com/', 'raw.githubusercontent.com/')
      .replace('/blob/', '/')
      .replace('/tree/', '/');
  }

  // If URL points to a directory (ends with /), append README.md
  if (fetchUrl.endsWith('/')) {
    fetchUrl += 'README.md';
  }

  let content = await scrapeUrl(fetchUrl, { useCache: true, timeout: 15000 });

  // If we had an anchor, extract just that section
  if (anchor && content) {
    const lines = content.split('\n');
    const anchorLower = anchor.toLowerCase().replace(/-/g, ' ');
    let inSection = false;
    const sectionLines = [];
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].toLowerCase();
        if (text.includes(anchorLower) || anchorLower.includes(text)) {
          inSection = true;
          sectionLevel = level;
          sectionLines.push(line);
          continue;
        }
        if (inSection && level <= sectionLevel) {
          break; // Hit next section at same or higher level
        }
      }
      if (inSection) sectionLines.push(line);
    }

    if (sectionLines.length > 0) {
      content = sectionLines.join('\n').slice(0, 3000); // Limit to 3000 chars
    }
  }

  if (content) {
    const db = await getDb();
    await db.run('UPDATE knowledge_pointers SET fetched_at = datetime("now") WHERE topic = ? AND repo = ?', pointer.topic, pointer.repo);
  }
  return content;
}

/**
 * Get all repos with pointer counts.
 * @returns {Promise<Array>}
 */
export async function getRepoStats() {
  try {
    const db = await getDb();
    return await db.all('SELECT repo, COUNT(*) as count FROM knowledge_pointers GROUP BY repo');
  } catch { return []; }
}

export default { loadTocFiles, searchPointers, fetchPointerContent, getRepoStats };
