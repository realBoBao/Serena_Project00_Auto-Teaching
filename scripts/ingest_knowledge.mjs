#!/usr/bin/env node
/**
 * scripts/ingest_knowledge.mjs — Nạp file .md vào Vector DB (RAG)
 * 
 * Usage:
 *   node scripts/ingest_knowledge.mjs ../free-courses-en.md
 *   node scripts/ingest_knowledge.mjs ../free-programming-books-langs.md
 */

import fs from 'fs/promises';
import path from 'path';
import { getDb, runQuery } from '../lib/db.js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/ingest_knowledge.mjs <path-to-md-file>');
  process.exit(1);
}

const absPath = path.resolve(filePath);
const fileName = path.basename(absPath, '.md');

console.log(`[Ingest] Reading ${absPath}...`);

const content = await fs.readFile(absPath, 'utf8');
const lines = content.split('\n');

// Tạo bảng knowledge_docs nếu chưa có
await runQuery(`
  CREATE TABLE IF NOT EXISTS knowledge_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    url TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    added_at TEXT DEFAULT (datetime('now'))
  )
`);

// Parse markdown thành sections
let currentTitle = fileName;
let currentContent = '';
let sectionCount = 0;

for (const line of lines) {
  // Heading level 1 hoặc 2 = section mới
  if (/^#{1,3}\s+/.test(line)) {
    // Save section trước đó
    if (currentContent.trim()) {
      await runQuery(
        'INSERT INTO knowledge_docs (source, title, content, category) VALUES (?, ?, ?, ?)',
        [fileName, currentTitle, currentContent.trim(), fileName]
      );
      sectionCount++;
    }
    currentTitle = line.replace(/^#+\s+/, '').trim();
    currentContent = '';
  } else {
    currentContent += line + '\n';
  }
}

// Save section cuối cùng
if (currentContent.trim()) {
  await runQuery(
    'INSERT INTO knowledge_docs (source, title, content, category) VALUES (?, ?, ?, ?)',
    [fileName, currentTitle, currentContent.trim(), fileName]
  );
  sectionCount++;
}

console.log(`[Ingest] Done! Inserted ${sectionCount} sections from ${fileName}`);

// Verify
const { getAll } = await import('../lib/db.js');
const docs = await getAll('SELECT COUNT(*) as count FROM knowledge_docs WHERE source = ?', [fileName]);
console.log(`[Ingest] Total docs in DB: ${docs[0].count}`);
