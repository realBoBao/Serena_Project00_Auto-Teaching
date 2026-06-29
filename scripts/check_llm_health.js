#!/usr/bin/env node
/**
 * scripts/check_llm_health.js — Kiểm tra tất cả LLM providers
 * Usage: node scripts/check_llm_health.js
 */

import 'dotenv/config';

const providers = [];

// ── Groq ──
if (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.includes('your_')) {
  providers.push({
    name: 'Groq',
    test: async () => {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      });
      return res.ok ? 'OK' : `HTTP ${res.status}`;
    }
  });
}

// ── Gemini ──
if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')) {
  providers.push({
    name: 'Gemini',
    test: async () => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
      return res.ok ? 'OK' : `HTTP ${res.status}`;
    }
  });
}

// ── OpenRouter ──
if (process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY.includes('your_')) {
  providers.push({
    name: 'OpenRouter',
    test: async () => {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` },
      });
      if (res.ok) return 'OK';
      const text = await res.text();
      return `HTTP ${res.status}: ${text.slice(0, 100)}`;
    }
  });
}

// ── Local LLM ──
providers.push({
  name: 'Local LLM (:3002)',
  test: async () => {
    try {
      const res = await fetch(`${process.env.LOCAL_LLM_URL || 'http://localhost:3002'}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? 'OK' : `HTTP ${res.status}`;
    } catch {
      return 'OFFLINE (port 3002 not listening)';
    }
  }
});

// ── Run tests ──
console.log('🔍 LLM Health Check\n');
let hasWorking = false;

for (const p of providers) {
  try {
    const result = await p.test();
    const icon = result === 'OK' ? '✅' : '❌';
    if (result === 'OK') hasWorking = true;
    console.log(`${icon} ${p.name}: ${result}`);
  } catch (err) {
    console.log(`❌ ${p.name}: ${err.message}`);
  }
}

console.log('');
if (hasWorking) {
  console.log('✅ Có ít nhất 1 provider hoạt động.');
} else {
  console.log('❌ TẤT CẢ providers đều không khả dụng!');
  console.log('');
  console.log('📋 Cách fix:');
  console.log('1. Groq (free): https://console.groq.com → API Keys');
  console.log('2. Gemini (free): https://aistudio.google.com → API Keys');
  console.log('3. OpenRouter: https://openrouter.ai → Keys (cần nạp $5)');
  console.log('4. Local LLM: cài Ollama + chạy llama-server port 3002');
  console.log('');
  console.log('💡 Free tier hàng tháng:');
  console.log('   - Groq: 100+ requests/ngày (llama-3.3-70b)');
  console.log('   - Gemini: 1500 requests/ngày (gemini-2.0-flash)');
}
