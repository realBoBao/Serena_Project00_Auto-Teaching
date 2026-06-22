import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('./vectors.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
