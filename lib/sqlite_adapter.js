/**
 * lib/sqlite_adapter.js — SQLite adapter using better-sqlite3
 * Works with Node.js 20+ (built-in node:sqlite requires 22.5+).
 */
import Database from 'better-sqlite3';

let _db = null;

export function getDb() {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH || './data.db';
  _db = new Database(dbPath);
  return _db;
}

export function openDb() { return getDb(); }
export function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}
export { getDb as open };

/**
 * Open a separate SQLite database file.
 * Used by memory_decay.js and other modules that need isolated DBs.
 */
export function openDbFile(dbPath) {
  return new Database(dbPath);
}
