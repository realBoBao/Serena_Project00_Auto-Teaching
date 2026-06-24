/**
 * lib/tool_reputation.js — Skill-Conditional Trust Score Registry (SQLite)
 *
 * Mỗi tool/source có trust_score riêng cho từng topic.
 * Lưu trong SQLite để survive PM2 restart.
 * Fallback in-memory nếu SQLite fail.
 *
 * @module lib/tool_reputation
 */

import { DatabaseSync } from 'node:sqlite';
import { getLogger } from './logger.js';

const logger = getLogger('ToolReputation');

let _db = null;

function getDb() {
  if (_db) return _db;
  try {
    _db = new DatabaseSync('./vectors.db');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tool_reputation (
        source TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT 'general',
        score REAL NOT NULL DEFAULT 0.5,
        verified INTEGER NOT NULL DEFAULT 0,
        contradicted INTEGER NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (source, topic)
      )
    `);
    return _db;
  } catch (err) {
    logger.warn('[ToolReputation] SQLite init failed, falling back to in-memory:', err.message);
    return null;
  }
}

const REWARD = 0.05;
const PENALTY = 0.15;

/**
 * Get trust score for source+topic.
 * @param {string} source
 * @param {string} [topic]
 * @returns {number} 0.1 – 1.0
 */
export function getTrustScore(source, topic = 'general') {
  const db = getDb();
  if (!db) return _memFallback().getTrustScore(source, topic);

  try {
    const row = db.prepare(
      'SELECT score, last_seen FROM tool_reputation WHERE source = ? AND topic = ?'
    ).get(source, topic.toLowerCase());

    if (!row) return 0.5;

    // Time decay: 0.95/day toward baseline 0.5
    const now = Date.now();
    const daysSince = (now - row.last_seen) / 86400000;
    if (daysSince > 0) {
      const decayed = 0.5 + (row.score - 0.5) * Math.pow(0.95, daysSince);
      const clamped = Math.max(0.1, Math.min(1.0, decayed));
      db.prepare('UPDATE tool_reputation SET score = ?, last_seen = ? WHERE source = ? AND topic = ?')
        .run(Math.round(clamped * 100) / 100, now, source, topic.toLowerCase());
      return Math.round(clamped * 100) / 100;
    }

    return row.score;
  } catch (err) {
    logger.debug('[ToolReputation] getTrustScore error:', err.message);
    return 0.5;
  }
}

/**
 * Record verified claim from source.
 * @param {string} source
 * @param {string} [topic]
 */
export function recordVerified(source, topic = 'general') {
  const db = getDb();
  if (!db) return _memFallback().recordVerified(source, topic);

  try {
    const t = topic.toLowerCase();
    const existing = db.prepare('SELECT score FROM tool_reputation WHERE source = ? AND topic = ?').get(source, t);
    const newScore = Math.min(1.0, (existing?.score || 0.5) + REWARD);

    db.prepare(`
      INSERT INTO tool_reputation (source, topic, score, verified, contradicted, last_seen)
      VALUES (?, ?, ?, 1, 0, ?)
      ON CONFLICT(source, topic) DO UPDATE SET score = ?, verified = verified + 1, last_seen = ?
    `).run(source, t, newScore, Date.now(), newScore, Date.now());
  } catch (err) {
    logger.debug('[ToolReputation] recordVerified error:', err.message);
  }
}

/**
 * Record contradiction from source.
 * @param {string} source
 * @param {string} [topic]
 */
export function recordContradiction(source, topic = 'general') {
  const db = getDb();
  if (!db) return _memFallback().recordContradiction(source, topic);

  try {
    const t = topic.toLowerCase();
    const existing = db.prepare('SELECT score FROM tool_reputation WHERE source = ? AND topic = ?').get(source, t);
    const newScore = Math.max(0.1, (existing?.score || 0.5) - PENALTY);

    db.prepare(`
      INSERT INTO tool_reputation (source, topic, score, verified, contradicted, last_seen)
      VALUES (?, ?, ?, 0, 1, ?)
      ON CONFLICT(source, topic) DO UPDATE SET score = ?, contradicted = contradicted + 1, last_seen = ?
    `).run(source, t, newScore, Date.now(), newScore, Date.now());
  } catch (err) {
    logger.debug('[ToolReputation] recordContradiction error:', err.message);
  }
}

/**
 * Get all scores summary.
 * @returns {Array<{source, topic, score, verified, contradicted}>}
 */
export function getAllScores() {
  const db = getDb();
  if (!db) return _memFallback().getAllScores();

  try {
    return db.prepare('SELECT source, topic, score, verified, contradicted FROM tool_reputation ORDER BY score ASC').all();
  } catch {
    return [];
  }
}

export function resetAll() {
  const db = getDb();
  if (db) {
    try { db.prepare('DELETE FROM tool_reputation').run(); } catch { /* ignore */ }
  }
  _memFallback().resetAll();
}

// ── In-memory fallback when SQLite unavailable ──
const _memStore = new Map();
function _memFallback() {
  return {
    getTrustScore(source, topic = 'general') {
      const k = `${source}:${(topic || 'general').toLowerCase()}`;
      const e = _memStore.get(k);
      if (!e) return 0.5;
      const daysSince = (Date.now() - e.lastSeen) / 86400000;
      if (daysSince > 0) {
        e.score = Math.max(0.1, Math.min(1.0, 0.5 + (e.score - 0.5) * Math.pow(0.95, daysSince)));
        e.lastSeen = Date.now();
      }
      return e.score;
    },
    recordVerified(source, topic = 'general') {
      const k = `${source}:${(topic || 'general').toLowerCase()}`;
      const e = _memStore.get(k) || { score: 0.5, verified: 0, contradicted: 0, lastSeen: Date.now() };
      e.score = Math.min(1.0, e.score + 0.05);
      e.verified++;
      e.lastSeen = Date.now();
      _memStore.set(k, e);
    },
    recordContradiction(source, topic = 'general') {
      const k = `${source}:${(topic || 'general').toLowerCase()}`;
      const e = _memStore.get(k) || { score: 0.5, verified: 0, contradicted: 0, lastSeen: Date.now() };
      e.score = Math.max(0.1, e.score - 0.15);
      e.contradicted++;
      e.lastSeen = Date.now();
      _memStore.set(k, e);
    },
    getAllScores() {
      return Array.from(_memStore.entries()).map(([k, v]) => {
        const [source, ...topicParts] = k.split(':');
        return { source, topic: topicParts.join(':'), score: v.score, verified: v.verified, contradicted: v.contradicted };
      }).sort((a, b) => a.score - b.score);
    },
    resetAll() { _memStore.clear(); },
  };
}

export default { getTrustScore, recordVerified, recordContradiction, getAllScores, resetAll };
