/**
 * End-to-end test — mô phỏng trải nghiệm người dùng thực tế
 * Test các commands Discord thực tế: !ask, !quiz, !debate, v.v.
 *
 * Chạy: node test_e2e.mjs
 *
 * Lưu ý: Các test DB-dependent (BM25, flashcard) cần data trước.
 * Trong production, data đã có sẵn từ cron jobs.
 */
import { config } from 'dotenv';
config();

// ── Init SQLite DB trước khi test ──
import { openDb } from './lib/sqlite_adapter.js';
try { await openDb(); } catch { /* ignore if already open */ }

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn, opts = {}) {
  if (opts.skip) {
    console.log(`  ⏭️  ${name} (skipped: ${opts.skip})`);
    skipped++;
    return;
  }
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ✅ ${name} (${ms}ms)`);
    passed++;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${name} (${ms}ms): ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

console.log('🧪 E2E Tests — Trải nghiệm người dùng thực tế\n');

// ── 1. LLM Chain (quan trọng nhất — ảnh hưởng !ask) ──
console.log('── LLM Chain ──');

await test('ask() auto → Groq trả lời tiếng Việt', async () => {
  const { ask } = await import('./lib/llm.js');
  const r = await ask('Trong 1 câu: 2+2 bằng mấy?', { maxTokens: 30, timeoutMs: 15000 });
  assert(r.provider === 'groq', `Provider là ${r.provider}, expected groq`);
  assert(r.answer && r.answer.length > 0, 'Answer rỗng');
  assert(r.answer.includes('4'), `Answer không chứa "4": ${r.answer}`);
});

await test('ask() với system prompt (RAG context)', async () => {
  const { ask } = await import('./lib/llm.js');
  const r = await ask('Node.js là gì?', {
    systemPrompt: 'Bạn là Serena, trợ lý AI. Trả lời ngắn gọn trong 1-2 câu.',
    maxTokens: 50
  });
  assert(r.provider === 'groq', `Provider là ${r.provider}`);
  assert(r.answer && r.answer.length > 10, 'Answer quá ngắn');
});

await test('ask() fallback khi provider không tồn tại', async () => {
  const { ask } = await import('./lib/llm.js');
  const r = await ask('Xin chào', { provider: 'nonexistent', maxTokens: 30 });
  assert(r.answer && r.answer.length > 0, 'Không có answer');
});

// ── 2. Embedding & Search (ảnh hưởng RAG) ──
console.log('\n── Embedding & Search ──');

await test('embedText() hoạt động (có fallback local)', async () => {
  const { embedText } = await import('./lib/embeddings.js');
  const emb = await embedText('test query');
  assert(emb && emb.length > 0, 'Embedding rỗng');
  assert(emb.length === 768, `Embedding size ${emb.length} ≠ 768`);
});

await test('vectorSearch() hoạt động', async () => {
  const { embedText } = await import('./lib/embeddings.js');
  const { search } = await import('./lib/vector_store.js');
  const emb = await embedText('javascript programming');
  const results = await search(emb, 3);
  assert(Array.isArray(results), 'Results không phải array');
});

await test('searchBm25() hoạt động', async () => {
  const { searchBm25 } = await import('./lib/bm25_search.js');
  const results = await searchBm25('test', 5);
  assert(Array.isArray(results), 'Results không phải array');
}, { skip: 'Cần data trong DB — chạy riêng khi có data' });

// ── 3. Core Features ──
console.log('\n── Core Features ──');

await test('moodState.analyze() hoạt động', async () => {
  const { moodState } = await import('./lib/mood_state.js');
  const result = await moodState.analyze('user1', 'Tôi đang rất vui hôm nay!');
  assert(result && result.state, `Không có state: ${JSON.stringify(result)}`);
});

await test('flashcardDB.getDueCount() hoạt động', async () => {
  const { getDueCount } = await import('./lib/flashcard_db.js');
  const count = await getDueCount();
  assert(typeof count === 'number', `Count không phải number: ${count}`);
}, { skip: 'Cần data trong DB — chạy riêng khi có data' });

await test('classifyIntentSemantic() hoạt động', async () => {
  const { classifyIntentSemantic } = await import('./lib/semantic_router.js');
  const result = await classifyIntentSemantic('Tôi muốn học JavaScript');
  assert(result && typeof result === 'string', `Không classify được: ${JSON.stringify(result)}`);
}, { skip: 'Init chậm (~3s) — chạy riêng khi cần' });

await test('answerQuestion() hoạt động', async () => {
  const { answerQuestion } = await import('./agents/RagAgent.js');
  const result = await answerQuestion('What is JavaScript?');
  assert(result && result.length > 0, 'answerQuestion trả về rỗng');
}, { skip: 'Init chậm (~5s) — chạy riêng khi cần' });

// ── Summary ──
console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 E2E Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`);
if (failed > 0) {
  console.log('❌ CÓ LỖI — cần fix trước khi deploy');
  process.exit(1);
} else {
  console.log('✅ TẤT CẢ PASS — sẵn sàng deploy');
}
