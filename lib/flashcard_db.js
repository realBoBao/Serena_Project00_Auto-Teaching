import { getDb, openDb } from './sqlite_adapter.js';
import { fsrsSchedule, booleanToRating } from './fsrs.js';
import { onFlashcardReview } from './gap_router.js';

export const SPACED_INTERVALS = [1, 3, 7, 14, 30, 60, 180];

function runSql(db, sql, params) {
  if (params !== undefined) return db.prepare(sql).run(params);
  return db.prepare(sql).run();
}

let _schemaReady = false;

async function ensureSchema() {
  if (_schemaReady) return;
  const db = await getDb();
  if (!db) throw new Error('DB not initialized. Call openDb() first.');
  runSql(db, `CREATE TABLE IF NOT EXISTS flashcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source TEXT,
    category TEXT DEFAULT 'general',
    difficulty INTEGER DEFAULT 1,
    next_review TEXT,
    review_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    fsrs_state TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  runSql(db, `CREATE INDEX IF NOT EXISTS idx_next_review ON flashcards(next_review)`);
  runSql(db, `CREATE INDEX IF NOT EXISTS idx_category ON flashcards(category)`);
  _schemaReady = true;
}

async function _getFlashDb() {
  await ensureSchema();
  return openDb();
}

export async function closeDb() {}

export async function addFlashcard(question, answer, source = 'general', category = 'general') {
  // Handle both positional args and object arg
  let q = question, a = answer, s = source, c = category;
  if (question && typeof question === 'object' && !Array.isArray(question)) {
    q = question.question;
    a = question.answer;
    s = question.source || 'general';
    c = question.category || 'general';
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO flashcards (question, answer, source, category, difficulty, next_review, review_count, correct_count, created_at, updated_at) VALUES ($q, $a, $s, $c, $d, $nr, $rc, $cc, $ca, $ua)'
  ).run({ $q: q, $a: a, $s: s, $c: c, $d: 1, $nr: now, $rc: 0, $cc: 0, $ca: now, $ua: now });
  onFlashcardReview(c);
  return Number(result?.lastInsertRowid) || undefined;
}

export async function getCards(category = null) {
  const db = await getDb();
  if (category) return db.prepare('SELECT * FROM flashcards WHERE category = $cat ORDER BY created_at DESC').all({ $cat: category });
  return db.prepare('SELECT * FROM flashcards ORDER BY created_at DESC').all();
}

export async function getDueCards(category = null, limit = 20) {
  const db = await getDb();
  const now = new Date().toISOString();
  if (category) {
    return db.prepare("SELECT * FROM flashcards WHERE category = $cat AND (next_review IS NULL OR next_review <= $now) ORDER BY RANDOM() LIMIT $lim").all({ $cat: category, $lim: limit, $now: now });
  }
  return db.prepare("SELECT * FROM flashcards WHERE next_review IS NULL OR next_review <= $now ORDER BY RANDOM() LIMIT $lim").all({ $lim: limit, $now: now });
}

export async function getDueCount(category = null) {
  const db = await getDb();
  const now = new Date().toISOString();
  if (category) {
    const row = db.prepare("SELECT COUNT(*) as count FROM flashcards WHERE category = $cat AND (next_review IS NULL OR next_review <= $now)").get({ $cat: category, $now: now });
    return row?.count || 0;
  }
  const row = db.prepare("SELECT COUNT(*) as count FROM flashcards WHERE next_review IS NULL OR next_review <= $now").get({ $now: now });
  return row?.count || 0;
}

export async function getRecentStats(days = 7) {
  const db = await getDb();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare('SELECT category, COUNT(*) as total, SUM(correct_count) as correct, SUM(review_count) as reviews FROM flashcards WHERE updated_at >= $cutoff GROUP BY category').all({ $cutoff: cutoff }) || [];
}

export async function updateCard(id, correct, fsrsState = null) {
  const db = await getDb();
  const numId = Number(id);
  if (!numId || numId <= 0) return null;
  const card = db.prepare('SELECT * FROM flashcards WHERE id = $id').get({ $id: numId });
  if (!card) return null;
  const rating = booleanToRating(correct);
  let prevState = null;
  try { prevState = card.fsrs_state ? JSON.parse(card.fsrs_state) : null; } catch {}
  const stability = prevState?.stability || 1;
  const difficulty = prevState?.difficulty || 5;
  const elapsedDays = prevState?.elapsedDays || 0;
  const scheduling = fsrsSchedule(stability, difficulty, rating, elapsedDays);
  const nextReview = scheduling ? new Date(scheduling.due).toISOString() : new Date(Date.now() + 86400000).toISOString();
  const now2 = new Date().toISOString();
  const fsrsJson = scheduling ? JSON.stringify(scheduling) : '{}';
  db.prepare('UPDATE flashcards SET review_count = review_count + 1, correct_count = correct_count + $c, fsrs_state = $fs, next_review = $nr, updated_at = $now WHERE id = $id').run({ $c: correct ? 1 : 0, $fs: fsrsJson, $nr: nextReview, $now: now2, $id: numId });
  return {
    id: card.id,
    question: card.question,
    answer: card.answer,
    source: card.source,
    category: card.category,
    difficulty: card.difficulty,
    nextReview: nextReview,
    reviewCount: (card.review_count || 0) + 1,
    correctCount: (card.correct_count || 0) + (correct ? 1 : 0),
    fsrsState: JSON.stringify(scheduling),
    createdAt: card.created_at,
    updatedAt: now2,
  };
}

export { getDb };

export async function clearAll() {
  const db = await _getFlashDb(); // ensures schema exists
  runSql(db, 'DELETE FROM flashcards');
  return { cleared: true };
}

export async function deleteFlashcard(id) {
  const db = await getDb();
  const result = db.prepare('DELETE FROM flashcards WHERE id = $id').run({ $id: id });
  return result?.changes > 0;
}

export async function getStats() {
  const db = await getDb();
  const row = db.prepare('SELECT COUNT(*) as total, SUM(correct_count) as total_correct, SUM(review_count) as total_reviews FROM flashcards').get();
  return { total: row?.total || 0, total_correct: row?.total_correct || 0, total_reviews: row?.total_reviews || 0, due: 0 };
}

export async function getDueFlashcards(limit = 10) {
  const db = await getDb();
  const now = new Date().toISOString();
  return db.prepare('SELECT * FROM flashcards WHERE next_review <= $now LIMIT $lim').all({ $now: now, $lim: limit }) || [];
}

export async function getRandomFlashcards(limit = 5, category = null) {
  const db = await getDb();
  if (category) {
    return db.prepare('SELECT * FROM flashcards WHERE category = $cat ORDER BY RANDOM() LIMIT $lim').all({ $cat: category, $lim: limit }) || [];
  }
  return db.prepare('SELECT * FROM flashcards ORDER BY RANDOM() LIMIT $lim').all({ $lim: limit }) || [];
}

export async function reviewFlashcard(id, correct) {
  return updateCard(id, correct);
}
