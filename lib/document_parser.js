/**
 * lib/document_parser.js — Node.js bridge to Python HTML-to-Markdown converter
 *
 * Gọi script Python để clean HTML/file → Markdown trước khi nhồi vào RAG.
 * Fallback nếu Python fail: trả về text gốc.
 *
 * @module lib/document_parser
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { getLogger } from './logger.js';

const logger = getLogger('DocumentParser');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, '..', 'scripts', 'html_to_markdown.py');

// Find Python executable
function findPython() {
  const candidates = [
    'C:/Users/bogia/AppData/Local/Programs/Python/Python312/python.exe',
    'python3',
    'python',
  ];
  for (const p of candidates) {
    if (p.startsWith('C:') && existsSync(p)) return p;
    if (!p.startsWith('C:')) return p;
  }
  return 'python';
}

const PYTHON = findPython();

function runPython(args) {
  try {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const result = execSync(`${PYTHON} ${args.map(a => `"${a}"`).join(' ')}`, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      env,
    });
    return result;
  } catch (err) {
    throw new Error(`Python exec failed: ${err.message}`);
  }
}

/**
 * Convert HTML string to clean Markdown.
 * @param {string} html
 * @returns {Promise<string>} markdown
 */
export async function htmlToMarkdown(html) {
  try {
    const stdout = await runPython([PYTHON_SCRIPT, '--html', html]);
    return stdout.trim();
  } catch (err) {
    logger.warn('[DocumentParser] htmlToMarkdown failed, returning raw text:', err.message);
    // Fallback: strip HTML tags
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Convert file to clean Markdown.
 * Supports: .html, .htm, .txt, .xml, .rss
 * @param {string} filepath
 * @returns {Promise<string>} markdown
 */
export async function fileToMarkdown(filepath) {
  try {
    const stdout = await runPython([PYTHON_SCRIPT, filepath]);
    return stdout.trim();
  } catch (err) {
    logger.warn(`[DocumentParser] fileToMarkdown failed for ${filepath}:`, err.message);
    // Fallback: read as text
    try {
      const { readFile } = await import('fs/promises');
      return await readFile(filepath, 'utf8');
    } catch {
      return '';
    }
  }
}

export default { htmlToMarkdown, fileToMarkdown };
