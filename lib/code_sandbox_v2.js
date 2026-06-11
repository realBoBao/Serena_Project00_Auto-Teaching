/**
 * code_sandbox_v2.js — Canonical 4-layer security pattern database
 * Single source of truth for all security patterns.
 * Imported by code_sandbox.js for analyzeCodeSecurity().
 */

// Re-exports from code_sandbox.js (execution + language config + security patterns)
export { executeCode, getSupportedLanguages, getLang, DANGEROUS_COMMANDS, DANGEROUS_IMPORTS, DANGEROUS_PATTERNS, EXFILTRATION_PATTERNS } from './code_sandbox.js';

// ── Security Analysis (uses canonical patterns from sandbox_patterns.js) ──
export function analyzeCodeSecurity(code) {
  for (const p of DANGEROUS_COMMANDS) {
    if (p.test(code)) return { safe: false, reason: `🚫 [Layer 1] Dangerous command: ${p.toString().slice(0, 60)}`, layer: 1 };
  }
  for (const p of DANGEROUS_IMPORTS) {
    if (p.test(code)) return { safe: false, reason: `🚫 [Layer 2] Dangerous import: ${p.toString().slice(0, 60)}`, layer: 2 };
  }
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(code)) return { safe: false, reason: `🚫 [Layer 3] Dangerous pattern: ${p.toString().slice(0, 60)}`, layer: 3 };
  }
  for (const p of EXFILTRATION_PATTERNS) {
    if (p.test(code)) return { safe: false, reason: `🚫 [Layer 4] Data exfiltration: ${p.toString().slice(0, 60)}`, layer: 4 };
  }
  return { safe: true, reason: null, layer: 0 };
}
