/**
 * SocraticAgent — Phương pháp dạy học Socratic
 *
 * Nguyên tắc:
 * - KHÔNG từ chối trả lời — dẫn dắt user tự tìm ra câu trả lời
 * - Biết khi nào hỏi, hỏi câu nào có ích nhất
 * - Biết khi nào dừng Socratic và giải thích thẳng (escape hatch)
 *
 * Sử dụng lại: sessionStore (Redis), flashcard_db, ask() từ lib/llm.js
 * Không có dependency mới.
 */

import { ask } from '../lib/llm.js';
import { getLogger } from '../lib/logger.js';

// Dynamic requires để tránh circular dependency + test mock issues
let _sessionStore = null;
function getSessionStore() {
  if (!_sessionStore) {
    try {
      const mod = require('../lib/session_store.js');
      _sessionStore = mod.sessionStore || mod.default || mod;
    } catch {
      _sessionStore = null;
    }
  }
  return _sessionStore;
}

// Dynamic require để tránh circular dependency
let _flashcardDb = null;
function getFlashcardDb() {
  if (!_flashcardDb) {
    try {
      const mod = require('../lib/flashcard_db.js');
      _flashcardDb = mod.default || mod;
    } catch {
      _flashcardDb = null;
    }
  }
  return _flashcardDb;
}

const logger = getLogger('SocraticAgent');

// ── Config ──
const MAX_ROUNDS = 4;
const CONFUSED_THRESHOLD = 2;
const SESSION_TTL = 1800; // 30 phút

// ── Session helpers ──

