/**
 * scripts/algo_webhook.js — Algo Bot: Gửi bài thuật toán daily 8AM + đáp án 23:59

 * Flow:
 * 1. Chạy lần đầu: node scripts/ingest_interview_resources.js
 * 2. Cron 8AM: node scripts/algo_webhook.js daily
 * 3. Cron 23:59: node scripts/algo_webhook.js answer
 *
 * Cần: ALGO_WEBHOOK_URL trong .env
 */

import { DatabaseSync } from 'node:sqlite';
import { embedText } from '../lib/embeddings.js';
import { cosineSimilarity } from '../lib/embeddings.js';

const DB_PATH = './vectors.db';
const ALGO_WEBHOOK_URL = process.env.ALGO_WEBHOOK_URL || '';

// ── Bảng DSA topics và hints ────────────────────────────────────────────────
const DSA_TOPICS = [
  { topic: 'two-pointers', hint: 'Dùng 2 con trỏ ở 2 đầu mảng, di chuyển tùy điều kiện' },
  { topic: 'sliding-window', hint: 'Dùng window có kích thước cố định hoặc biến đổi' },
  { topic: 'binary-search', hint: 'Chọn mid, so sánh, thu hằng search space' },
  { topic: 'bfs', hint: 'Dùng queue, duyệt theo chiều rộng' },
  { topic: 'dfs', hint: 'Dùng stack hoặc recursion, duyệt theo chiều sâu' },
  { topic: 'dynamic-programming', hint: 'Chia bài toán thành sub-problems, lưu kết quả' },
  { topic: 'hash-table', hint: 'Dùng map/object để O(1) lookup' },
  { topic: 'linked-list', hint: 'Dùng con trỏ next, cẩn thận cycle' },
  { topic: 'stack', hint: 'LIFO — Last In First Out' },
  { topic: 'queue', hint: 'FIFO — First In First Out' },
  { topic: 'tree', hint: 'Recursive traversal: inorder, preorder, postorder' },
  { topic: 'graph', hint: 'DFS/BFS + visited set' },
  { topic: 'sorting', hint: 'QuickSort/MergeSort — chia định lặp' },
  { topic: 'heap', hint: 'Priority queue — min/max heap' },
  { topic: 'trie', hint: 'Tree cho string — mỗi node là 1 ký tự' },
  { topic: 'union-find', hint: 'Disjoint set — find với path compression' },
  { topic: 'greedy', hint: 'Chọn local optimal từng bước' },
  { topic: 'backtracking', hint: 'Thử → kiểm tra → undo nếu sai' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDb() {
  return new DatabaseSync(DB_PATH);
}

async function sendWebhook(payload) {
  if (!ALGO_WEBHOOK_URL) {
    console.log('[AlgoBot] ALGO_WEBHOOK_URL not set, skipping webhook');
    return false;
  }

  try {
    const res = await fetch(ALGO_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.error('[AlgoBot] Webhook failed:', err.message);
    return false;
  }
}

// ── Daily: Adaptive bài tập theo tiến trình ────────────────────────────────

async function sendDailyProblem() {
  const db = getDb();

  // 1. Lấy user stats (tier hiện tại)
  const statsRow = db.prepare("SELECT value FROM algo_daily WHERE key = 'user_stats'").get();
  let stats = { tier: 1, easySolved: 0, mediumSolved: 0, hardSolved: 0, expertSolved: 0 };
  if (statsRow) {
    try { stats = JSON.parse(statsRow.value); } catch { /* use defaults */ }
  }

  // 2. Xác định tier tiếp theo dựa trên số bài đã giải
  let targetTier = stats.tier || 1;
  if (stats.easySolved >= 30 && targetTier === 1) targetTier = 2;
  if (stats.mediumSolved >= 50 && targetTier === 2) targetTier = 3;
  if (stats.hardSolved >= 30 && targetTier === 3) targetTier = 4;

  // 3. Lấy bài từ tier tương ứng (80% tier hiện tại, 20% tier trước để ôn lại)
  let rows;
  const difficultyMap = { 1: 'easy', 2: 'medium', 3: 'hard', 4: 'expert' };
  const targetDifficulty = difficultyMap[targetTier] || 'easy';

  if (Math.random() < 0.8) {
    rows = db.prepare(
      "SELECT id, chunk_text, metadata, difficulty FROM vectors WHERE domain = 'algorithms' AND id LIKE 'interview::%' AND difficulty = ?"
    ).all(targetDifficulty);
  } else {
    const reviewTier = Math.max(1, targetTier - 1);
    const reviewDifficulty = difficultyMap[reviewTier] || 'easy';
    rows = db.prepare(
      "SELECT id, chunk_text, metadata, difficulty FROM vectors WHERE domain = 'algorithms' AND id LIKE 'interview::%' AND difficulty = ?"
    ).all(reviewDifficulty);
  }

  if (rows.length === 0) {
    rows = db.prepare(
      "SELECT id, chunk_text, metadata, difficulty FROM vectors WHERE domain = 'algorithms' AND id LIKE 'interview::%' AND difficulty = 'easy'"
    ).all();
  }

  if (rows.length === 0) {
    console.log('[AlgoBot] No interview data found. Run ingest_interview_resources.js first.');
    db.close();
    return;
  }

  // Random 1 bài từ tier
  const randomRow = rows[Math.floor(Math.random() * rows.length)];
  const metadata = JSON.parse(randomRow.metadata || '{}');
  const text = randomRow.chunk_text;

  // Extract topic từ tags
  const tags = metadata.tags || [];
  const matchedTopic = DSA_TOPICS.find(t => tags.some(tag => tag.includes(t.topic)));
  const hint = matchedTopic?.hint || 'Think about the optimal approach';

  // Tạo bài tập từ chunk text
  const lines = text.split('\n').filter(l => l.trim());
  const title = lines[0]?.replace(/^#+\s*/, '').slice(0, 80) || 'Algorithm Problem';
  const problemText = lines.slice(1, 6).join('\n').slice(0, 500);

  // Lưu bài hiện tại vào SQLite
  db.prepare(`
    CREATE TABLE IF NOT EXISTS algo_daily (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at TEXT
    )
  `).run();

  const today = new Date().toISOString().slice(0, 10);
  const answerText = lines.slice(6).join('\n').slice(0, 1000);
  const difficulty = metadata.difficulty || 'easy';

  db.prepare('INSERT OR REPLACE INTO algo_daily VALUES (?, ?, ?)').run(
    'current_problem',
    JSON.stringify({ title, problemText, answerText, hint, tags, difficulty, tier: targetTier, date: today }),
    new Date().toISOString()
  );

  // Lưu stats
  db.prepare('INSERT OR REPLACE INTO algo_daily VALUES (?, ?, ?)').run(
    'user_stats',
    JSON.stringify({ ...stats, tier: targetTier }),
    new Date().toISOString()
  );

  db.close();

  // Gửi webhook
  const tierEmoji = ['', '🟢', '🟡', '🟠', '🔴'][targetTier] || '🟢';
  const difficultyLabel = ['', 'Easy', 'Medium', 'Hard', 'Expert'][targetTier] || 'Easy';

  const payload = {
    embeds: [{
      title: `${tierEmoji} Daily Algorithm — ${title}`,
      description: problemText,
      color: [0, 0x22c55e, 0xf59e0b, 0xff6600, 0xff0000][targetTier] || 0x6366f1,
      fields: [
        {
          name: '📊 Difficulty',
          value: `${difficultyLabel} (Tier ${targetTier})`,
          inline: true,
        },
        {
          name: '💡 Hint (click to reveal)',
          value: `||${hint}||`,
          inline: false,
        },
        {
          name: '🏷️ Tags',
          value: tags.join(', ') || 'general',
          inline: true,
        },
      ],
      footer: { text: 'Gõ !done khi đã giải xong. Đáp án sẽ gửi lúc 23:59 nếu chưa giải.' },
      timestamp: new Date().toISOString(),
    }],
  };

  await sendWebhook(payload);
  console.log(`[AlgoBot] Sent daily problem: ${title} (${difficultyLabel}, Tier ${targetTier})`);
}

// ── Answer: Gửi đáp án 23:59 ────────────────────────────────────────────────

async function sendAnswer() {
  const db = getDb();

  const row = db.prepare("SELECT value FROM algo_daily WHERE key = 'current_problem'").get();
  if (!row) {
    console.log('[AlgoBot] No current problem found.');
    db.close();
    return;
  }

  const problem = JSON.parse(row.value);
  const today = new Date().toISOString().slice(0, 10);

  // Kiểm tra nếu đã giải (cột solved)
  const solved = db.prepare("SELECT value FROM algo_daily WHERE key = 'solved'").get();
  if (solved?.value === today) {
    console.log('[AlgoBot] Already solved today, skipping answer.');
    db.close();
    return;
  }

  db.close();

  // Gửi webhook
  const payload = {
    embeds: [{
      title: `💡 Đáp án: ${problem.title}`,
      description: problem.answerText?.slice(0, 2000) || 'Không có đáp án chi tiết.',
      color: 0x22c55e,
      fields: [
        {
          name: '💡 Hint đã dùng',
          value: problem.hint || 'N/A',
        },
      ],
      footer: { text: 'Hôm nay lại có bài mới lúc 8AM!' },
      timestamp: new Date().toISOString(),
    }],
  };

  await sendWebhook(payload);
  console.log(`[AlgoBot] Sent answer for: ${problem.title}`);
}

// ── Mark solved ─────────────────────────────────────────────────────────────

async function markSolved() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  db.prepare('CREATE TABLE IF NOT EXISTS algo_daily (key TEXT PRIMARY KEY, value TEXT, created_at TEXT)').run();
  db.prepare('INSERT OR REPLACE INTO algo_daily VALUES (?, ?, ?)').run('solved', today, new Date().toISOString());

  db.close();
  console.log('[AlgoBot] Marked as solved for today.');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const mode = process.argv[2] || 'daily';

switch (mode) {
  case 'daily':
    await sendDailyProblem();
    break;
  case 'answer':
    await sendAnswer();
    break;
  case 'done':
    await markSolved();
    break;
  default:
    console.log('Usage: node scripts/algo_webhook.js [daily|answer|done]');
}
