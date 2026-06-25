#!/usr/bin/env node
/**
 * tools/dead_code_analysis.mjs — Phân tích unused lib files
 * Chạy: node tools/dead_code_analysis.mjs
 * Output: phân loại dead code files theo nhóm
 */
import fs from 'fs';

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

const unused = Object.entries(ic).filter(([_, c]) => c === 0).map(([n]) => n);

console.log('=== DEAD CODE ANALYSIS ===');
console.log('Total lib files: ' + libFiles.length);
console.log('Unused: ' + unused.length);
console.log('\nUnused files:');
for (const f of unused) {
  console.log('  - ' + f + '.js');
}