export async function getSocraticSession(userId) {
  try {
    const store = getSessionStore();
    if (!store) return null;
    const raw = await store.get(`socratic:${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setSocraticSession(userId, data) {
  try {
    const store = getSessionStore();
    if (!store) return;
    await store.set(`socratic:${userId}`, JSON.stringify(data), SESSION_TTL);
  } catch (err) {
    logger.warn('[Socratic] setSession failed:', err.message);
  }
}

export async function clearSocraticSession(userId) {
  try {
    const store = getSessionStore();
    if (!store) return;
    await store.del(`socratic:${userId}`);
  } catch (err) {
    logger.warn('[Socratic] clearSession failed:', err.message);
  }
}

// ── SocraticAgent ──

export class SocraticAgent {

  /**
   * Điều kiện kích hoạt Socratic mode.
   * Chỉ dùng khi user đã học đủ về topic (accuracy >= 60%, >= 3 reviews).
   */
  static shouldUseSocratic(userId, topic) {
    if (!topic) return false;
    try {
      const db = getFlashcardDb();
      if (!db) return false;
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN correct_count > 0 THEN 1 ELSE 0 END) as correct,
          MAX(review_count) as reviews
        FROM flashcards
        WHERE user_id = ? AND (tags LIKE ? OR category LIKE ?)
      `).get(userId, `%${topic}%`, `%${topic}%`);

      if (!stats || stats.total === 0) return false;
      const accuracy = (stats.correct || 0) / stats.total;
      const reviewed = stats.reviews || 0;
      return accuracy >= 0.60 && reviewed >= 3;
    } catch (err) {
      logger.warn('[Socratic] shouldUseSocratic error:', err.message);
      return false;
    }
  }

  /**
   * Tạo câu hỏi Socratic từ topic + context.
   */
  static async generateQuestion(topic, userQuestion, round, previousAttempt = null) {
    const roundContext = round === 1
      ? 'Đây là câu hỏi đầu tiên — hỏi câu rộng để kích hoạt kiến thức nền.'
      : round === 2
      ? 'User đã trả lời một lần. Đào sâu hơn vào điểm cụ thể hơn.'
      : 'Gần cuối — dẫn user đến kết luận chính xác bằng một câu hỏi hội tụ.';

    const prevContext = previousAttempt
      ? `\nUser vừa trả lời: "${previousAttempt.slice(0, 200)}"\nDựa trên câu trả lời đó, hỏi tiếp để dẫn đến câu trả lời đúng.`
      : '';

    const prompt = `Bạn là một người thầy dạy theo phương pháp Socratic.
User hỏi về: "${userQuestion}"
Topic cụ thể: ${topic}
Vòng hỏi: ${round}/${MAX_ROUNDS}
${roundContext}${prevContext}

Tạo MỘT câu hỏi duy nhất (không trả lời thẳng) để dẫn dắt user tự tìm ra câu trả lời.
Yêu cầu:
- Câu hỏi phải dựa trên kiến thức user đã có (không hỏi thứ hoàn toàn mới)
- Ngắn, rõ ràng, 1 câu duy nhất
- Kết thúc bằng dấu "?"
- Không giải thích, không hint trực tiếp
- Tiếng Việt tự nhiên

Chỉ xuất câu hỏi, không có thêm gì khác.`;

    try {
      const question = await ask(prompt, { maxTokens: 120 });
      return question.trim();
    } catch (err) {
      logger.warn('[Socratic] generateQuestion LLM failed:', err.message);
      // Fallback question
      return `Bạn có thể giải thíng ${topic} bằng lời của mình không?`;
    }
  }

  /**
   * Đánh giá chất lượng câu trả lời của user.
   * Trả về { quality: 'correct'|'partial'|'wrong'|'confused', nextHint?: string }
   */
  static async evaluateAnswer(topic, question, userAnswer) {
    if (!userAnswer || userAnswer.length < 5) {
      return { quality: 'confused', nextHint: null };
    }

    const prompt = `Bạn là người thầy đánh giá câu trả lời học sinh.

Topic: ${topic}
Câu hỏi: ${question}
Câu trả lời của học sinh: "${userAnswer.slice(0, 300)}"

Đánh giá:
- "correct": Học sinh trả lời đúng và đầy đủ
- "partial": Học sinh hiểu một phần, cần dẫn dắt thêm
- "wrong": Học sinh trả lời sai hoặc không liên quan
- "confused": Học sinh bối rối, không biết trả lời

Nếu partial hoặc wrong, đưa ra 1 gợi ý ngắn (nextHint) để dẫn dắt.

Trả về JSON: {"quality": "correct|partial|wrong|confused", "nextHint": "gợi ý ngắn hoặc null"}`;

    try {
      const raw = await ask(prompt, { maxTokens: 150 });
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          quality: parsed.quality || 'partial',
          nextHint: parsed.nextHint || null,
        };
      }
    } catch (err) {
      logger.warn('[Socratic] evaluateAnswer LLM failed:', err.message);
    }

    // Fallback: heuristic evaluation
    const answerLen = userAnswer.length;
    if (answerLen < 10) return { quality: 'confused', nextHint: null };
    if (answerLen < 50) return { quality: 'partial', nextHint: `Hãy nghĩ về ${topic} — nó liên quan gì đến thuật toán hoặc cấu trúc dữ liệu?` };
    return { quality: 'partial', nextHint: null };
  }

  /**
   * Tạo reveal (giải thích đầy đủ) sau khi Socratic session kết thúc.
   */
  static async generateReveal(topic, originalQuestion, conversation) {
    const history = conversation
      .map((t, i) => `${i % 2 === 0 ? 'Bot hỏi' : 'User trả lời'}: ${t}`)
      .join('\n');

    const prompt = `User vừa trải qua quá trình tìm hiểu Socratic về "${topic}".
Lịch sử hội thoại:
${history}

Bây giờ hãy:
1. Khen ngắn gọn nếu user đã tự tìm ra được (1 câu)
2. Giải thích đầy đủ và chính xác về topic
3. Nêu điểm user đã hiểu đúng và điểm cần nhớ thêm

Tone: như người thầy sau buổi học, ấm áp nhưng chính xác.`;

    try {
      return await ask(prompt, { maxTokens: 500 });
    } catch (err) {
      logger.warn('[Socratic] generateReveal LLM failed:', err.message);
      return `📚 **${topic}**\n\nXin lỗi, tôi gặp sự cố khi tạo giải thích chi tiết. Hãy thử lại sau.`;
    }
  }

  /**
   * Detect confused signal từ phía user.
   */
  static isConfusedSignal(text) {
    const signals = [
      'không biết', 'chịu', 'bó tay', 'không hiểu', 'mù tịt',
      'hint đi', 'nói thẳng đi', '???', 'wtf', 'skip', '!explain',
      'giải thích đi', 'trả lời đi', 'thôi nói luôn đi', 'không biết gì',
      'bó đi', 'huhu', 'help', 'cứu'
    ];
    const lower = text.toLowerCase();
    return signals.some(s => lower.includes(s)) || text.trim().length < 3;
  }
}

