import { rtkFilter, rtkExec } from '../../lib/rtk_filter.js';

// Test 1: Filter noisy output
const noisyOutput = `
npm warn deprecated package@1.0.0: Package deprecated
npm notice New minor version available
> test
  ✓ test 1 (10ms)
  ✓ test 2 (5ms)
  ✗ test 3 (20ms)
    Error: expected true to be false
    at Object.<anonymous> (test/file.test.js:42:5)
    at Module._compile (node:internal/modules/cjs/loader:1234:5)
    at require (node:internal/modules/cjs/cjs/loader:1234:5)
npm notice
`;

console.log('=== Test 1: RTK Filter ===');
const filtered = rtkFilter(noisyOutput);
console.log(filtered);
console.log(`\nOriginal: ${noisyOutput.length} chars → Filtered: ${filtered.length} chars`);
console.log(`Reduction: ${Math.round((1 - filtered.length / noisyOutput.length) * 100)}%`);

// Test 2: Real command
console.log('\n=== Test 2: rtkExec (git status) ===');
try {
  const result = await rtkExec('git status --short', { timeout: 10000 });
  console.log('Exit code:', result.exitCode);
  console.log('Filtered output:', result.filtered);
} catch (err) {
  console.log('Error:', err.message);
}
