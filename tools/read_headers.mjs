#!/usr/bin/env node
/**
 * tools/read_headers.mjs — Đọc header comment của lib files
 * Chạy: node tools/read_headers.mjs [file1] [file2] ...
 * Ví dụ: node tools/read_headers.mjs backoff chunking circuit_breaker
 * Nếu không có args: đọc tất cả lib files
 */
import fs from 'fs';

const args = process.argv.slice(2);
const libDir = './lib';

let files;
if (args.length > 0) {
  files = args;
} else {
  files = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
}

for (const f of files) {
  console.log(`\n=== ${f}.js ===`);
  try {
    const content = fs.readFileSync(`${libDir}/${f}.js`, 'utf8');
    const lines = content.split('\n').slice(0, 20);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('/**') || trimmed.startsWith('//')) {
        console.log('  ' + trimmed);
      }
    }
  } catch (e) {
    console.log('  ERROR: ' + e.message);
  }
}
