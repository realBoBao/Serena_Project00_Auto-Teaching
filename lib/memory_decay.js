/**
 * lib/memory_decay.js — Memory Decay & Consolidation (Tier 3)
 *
 * Thuật toán Quên có Chọn lọc:
 * Áp dụng Ebbinghaus Forgetting Curve lên dữ liệu tính cách & sở thích.
 *
 * Công thức: R = e^(-t / S)
 *   R = retention (mức độ nhớ còn lại)
 *   t = thời gian kể từ lần tương tác cuối (giây)
 *   S = stability (độ bền của ký ức, tăng khi được reinforce)
 *
 * Áp dụng:
 *   - Category affinity scores decay nếu không có tương tác mới
 *   - Topic strengths decay dần (kiến thức cũ không ôn → quên)
 *   - Mood state weights: recent states quan trọng hơn
 *   - Implicit feedback scores decay với half-life
 *
 * Cron: chạy mỗi ngày lúc 4:00 AM (cùng EvoAgent)
 *
 * Usage:
 *   import { memoryDecay } from './memory_decay.js';
 *   memoryDecay.decayCategoryAffinity(userId, category, lastInteractionMs);
 *   memoryDecay.decayTopicStrength(userId, topic, lastSeenMs);
 *   memoryDecay.runDailyDecay();  // gọi từ cron
 *   const freshness = memoryDecay.getProfileFreshness(userId);
 */

import 'dotenv/config';
import path from 'path';
import { open } from './sqlite_async.js';
import { getLogger } from './logger.js';

const logger = getLogger('MemoryDecay');

const DB_PATH = path.join(process.cwd(), 'data', 'memory_decay.db');

// ── Singleton DB connection ──
let _dbPromise = null;

async function getDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    try {
      const db = await open({ filename: DB_PATH });
      await db.exec(`
        CREATE TABLE IF NOT EXISTS decay_log (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id         TEXT NOT NULL,
          target_type     TEXT NOT NULL,
          target_key      TEXT NOT NULL,
          old_value       REAL,
          new_value       REAL,
          decay_factor    REAL,
          applied_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS decay_config (
          user_id         TEXT NOT NULL,
          target_type     TEXT NOT NULL,
          half_life_days  REAL DEFAULT 30.0,
          min_value       REAL DEFAULT 0.1,
          PRIMARY KEY (user_id, target_type)
        );
        CREATE INDEX IF NOT EXISTS idx_decay_log_user ON decay_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_decay_log_time ON decay_log(applied_at);
      `);
      logger.info('[MemoryDecay] SQLite initialized at', DB_PATH);
      return db;
    } catch (err) {
      logger.warn('[MemoryDecay] SQLite unavailable:', err.message);
      return null;
    }
  })();
  return _dbPromise;
}

// ── Ebbinghaus Forgetting Curve ──

/**
 * Compute retention using Ebbinghaus formula: R = e^(-t / S)
 * @param {number} elapsedMs  — thời gian đã trôi qua (ms)
 * @param {number} halfLifeMs — half-life (ms), thời gian để retention giảm còn 50%
 * @returns {number} retention factor [0, 1]
 */
function ebbinghausRetention(elapsedMs, halfLifeMs) {
  if (elapsedMs <= 0) return 1.0;
  if (halfLifeMs <= 0) return 0.0;
  // Convert half-life to stability: S = halfLife / ln(2)
  const stability = halfLifeMs / Math.LN2;
  return Math.exp(-elapsedMs / stability);
}

/**
 * Default half-life values (days → ms).
 * Tuned per data type:
 *   - Category affinity:  14 days (sở thích thay đổi nhanh)
 *   - Topic strength:     30 days (kiến thức decay chậm hơn)
 *   - Mood weight:         3 days (tâm trạng thay đổi nhanh)
 *   - Implicit score:     21 days (hành vi trung bình)
 */
