#!/usr/bin/env node
/**
 * tools/scan_imports.mjs — Scan lib/ import usage across codebase
 * Chạy: node tools/scan_imports.mjs
 * Output: danh sách lib files được import + không được import
 */
import fs from 'fs';
import path from 'path';

const libDir = './lib';
const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));

const allFiles = [];
for (const d of ['./lib', './cron', './agents', './tests']) {
  if (fs.existsSync(d)) {
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.js')) allFiles.push(d + '/' + f);
    }
  }
}

const ic = {};
for (const lib of libFiles) ic[lib] = 0;

for (const fp of allFiles) {
  const c = fs.readFileSync(fp, 'utf8');
  const re = /from\s+['"][^'"]*?\/([^'"]+?)['"]/g;
  let m;
  while ((m = re.exec(c))) {
    const i = m[1].replace('.js', '').split('/').pop();
    if (ic[i] !== undefined) ic[i]++;
  }
}

const s = Object.entries(ic).sort((a, b) => b[1] - a[1]);
console.log('=== USED (imported) ===');
let used = 0;
for (const [n, c] of s) {
  if (c > 0) { console.log('  ' + c + 'x  ' + n); used++; }
}
console.log('\n=== UNUSED (dead code) ===');
let unused = 0;
for (const [n, c] of s) {
  if (c === 0) { console.log('  ' + n); unused++; }
}
console.log('\nTotal: ' + used + ' used, ' + unused + ' unused');