// ── Discord integration helpers ──

/**
 * Bắt đầu Socratic session.
 */
export async function startSocraticSession(message, topic, forced = false, originalQuestion = null) {
  const userId = message.author.id;

  const question = await SocraticAgent.generateQuestion(
    topic,
    originalQuestion || topic,
    1
  );

  await setSocraticSession(userId, {
    topic,
    round: 1,
    confusedCount: 0,
    lastQuestion: question,
    conversation: [question],
    originalQuestion,
    startedAt: Date.now(),
  });

  const prefix = forced
    ? `🎓 **Socratic Mode: ${topic}**\n\n`
    : `🎓 Tôi thấy bạn đã học về **${topic}** rồi. Thử tự suy nghĩ nhé:\n\n`;

  await message.reply(
    `${prefix}${question}\n\n` +
    `*Gõ \`!explain\` bất cứ lúc nào nếu muốn tôi giải thích thẳng.*`
  );
}

/**
 * Xử lý câu trả lời trong Socratic session.
 */
export async function handleSocraticReply(message, session) {
  const userId = message.author.id;
  const content = message.content.trim();

  // Escape hatch
  if (content === '!explain' || SocraticAgent.isConfusedSignal(content)) {
    session.confusedCount++;
  }

  const forceReveal =
    content === '!explain' ||
    session.confusedCount >= CONFUSED_THRESHOLD ||
    session.round >= MAX_ROUNDS;

  if (forceReveal) {
    await message.channel.sendTyping();
    const reveal = await SocraticAgent.generateReveal(
      session.topic,
      session.originalQuestion,
      session.conversation
    );
    await message.reply(reveal);
    await clearSocraticSession(userId);
    return;
  }

  // Đánh giá câu trả lời
  const eval_ = await SocraticAgent.evaluateAnswer(
    session.topic,
    session.lastQuestion,
    content
  );

  session.conversation.push(content);

  if (eval_.quality === 'correct') {
    const reveal = await SocraticAgent.generateReveal(
      session.topic,
      session.originalQuestion,
      session.conversation
    );
    await message.reply(reveal);
    await clearSocraticSession(userId);
    return;
  }

  // Chưa đúng → hỏi tiếp
  session.round++;
  if (eval_.quality === 'confused' || eval_.quality === 'wrong') {
    session.confusedCount++;
  }

  const nextQuestion = await SocraticAgent.generateQuestion(
    session.topic,
    session.originalQuestion || session.topic,
    session.round,
    content
  );

  session.lastQuestion = nextQuestion;
  session.conversation.push(nextQuestion);
  await setSocraticSession(userId, session);

  const hintLine = (eval_.quality === 'wrong' && eval_.nextHint)
    ? `\n\n💡 *Gợi ý nhỏ: ${eval_.nextHint}*`
    : '';

  await message.reply(`${nextQuestion}${hintLine}`);
}

/**
 * Extract topic từ câu hỏi.
 */
export async function extractTopic(question) {
  try {
    const prompt = `Từ câu hỏi này, trích xuất 1-3 từ thể hiện topic kỹ thuật chính.
Câu hỏi: "${question}"
Chỉ trả về topic, không có gì khác. Ví dụ: "binary search", "TCP handshake", "React hooks"`;

    const topic = await ask(prompt, { maxTokens: 20 });
    const cleaned = topic.trim().toLowerCase();
    // Validate: topic phải ngắn và hợp lý
    if (cleaned.length > 0 && cleaned.length < 50 && !cleaned.includes('\n')) {
      return cleaned;
    }
    return null;
  } catch {
    return null;
  }
}
