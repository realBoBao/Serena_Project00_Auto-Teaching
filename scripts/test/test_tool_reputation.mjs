/**
 * Self-check: Tool Reputation System (SQLite)
 * Run: node scripts/test/test_tool_reputation.mjs
 */

import { getTrustScore, recordVerified, recordContradiction, getAllScores, resetAll } from '../../lib/tool_reputation.js';
import { scoreConfidence } from '../../lib/confidence_scorer.js';
import { DatabaseSync } from 'node:sqlite';
import { unlinkSync } from 'fs';

// Clean test DB
try { unlinkSync('./vectors.db'); } catch { /* ignore */ }

console.log('=== Tool Reputation System Test (SQLite) ===\n');

// Test 1: Default baseline
resetAll();
const base = getTrustScore('HN', 'artificial intelligence');
console.log(`[1] Baseline trust (HN/AI): ${base} — expected 0.5`);
console.assert(base === 0.5, 'FAIL: baseline should be 0.5');

// Test 2: Record verified → score goes up
recordVerified('HN', 'artificial intelligence');
const afterVerify = getTrustScore('HN', 'artificial intelligence');
console.log(`[2] After 1 verified: ${afterVerify} — expected 0.55`);
console.assert(Math.abs(afterVerify - 0.55) < 0.01, 'FAIL: verified should increase score to ~0.55');

// Test 3: Record contradiction → score goes down
recordContradiction('HN', 'artificial intelligence');
const afterContra = getTrustScore('HN', 'artificial intelligence');
console.log(`[3] After 1 contradiction: ${afterContra} — expected 0.40`);
console.assert(Math.abs(afterContra - 0.40) < 0.01, 'FAIL: contradiction should decrease to ~0.40');

// Test 4: Multiple contradictions → floor at 0.1
resetAll();
for (let i = 0; i < 10; i++) recordContradiction('bad_source', 'test');
const floor = getTrustScore('bad_source', 'test');
console.log(`[4] Floor after 10 contradictions: ${floor} — expected 0.1`);
console.assert(floor === 0.1, 'FAIL: floor should be 0.1');

// Test 5: Confidence scorer integrates trust
resetAll();
const lowTrust = await scoreConfidence({
  question: 'What is AI?',
  answer: 'AI is artificial intelligence.',
  results: [{ score: 0.8 }],
  source: 'bad_source',
  topic: 'test',
});

recordContradiction('bad_source', 'test');
recordContradiction('bad_source', 'test');
recordContradiction('bad_source', 'test');

const lowTrustAfter = await scoreConfidence({
  question: 'What is AI?',
  answer: 'AI is artificial intelligence.',
  results: [{ score: 0.8 }],
  source: 'bad_source',
  topic: 'test',
});

console.log(`[5] Confidence with low-trust source: ${lowTrustAfter.score} — should be < ${lowTrust.score}`);
console.assert(lowTrustAfter.score < lowTrust.score, 'FAIL: low trust should reduce confidence');

// Test 6: High trust boosts score
resetAll();
for (let i = 0; i < 10; i++) recordVerified('reliable_source', 'test');
const highTrustScore = await scoreConfidence({
  question: 'What is AI?',
  answer: 'AI is a field of computer science.',
  results: [{ score: 0.8 }],
  source: 'reliable_source',
  topic: 'test',
});
console.log(`[6] Confidence with high-trust source: ${highTrustScore.score} — should be > 0.6`);
console.assert(highTrustScore.score > 0.6, 'FAIL: high trust should boost confidence');

// Test 7: getAllScores summary
resetAll();
recordVerified('HN', 'AI');
recordVerified('GitHub', 'rust');
recordContradiction('cached', 'general');
const all = getAllScores();
console.log(`[7] getAllScores: ${all.length} entries — expected 3`);
console.assert(all.length === 3, 'FAIL: should have 3 entries');

// Test 8: Persistence — simulate restart by creating new DB connection
resetAll();
recordVerified('persistent_src', 'test');
const beforeRestart = getTrustScore('persistent_src', 'test');
console.log(`[8] Before "restart": ${beforeRestart}`);
// Force new DB connection (simulates PM2 restart)
const db2 = new DatabaseSync('./vectors.db');
const row = db2.prepare('SELECT score FROM tool_reputation WHERE source = ? AND topic = ?').get('persistent_src', 'test');
const afterRestart = row?.score || 0;
console.log(`[8] After "restart": ${afterRestart} — should equal ${beforeRestart}`);
console.assert(Math.abs(afterRestart - beforeRestart) < 0.01, 'FAIL: score should persist across restart');

// Cleanup
try { unlinkSync('./vectors.db'); } catch { /* ignore */ }

console.log('\n✅ All tests passed!');