const DEFAULT_HALF_LIFE = {
  category_affinity: 14 * 24 * 60 * 60 * 1000,
  topic_strength:    30 * 24 * 60 * 60 * 1000,
  mood_weight:        3 * 24 * 60 * 60 * 1000,
  implicit_score:    21 * 24 * 60 * 60 * 1000,
};

// ── MemoryDecay Manager ──

class MemoryDecayManager {

  /** Apply decay to a single value. */
  decayValue(currentValue, elapsedMs, targetType, minValue = 0.1) {
    const halfLife = DEFAULT_HALF_LIFE[targetType] || DEFAULT_HALF_LIFE.implicit_score;
    const retention = ebbinghausRetention(elapsedMs, halfLife);
    const decayed = currentValue * retention;
    return Math.max(minValue, parseFloat(decayed.toFixed(4)));
  }

  /** Decay category affinity scores for a user. */
  async decayCategoryAffinity(userId) {
    try {
      const fbPath = path.join(process.cwd(), 'data', 'implicit_feedback.db');
      const fbDb = await open({ filename: fbPath }).catch(() => null);
      if (!fbDb) return [];
      const rows = await fbDb.all('SELECT category, implicit_score, last_updated FROM category_affinity WHERE user_id = ?', [userId]);
      const changes = [];
      const now = Date.now();
      const decayDb = await getDb();
      for (const row of rows) {
        const elapsed = now - new Date(row.last_updated).getTime();
        const oldScore = row.implicit_score;
        const newScore = this.decayValue(oldScore, elapsed, 'category_affinity', 0.1);
        if (Math.abs(newScore - oldScore) > 0.001) {
          await fbDb.run('UPDATE category_affinity SET implicit_score = ?, last_updated = datetime("now") WHERE user_id = ? AND category = ?', [newScore, userId, row.category]);
          if (decayDb) await decayDb.run('INSERT INTO decay_log (user_id, target_type, target_key, old_value, new_value, decay_factor) VALUES (?, ?, ?, ?, ?, ?)', [userId, 'category_affinity', row.category, oldScore, newScore, parseFloat((newScore / oldScore).toFixed(4))]);
          changes.push({ category: row.category, oldScore, newScore });
        }
      }
      if (changes.length > 0) logger.info(`[Decay] ${userId} category affinity decayed: ${changes.map(c => `${c.category} ${c.oldScore.toFixed(2)}→${c.newScore.toFixed(2)}`).join(', ')}`);
      return changes;
    } catch (err) { logger.warn(`[Decay] decayCategoryAffinity error:`, err.message); return []; }
  }

  /** Decay topic strengths for a user. */
  async decayTopicStrengths(userId) {
    try {
      const pfPath = path.join(process.cwd(), 'data', 'user_profiles.db');
      const pfDb = await open({ filename: pfPath }).catch(() => null);
      if (!pfDb) return [];
      const row = await pfDb.get('SELECT topic_stats FROM user_profiles WHERE user_id = ?', [userId]);
      if (!row) return [];
      let stats = {};
      try { stats = JSON.parse(row.topic_stats || '{}'); } catch { return []; }
      const changes = [];
      const now = Date.now();
      for (const [topic, data] of Object.entries(stats)) {
        if (!data.last_seen) continue;
        const elapsed = now - new Date(data.last_seen).getTime();
        const accuracy = data.asked > 0 ? data.correct / data.asked : 0.5;
        const decayedAccuracy = this.decayValue(accuracy, elapsed, 'topic_strength', 0.1);
        if (Math.abs(decayedAccuracy - accuracy) > 0.005) {
          stats[topic].correct = Math.max(1, Math.round(data.asked * decayedAccuracy));
          changes.push({ topic, oldAccuracy: parseFloat(accuracy.toFixed(3)), newAccuracy: parseFloat(decayedAccuracy.toFixed(3)) });
        }
      }
      if (changes.length > 0) {
        await pfDb.run('UPDATE user_profiles SET topic_stats = ? WHERE user_id = ?', [JSON.stringify(stats), userId]);
        const decayDb = await getDb();
        if (decayDb) for (const c of changes) await decayDb.run('INSERT INTO decay_log (user_id, target_type, target_key, old_value, new_value, decay_factor) VALUES (?, ?, ?, ?, ?, ?)', [userId, 'topic_strength', c.topic, c.oldAccuracy, c.newAccuracy, parseFloat((c.newAccuracy / c.oldAccuracy).toFixed(4))]);
        logger.info(`[Decay] ${userId} topic strengths decayed: ${changes.map(c => `${c.topic} ${c.oldAccuracy.toFixed(2)}→${c.newAccuracy.toFixed(2)}`).join(', ')}`);
      }
      return changes;
    } catch (err) { logger.warn(`[Decay] decayTopicStrengths error:`, err.message); return []; }
  }

