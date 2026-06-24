import { htmlToMarkdown, fileToMarkdown } from '../../lib/document_parser.js';
import { writeFileSync, unlinkSync } from 'fs';

console.log('=== Document Parser Test ===\n');

// Test 1: HTML to Markdown
const html = '<h1>Xin chào</h1><p>Đây là <b>test</b>.</p><ul><li>Item 1</li><li>Item 2</li></ul>';
const md = await htmlToMarkdown(html);
console.log('[1] HTML → Markdown:');
console.log(md);
console.log('---');

if (md.includes('# Xin chào') && md.includes('**test**')) {
  console.log('[✅] Test 1: Python bridge working');
} else {
  console.log('[❌] Test 1: Fallback used');
  process.exit(1);
}

// Test 2: File to Markdown (create temp HTML file)
import { join } from 'path';
const tmpFile = join(process.cwd(), 'test_temp.html');
writeFileSync(tmpFile, '<h1>File Test</h1><p>Content here.</p>');
const fileMd = await fileToMarkdown(tmpFile);
console.log('\n[2] File → Markdown:');
console.log(fileMd);

if (fileMd.includes('# File Test')) {
  console.log('[✅] Test 2: File parsing working');
} else {
  console.log('[❌] Test 2: File parsing failed');
  process.exit(1);
}

// Cleanup
try { unlinkSync(tmpFile); } catch { /* ignore */ }

console.log('\n✅ All tests passed!');
