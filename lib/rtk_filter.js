/**
 * lib/rtk_filter.js — Rust Token Killer (RTK) port for Node.js
 *
 * RTK giảm 80-90% token tiêu thụ khi chạy CLI commands bằng cách:
 * - Smart Filtering: Loại bỏ log rác, chỉ giữ lỗi/output quan trọng
 * - Grouping: Gộp các dòng giống nhau
 * - Deduplication: Loại bỏ trùng lặp
 *
 * Sử dụng: Thay vì `execSync('npm test')`, dùng `rtkExec('npm test')`
 *
 * @module lib/rtk_filter
 */

import { spawn } from 'child_process';

const MAX_OUTPUT_LENGTH = 4000; // ~1000 tokens
const NOISE_PATTERNS = [
  /^\s*$/, // empty lines
  /^npm warn/i,
  /^npm notice/i,
  /deprecated/i,
  /^$/,
  /^\s*at\s+.*\(.*\)$/, // stack trace lines
  /node_modules/,
  /^\s*\^+\s*$/, // carets
  /^\s*~\s*$/, // tildes
];

const SIGNAL_PATTERNS = [
  /error/i,
  /fail/i,
  /exception/i,
  /fatal/i,
  /panic/i,
  /undefined/i,
  /null/i,
  /cannot find/i,
  /not found/i,
  /permission denied/i,
  /EACCES/,
  /ENOENT/,
  /ECONNREFUSED/,
  /timeout/i,
];

function isNoise(line) {
  return NOISE_PATTERNS.some(p => p.test(line));
}

function isSignal(line) {
  return SIGNAL_PATTERNS.some(p => p.test(line));
}

function smartFilter(output) {
  const lines = output.split('\n');
  const signals = [];
  const nonNoise = [];
  const seen = new Set();

  for (const line of lines) {
    // Dedup
    const trimmed = line.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);

    // Keep signals
    if (isSignal(line)) {
      signals.push(line);
    } else if (!isNoise(line) && trimmed.length > 0) {
      nonNoise.push(line);
    }
  }

  // Build summary
  const parts = [];

  if (signals.length > 0) {
    parts.push('🚨 ERRORS:');
    parts.push(...signals.slice(0, 10));
    if (signals.length > 10) parts.push(`... and ${signals.length - 10} more errors`);
  }

  // Add non-noise output (limited)
  const remainingBudget = MAX_OUTPUT_LENGTH - parts.join('\n').length;
  if (remainingBudget > 100 && nonNoise.length > 0) {
    parts.push('\n📋 OUTPUT:');
    let currentLength = 0;
    for (const line of nonNoise) {
      if (currentLength + line.length > remainingBudget) {
        parts.push(`... (${nonNoise.length} total lines, truncated)`);
        break;
      }
      parts.push(line);
      currentLength += line.length;
    }
  }

  return parts.join('\n');
}

/**
 * Execute command with RTK-style output filtering
 * @param {string} command
 * @param {Object} options
 * @returns {Promise<{stdout, stderr, exitCode, filtered}>}
 */
export function rtkExec(command, { timeout = 60000, cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd', ['/c', command], {
      cwd,
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timeout: ${command}`));
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const filtered = smartFilter(stdout);
      resolve({ stdout, stderr, exitCode: code, filtered });
    });
  });
}

/**
 * Quick filter for existing output string
 * @param {string} output
 * @returns {string}
 */
export function rtkFilter(output) {
  return smartFilter(output);
}

export default { rtkExec, rtkFilter };
