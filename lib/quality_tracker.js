/**
 * lib/quality_tracker.js — Response Quality Tracker (Step 6: Continuous Improvement)
 *
 * Track chất lượng response theo thời gian để biết Serena đang tốt hơn hay xấu hên.
 *
 * Usage:
 *   import { trackResponse, getQualityReport } from './quality_tracker.js';
 *   trackResponse(question, answer, confidence, agentUsed);
 *   const report = await getQualityReport(7); // last 7 days
 */

import { getLogger } from './logger.js';
import { DatabaseSync } from 'node:sqlite';

const logger = getLogger('QualityTracker');
const DB_PATH = './data.db';

function getDb() {
  return new DatabaseSync(DB_PATH);
}

/**
 * Khởi tạo bảng nếu chưa có.
 */
export function initQualityTable() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS response_quality (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question    TEXT,
    agent       TEXT,
    confidence  REAL,
    has_answer  INTEGER,
    provider    TEXT,
    domain      TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);
  db.close();
}

/**
 * Track mỗi response.
 * @param {string} question
 * @param {string} answer
 * @param {object} confidence — { score, level }
 * @param {string} agentUsed
 * @param {string} provider — 'groq' | 'openrouter' | 'gemini' | 'static'
 * @param {string} domain
 */
export function trackResponse(question, answer, confidence, agentUsed, provider = 'unknown', domain = null) {
  try {
    initQualityTable();
    const db = getDb();
    db.prepare(
      "INSERT INTO response_quality (question, agent, confidence, has_answer, provider, domain, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(
      question?.slice(0, 200) || '',
      agentUsed || 'unknown',
      confidence?.score ?? 0,
      (answer && answer.length > 50 && !answer.includes('⚠️ LLM')) ? 1 : 0,
      provider,
      domain
    );
    db.close();
  } catch (err) {
    logger.debug('[QualityTracker] Track failed:', err.message);
  }
}

/**
 * Lấy quality report theo số ngày.
 * @param {number} days
 * @returns {object}
 */
export function getQualityReport(days = 7) {
  try {
    initQualityTable();
    const db = getDb();

    const daysArg = '-' + days + ' days';

    // Tổng quan
    const overview = db.prepare(
      "SELECT COUNT(*) as total, SUM(has_answer) as with_answer, " +
      "ROUND(AVG(confidence), 3) as avg_confidence, " +
      "ROUND(100.0 * SUM(has_answer) / COUNT(*), 1) as answer_rate " +
      "FROM response_quality WHERE created_at >= datetime('now', ?)"
    ).get(daysArg);

    // Breakdown theo provider
    const byProvider = db.prepare(
      "SELECT provider, COUNT(*) as count, ROUND(AVG(confidence), 3) as avg_conf " +
      "FROM response_quality WHERE created_at >= datetime('now', ?) " +
      "GROUP BY provider ORDER BY count DESC"
    ).all(daysArg);

    // Breakdown theo agent
    const byAgent = db.prepare(
      "SELECT agent, COUNT(*) as count, ROUND(AVG(confidence), 3) as avg_conf, " +
      "ROUND(100.0 * SUM(has_answer) / COUNT(*), 1) as answer_rate " +
      "FROM response_quality WHERE created_at >= datetime('now', ?) " +
      "GROUP BY agent ORDER BY count DESC LIMIT 10"
    ).all(daysArg);

    // Trend theo ngày
    const trend = db.prepare(
      "SELECT DATE(created_at) as day, COUNT(*) as count, " +
      "ROUND(100.0 * SUM(has_answer) / COUNT(*), 1) as answer_rate " +
      "FROM response_quality WHERE created_at >= datetime('now', ?) " +
      "GROUP BY day ORDER BY day"
    ).all(daysArg);

    db.close();

    return { days, overview, byProvider, byAgent, trend };
  } catch (err) {
    logger.error('[QualityTracker] Report failed:', err.message);
    return null;
  }
}

/**
 * Format report cho Discord message.
 */
export function formatQualityReport(report) {
  if (!report) return '❌ Quality report unavailable';

  const { days, overview, byProvider, byAgent, trend } = report;

  const lines = [
    `📊 **Quality Report — ${days} ngày qua**`,
    '',
    `📈 Tổng: **${overview.total}** responses | Có answer: **${overview.with_answer}** (${overview.answer_rate}%) | Avg confidence: **${overview.avg_confidence}**`,
    '',
    '**🤖 Provider breakdown:**',
    ...byProvider.map(p => `• ${p.provider}: ${p.count} calls (conf: ${p.avg_conf})`),
    '',
    '**🔧 Agent breakdown:**',
    ...byAgent.slice(0, 5).map(a => `• ${a.agent}: ${a.count} calls, ${a.answer_rate}% answer rate`),
  ];

  if (trend.length > 1) {
    lines.push('', '**📅 Trend:**');
    for (const t of trend) {
      const bar = '█'.repeat(Math.round(t.answer_rate / 10)) + '░'.repeat(10 - Math.round(t.answer_rate / 10));
      lines.push(`• ${t.day}: ${bar} ${t.answer_rate}% (${t.count} calls)`);
    }
  }

  return lines.join('\n');
}
