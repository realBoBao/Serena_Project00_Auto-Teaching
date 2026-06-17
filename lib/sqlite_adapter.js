import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let _db = null;

export async function getDb() {
  if (_db) return _db;
  _db = await open({
    filename: './data.db',
    driver: sqlite3.default.Database,
  });
  return _db;
}

export function openDb() { return getDb(); }
export function closeDb() { /* no-op */ }
export { getDb as open };
