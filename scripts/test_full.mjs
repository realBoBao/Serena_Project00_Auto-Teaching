/**
 * scripts/test_full.mjs — Test toàn bộ flow: scheduler → pipeline → webhook
 * Chạy ngay lập tức, không cần đợi cron.
 *
 * Usage:
 *   node scripts/test_full.mjs
 */

import 'dotenv/config';
import { spawn } from 'child_process';

console.log('═'.repeat(60));
console.log('Full Flow Test: Scheduler → Pipeline → Webhook');
console.log('═'.repeat(60));
console.log(`Time: ${new Date().toISOString()}`);
console.log('');

// ── 1. Test Scheduler Catch-Up ──
console.log('── Step 1: Scheduler Catch-Up Check ──');
const lastRunFile = './.scheduler_last_run.json';
import fs from 'fs';
const lastRuns = fs.existsSync(lastRunFile) ? JSON.parse(fs.readFileSync(lastRunFile, 'utf8')) : {};
console.log('Last runs:', JSON.stringify(lastRuns, null, 2));
console.log('');

// ── 2. Test Pipeline (force, no webhook) ──
console.log('── Step 2: Pipeline (force, --no-webhook) ──');
const pipeline = spawn('node', ['pipeline_report_v2.js', '--force', '--no-webhook'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, GITHUB_TOKEN: 'test', TAVILY_API_KEY: 'test' },
});

let pipelineOut = '';
let pipelineErr = '';
pipeline.stdout.on('data', d => { pipelineOut += d; process.stdout.write(d); });
pipeline.stderr.on('data', d => { pipelineErr += d; process.stderr.write(d); });

pipeline.on('exit', (code) => {
  console.log('');
  console.log(`Pipeline exit code: ${code}`);
  console.log('');

  // ── 3. Test Webhook ──
  console.log('── Step 3: Webhook Test ──');
  import('./test_webhook.js').then(() => {
    console.log('');
    console.log('═'.repeat(60));
    console.log('Full Flow Test Complete');
    console.log('═'.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log(`  Scheduler: ${Object.keys(lastRuns).length} jobs tracked`);
    console.log(`  Pipeline:  exit code ${code} (${code === 0 ? 'OK' : 'check logs'})`);
    console.log(`  Webhook:   sent (check Discord)`);
  });
});
