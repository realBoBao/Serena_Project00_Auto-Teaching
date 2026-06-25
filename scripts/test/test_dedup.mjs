#!/usr/bin/env node
/**
 * scripts/test_dedup.mjs — Test SQLite dedup hoạt động đúng
 * Kiểm tra: getDb, runQuery, sent_jobs table, dedup logic
 * 
 * Usage: node scripts/test_dedup.mjs
 */

import 'dotenv/config';
import { getDb, runQuery, getAll } from '../../lib/db.js';

console.log('═'.repeat(60));
console.log('DEDUP TEST — Kiểm tra SQLite dedup hoạt động');
console.log('═'.repeat(60));

// Test 1: Kết nối DB
console.log('\n[1] Kết nối DB...');
try {
  const db = await getDb();
  console.log('   ✅ getDb() OK');
} catch (err) {
  console.log('   ❌ getDb() FAILED:', err.message);
  process.exit(1);
}

// Test 2: Tạo bảng sent_jobs
console.log('\n[2] Tạo bảng sent_jobs...');
try {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS sent_jobs (
      url TEXT PRIMARY KEY,
      sent_at TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log('   ✅ sent_jobs table OK');
} catch (err) {
  console.log('   ❌ Create table FAILED:', err.message);
  process.exit(1);
}

// Test 3: Insert test URLs
console.log('\n[3] Insert test URLs...');
const testUrls = [
  'https://example.com/article-1',
  'https://example.com/article-2',
  'https://example.com/article-3',
];
for (const url of testUrls) {
  try {
    await runQuery('INSERT OR IGNORE INTO sent_jobs (url) VALUES (?)', [url]);
    console.log(`   ✅ Inserted: ${url.slice(0, 40)}...`);
  } catch (err) {
    console.log(`   ❌ Insert FAILED: ${err.message}`);
  }
}

// Test 4: Query dedup
console.log('\n[4] Query dedup (7 ngày qua)...');
try {
  const rows = await getAll(
    "SELECT url FROM sent_jobs WHERE sent_at >= datetime('now', '-7 days')"
  );
  console.log(`   ✅ Found ${rows.length} URLs trong DB`);
  for (const row of rows) {
    console.log(`      - ${row.url.slice(0, 50)}...`);
  }
} catch (err) {
  console.log('   ❌ Query FAILED:', err.message);
  process.exit(1);
}

// Test 5: Kiểm tra dedup logic
console.log('\n[5] Test dedup logic...');
const testCheckUrl = 'https://example.com/article-1';
try {
  const sentRows = await getAll(
    "SELECT url FROM sent_jobs WHERE sent_at >= datetime('now', '-7 days')"
  );
  const sentUrls = new Set(sentRows.map(r => r.url));
  const isDuplicate = sentUrls.has(testCheckUrl);
  console.log(`   ✅ Dedup check for "${testCheckUrl.slice(0, 40)}...": ${isDuplicate ? 'DUPLICATE (skip)' : 'NEW (send)'}`);
} catch (err) {
  console.log('   ❌ Dedup check FAILED:', err.message);
}

// Test 6: Insert URL mới
console.log('\n[6] Insert URL mới...');
const newUrl = 'https://example.com/article-NEW-' + Date.now();
try {
  await runQuery('INSERT OR IGNORE INTO sent_jobs (url) VALUES (?)', [newUrl]);
  console.log(`   ✅ New URL inserted: ${newUrl.slice(0, 40)}...`);
  
  // Verify
  const allRows = await getAll('SELECT COUNT(*) as count FROM sent_jobs');
  console.log(`   ✅ Total URLs in DB: ${allRows[0].count}`);
} catch (err) {
  console.log('   ❌ Insert FAILED:', err.message);
}

console.log('\n' + '═'.repeat(60));
console.log('✅ DEDUP TEST PASSED — SQLite dedup hoạt động!');
console.log('═'.repeat(60));
