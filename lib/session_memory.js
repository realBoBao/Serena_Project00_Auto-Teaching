/**
 * lib/session_memory.js — Session context persistence giữa các Discord sessions
 *
 * Dùng node:sqlite (built-in từ Node 22.5+) — không cần native compilation.
 * Lưu lịch sử hội thoại, inject vào context LLM để Serena "nhớ" câu trước.
 * RAM overhead gần 0 — chỉ thêm 1 SQLite table.
 */

import { DatabaseSync } from 'node:sqlite';
import { getLogger } from './logger.js';
const logger = getLogger('SessionMemory');

let _db = null;

function getDb() {
  if (_db) return _db;
  try {
    _db = new DatabaseSync('./data/session_memory.db');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS session_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_session_user ON session_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_session_time ON session_history(created_at);
    `);
    return _db;
  } catch (err) {
    logger.warn('[SessionMemory] SQLite unavailable:', err.message);
    return null;
  }
}

export const SessionMemory = {
  save(userId, role, content) {
    const db = getDb();
    if (!db) return;
    try {
      db.prepare('INSERT INTO session_history (user_id, role, content) VALUES (?,?,?)')
        .run(userId, role, content.slice(0, 2000));
    } catch (err) {
      logger.warn('[SessionMemory] save error:', err.message);
    }
  },

  getRecent(userId, limit = 6) {
    const db = getDb();
    if (!db) return [];
    try {
      return db.prepare(`
        SELECT role, content FROM session_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(userId, limit).reverse();
    } catch { return []; }
  },

  cleanup() {
    const db = getDb();
    if (!db) return;
    try {
      const result = db.prepare("DELETE FROM session_history WHERE created_at < datetime('now', '-7 days')").run();
      if (result.changes > 0) {
        logger.info(`[SessionMemory] Cleaned up ${result.changes} old entries`);
      }
    } catch (err) {
      logger.warn('[SessionMemory] cleanup error:', err.message);
    }
  },
};
