/**
 * lib/sqlite_adapter.js - SQLite adapter (backward compatibility)
 *
 * TIER 1: Now delegates to lib/db.js singleton.
 * This file kept for backward compatibility - new code should import from db.js.
 *
 * @module lib/sqlite_adapter
 */

// Re-export everything from db.js singleton
export { getDb, runQuery as runDb, getOne as getDbRow, getAll as getAllDbRows, closeDb, getDbPath, transaction } from './db.js';

// Legacy aliases for backward compatibility
export const openDb = getDb;
export const initDb = async () => { await getDb(); };
export const openDbFile = getDb;
export const open = getDb;

export default { getDb, runDb: runQuery, getDbRow: getOne, getAllDbRows: getAll, closeDb, getDbPath, transaction, openDb, initDb, openDbFile, open };
