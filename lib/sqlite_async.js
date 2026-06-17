/**
 * lib/sqlite_async.js — Async SQLite wrapper using node-sqlite3-wasm
 *
 * Drop-in replacement for the 'sqlite' package's open() function.
 * Uses node-sqlite3-wasm (pure WASM, no native compilation).
 *
 * Usage:
 *   import { open } from './sqlite_async.js';
 *   const db = await open({ filename: './data.db' });
 *   await db.exec('CREATE TABLE ...');
 *   const rows = await db.all('SELECT * FROM ...');
 *   await db.close();
 */

import sqlite3wasm from 'node-sqlite3-wasm';

const { Database: WasmDb } = sqlite3wasm;

/** Cache of open databases */
const _cache = new Map();

/**
 * Open a database (mimics sqlite package's open()).
 * @param {{filename: string}} opts
 * @returns {Promise<{exec, get, all, run, close}>}
 */
export async function open({ filename }) {
  if (_cache.has(filename)) return _cache.get(filename);

  const wasmDb = new WasmDb(filename);

  const db = {
    exec(sql) {
      return new Promise((resolve, reject) => {
        try { wasmDb.exec(sql); resolve(); } catch (e) { reject(e); }
      });
    },

    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        try { resolve(wasmDb.get(sql, params) || null); } catch (e) { reject(e); }
      });
    },

    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        try { resolve(wasmDb.all(sql, params) || []); } catch (e) { reject(e); }
      });
    },

    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        try { wasmDb.run(sql, params); resolve(); } catch (e) { reject(e); }
      });
    },

    close() {
      try { wasmDb.close(); } catch { /* ignore */ }
      _cache.delete(filename);
    },
  };

  _cache.set(filename, db);
  return db;
}
