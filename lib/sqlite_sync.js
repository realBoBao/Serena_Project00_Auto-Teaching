/**
 * lib/sqlite_sync.js — Synchronous SQLite wrapper using node-sqlite3-wasm
 *
 * Drop-in replacement for the sqlite3 module's sync API.
 * Uses node-sqlite3-wasm (pure WASM, no native compilation needed).
 *
 * This module exists solely to support legacy code that uses the sync
 * sqlite3 API (db.run(), db.get(), db.all(), db.exec()).
 *
 * New code should use the async 'sqlite' package + open() instead.
 */

import sqlite3wasm from 'node-sqlite3-wasm';

const { Database: WasmDb } = sqlite3wasm;

/** Cache of open databases by path */
const _dbCache = new Map();

/**
 * Mimics sqlite3's verbose().Database class (sync API).
 */
class SyncDatabase {
  constructor(filename) {
    this._filename = filename;
    this._db = null;

    try {
      if (!_dbCache.has(filename)) {
        const db = new WasmDb(filename);
        _dbCache.set(filename, db);
      }
      this._db = _dbCache.get(filename);
    } catch {
      // DB unavailable
    }
  }

  run(sql, params = []) {
    if (!this._db) return this;
    try {
      if (params.length > 0) {
        this._db.run(sql, params);
      } else {
        this._db.run(sql);
      }
    } catch { /* ignore */ }
    return this;
  }

  get(sql, params = []) {
    if (!this._db) return null;
    try {
      return this._db.get(sql, params) || null;
    } catch { return null; }
  }

  all(sql, params = []) {
    if (!this._db) return [];
    try {
      return this._db.all(sql, params) || [];
    } catch { return []; }
  }

  exec(sql) {
    if (!this._db) return;
    try { this._db.exec(sql); } catch { /* ignore */ }
  }

  close() {
    // Don't actually close — shared cache
    this._db = null;
  }
}

// Export in the same shape as sqlite3
const sqlite3api = {
  verbose: () => sqlite3api,
  Database: SyncDatabase,
};
export default sqlite3api;
