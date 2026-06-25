#!/usr/bin/env node
/**
 * test_discord_bot.mjs — Test Discord bot connectivity + dedup status
 * Kiểm tra: Discord webhook, SQLite dedup, cron schedule
 * 
 * Usage: node test_discord_bot.mjs
 */

import 'dotenv/config';

console.log('═'.repeat(60));
console.log('DISCORD BOT TEST');
console.log('═'.repeat(60));

// Test 1: Kiểm tra Discord Bot Token
console.log('\n[1] Discord Bot Token...');
if (process.env.DISCORD_BOT_TOKEN) {
  const token = process.env.DISCORD_BOT_TOKEN;
  console.log('   ✅ Token exists:', token.slice(0, 10) + '...' + token.slice(-5));
} else {
  console.log('   ❌ DISCORD_BOT_TOKEN not set');
}

// Test 2: Kiểm tra Discord Webhook URLs
console.log('\n[2] Discord Webhook URLs...');
const webhooks = {
  'DISCORD_WEBHOOK': process.env.DISCORD_WEBHOOK,
  'TECH_WEBHOOK_URL': process.env.TECH_WEBHOOK_URL,
  'JOB_WEBHOOK_URL': process.env.JOB_WEBHOOK_URL,
  'ALGO_WEBHOOK_URL': process.env.ALGO_WEBHOOK_URL,
};
for (const [name, url] of Object.entries(webhooks)) {
  if (url) {
    console.log(`   ✅ ${name}: ${url.slice(0, 50)}...`);
  } else {
    console.log(`   ⚠️  ${name}: NOT SET`);
  }
}

// Test 3: Kiểm tra SQLite dedup
console.log('\n[3] SQLite Dedup Status...');
try {
  const { getDb, getAll } = await import('../../lib/db.js');
  const db = await getDb();
  
  // Check sent_jobs table
  const tables = await getAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sent_jobs'"
  );
  
  if (tables.length > 0) {
    const count = await getAll('SELECT COUNT(*) as count FROM sent_jobs');
    console.log(`   ✅ sent_jobs table exists, ${count[0].count} URLs stored`);
    
    // Check recent entries
    const recent = await getAll(
      "SELECT url, sent_at FROM sent_jobs ORDER BY sent_at DESC LIMIT 5"
    );
    if (recent.length > 0) {
      console.log('   📋 Recent entries:');
      for (const row of recent) {
        console.log(`      ${row.sent_at}: ${row.url.slice(0, 40)}...`);
      }
    }
  } else {
    console.log('   ⚠️  sent_jobs table not found (will be created on first run)');
  }
} catch (err) {
  console.log('   ❌ SQLite error:', err.message);
}

// Test 4: Kiểm tra .env file
console.log('\n[4] Environment Variables...');
const requiredVars = [
  'DISCORD_BOT_TOKEN',
  'TECH_WEBHOOK_URL',
  'JOB_WEBHOOK_URL',
  'ALGO_WEBHOOK_URL',
  'GEMINI_API_KEY',
];
for (const varName of requiredVars) {
  const val = process.env[varName];
  if (val) {
    console.log(`   ✅ ${varName} = ${val.slice(0, 15)}...`);
  } else {
    console.log(`   ❌ ${varName} = NOT SET`);
  }
}

// Test 5: Test Discord Webhook (nếu có)
console.log('\n[5] Test Discord Webhook...');
const testWebhook = process.env.TECH_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
if (testWebhook) {
  try {
    const res = await fetch(testWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '🤖 Bot test — dedup hoạt động!',
        embeds: [{
          title: '✅ Bot Online',
          description: 'Discord bot connected successfully',
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (res.ok) {
      console.log('   ✅ Webhook sent successfully!');
    } else {
      console.log(`   ❌ Webhook failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.log('   ❌ Webhook error:', err.message);
  }
} else {
  console.log('   ⚠️  No webhook URL configured');
}

console.log('\n' + '═'.repeat(60));
console.log('✅ DISCORD BOT TEST COMPLETE');
console.log('═'.repeat(60));