  /** Run full daily decay for all users. */
  async runDailyDecay() {
    logger.info('[Decay] Starting daily memory decay…');
    let users = [];
    try {
      const pfPath = path.join(process.cwd(), 'data', 'user_profiles.db');
      const pfDb = await open({ filename: pfPath }).catch(() => null);
      if (pfDb) {
        const rows = await pfDb.all('SELECT user_id FROM user_profiles');
        users = rows.map(r => r.user_id);
      }
    } catch { /* */ }
    let totalChanges = 0;
    for (const userId of users) {
      const catChanges = await this.decayCategoryAffinity(userId);
      const topicChanges = await this.decayTopicStrengths(userId);
      totalChanges += catChanges.length + topicChanges.length;
    }
    logger.info(`[Decay] Daily decay complete. ${totalChanges} values decayed across ${users.length} users.`);
    return { usersProcessed: users.length, totalChanges };
  }

  /** Get profile freshness score (0–1, 1 = all fresh). */
  async getProfileFreshness(userId) {
    try {
      const pfPath = path.join(process.cwd(), 'data', 'user_profiles.db');
      const pfDb = await open({ filename: pfPath }).catch(() => null);
      if (!pfDb) return null;
      const row = await pfDb.get('SELECT last_seen, topic_stats FROM user_profiles WHERE user_id = ?', [userId]);
      if (!row) return null;
      const now = Date.now();
      let freshnessSum = 0, count = 0;
      if (row.last_seen) { freshnessSum += ebbinghausRetention(now - new Date(row.last_seen).getTime(), DEFAULT_HALF_LIFE.topic_strength); count++; }
      try { const stats = JSON.parse(row.topic_stats || '{}'); for (const [, data] of Object.entries(stats)) { if (data.last_seen) { freshnessSum += ebbinghausRetention(now - new Date(data.last_seen).getTime(), DEFAULT_HALF_LIFE.topic_strength); count++; } } } catch { /* */ }
      return count > 0 ? parseFloat((freshnessSum / count).toFixed(3)) : null;
    } catch { return null; }
  }

  /** Get decay statistics for a user. */
  async getDecayStats(userId, days = 30) {
    const db = await getDb();
    if (!db) return [];
    return db.all(`SELECT target_type, target_key, old_value, new_value, decay_factor, applied_at FROM decay_log WHERE user_id = ? AND applied_at > datetime('now', ?) ORDER BY applied_at DESC`, [userId, `-${days} days`]);
  }

  /** Cleanup old decay logs. */
  async cleanup(daysToKeep = 90) {
    const db = await getDb();
    if (!db) return;
    await db.run("DELETE FROM decay_log WHERE applied_at < datetime('now', ?)", [`-${daysToKeep} days`]);
    logger.info(`[MemoryDecay] Cleaned up decay logs older than ${daysToKeep} days`);
  }
}

// ── Singleton export ─
export const memoryDecay = new MemoryDecayManager();
export { ebbinghausRetention, DEFAULT_HALF_LIFE };
export default memoryDecay;
