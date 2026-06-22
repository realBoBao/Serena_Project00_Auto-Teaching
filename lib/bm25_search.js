/**
 * BM25 Keyword Search Engine
 * Compatible với cả Node 20 (better-sqlite3) và Node 22+ (node:sqlite)
 */

import { getDb, runDb, getDbRow, getAllDbRows } from './sqlite_adapter.js';

const K1 = 1.5;
const B = 0.75;
let statsCache = { avgDl: 0, totalDocs: 0, dirty: true };

// ── Schema ─────────────────────────────────────────────────────────────────

async function ensureSchema(db) {
  runDb(db, 'PRAGMA journal_mode=WAL');
  runDb(db, 'PRAGMA synchronous=NORMAL');
  runDb(db, `CREATE TABLE IF NOT EXISTS bm25_docs (
    id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, chunk_index INTEGER DEFAULT 0,
    chunk_text TEXT NOT NULL, url TEXT DEFAULT '', project TEXT DEFAULT '',
    category TEXT DEFAULT 'General', metadata TEXT DEFAULT '{}',
    term_count INTEGER DEFAULT 0, added_at TEXT
  )`);
  runDb(db, `CREATE TABLE IF NOT EXISTS bm25_terms (
    term TEXT NOT NULL, doc_id TEXT NOT NULL, freq INTEGER DEFAULT 1,
    PRIMARY KEY (term, doc_id)
  ) WITHOUT ROWID`);
  runDb(db, 'CREATE INDEX IF NOT EXISTS idx_bm25_terms_term ON bm25_terms(term)');
  runDb(db, 'CREATE INDEX IF NOT EXISTS idx_bm25_docs_doc_id ON bm25_docs(doc_id)');
}

// ── Tokenize ────────────────────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

// ── Index Document ─────────────────────────────────────────────────────────

export async function indexDocument(docId, metadata, chunks) {
  const db = await getDb();
  await ensureSchema(db);

  // Remove old
  runDb(db, 'DELETE FROM bm25_docs WHERE doc_id = ?', docId);
  runDb(db, 'DELETE FROM bm25_terms WHERE doc_id = ?', docId);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const id = `${docId}::${i}`;
    const terms = tokenize(chunk);
    const termCount = terms.length;
    const now = new Date().toISOString();

    runDb(db, 'INSERT INTO bm25_docs VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, docId, i, chunk, metadata.url || '', metadata.project || '',
      metadata.category || 'General', termCount, now);

    // Insert terms
    const termFreq = {};
    for (const t of terms) termFreq[t] = (termFreq[t] || 0) + 1;
    for (const [term, freq] of Object.entries(termFreq)) {
      runDb(db, 'INSERT OR REPLACE INTO bm25_terms VALUES (?,?,?)', term, docId, freq);
    }
  }

  statsCache.dirty = true;
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function searchBm25(query, topK = 5) {
  const db = await getDb();
  await ensureSchema(db);

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Get stats
  if (statsCache.dirty) {
    const s = getDbRow(db, 'SELECT COUNT(*) as n, AVG(term_count) as avgDl FROM bm25_docs') || {};
    statsCache.totalDocs = s.n || 0;
    statsCache.avgDl = s.avgDl || 0;
    statsCache.dirty = false;
  }

  const N = statsCache.totalDocs;
  const avgDl = statsCache.avgDl || 1;

  // Score documents
  const scores = {};
  for (const term of queryTerms) {
    const dfRow = getDbRow(db, 'SELECT COUNT(DISTINCT doc_id) as df FROM bm25_terms WHERE term = ?', term);
    const df = dfRow?.df || 0;
    if (df === 0) continue;

    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    const termRows = getAllDbRows(db, 'SELECT doc_id, freq FROM bm25_terms WHERE term = ?', term);
    for (const { doc_id, freq } of termRows) {
      const docRow = getDbRow(db, 'SELECT term_count FROM bm25_docs WHERE doc_id = ? LIMIT 1', doc_id);
      const dl = docRow?.term_count || 1;
      const tf = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (dl / avgDl)));
      scores[doc_id] = (scores[doc_id] || 0) + idf * tf;
    }
  }

  // Sort by score
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a).slice(0, topK);

  // Fetch full docs
  const results = [];
  for (const [docId, score] of sorted) {
    const row = getDbRow(db, 'SELECT * FROM bm25_docs WHERE doc_id = ? LIMIT 1', docId);
    if (row) {
      results.push({
        id: row.id,
        doc_id: row.doc_id,
        chunk_text: row.chunk_text,
        url: row.url,
        project: row.project,
        category: row.category,
        score,
      });
    }
  }

  return results;
}

// ── Remove Document ─────────────────────────────────────────────────────────

export async function removeDocument(docId) {
  const db = await getDb();
  await ensureSchema(db); // ensure table exists before DELETE
  runDb(db, 'DELETE FROM bm25_docs WHERE doc_id = ?', docId);
  runDb(db, 'DELETE FROM bm25_terms WHERE doc_id LIKE ?', `${docId}::%`);
  statsCache.dirty = true;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export async function getBm25Stats() {
  const db = await getDb();
  await ensureSchema(db);
  const row = getDbRow(db, 'SELECT COUNT(DISTINCT doc_id) as docs, COUNT(*) as chunks FROM bm25_docs');
  const termRow = getDbRow(db, 'SELECT COUNT(DISTINCT term) as terms FROM bm25_terms');
  return {
    documents: row?.docs || 0,
    chunks: row?.chunks || 0,
    uniqueTerms: termRow?.terms || 0,
  };
}

export default { indexDocument, searchBm25, removeDocument, getBm25Stats };
