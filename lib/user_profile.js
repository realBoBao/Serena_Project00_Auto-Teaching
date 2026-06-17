/**
 * lib/user_profile.js — User Mental Model & Learning Profile
 *
 * Quản lý profile học tập của mỗi user:
 * - Phong cách học (example_first, theory_first, code_heavy, visual)
 * - Tốc độ tiếp thu (learn_speed 0-1)
 * - Điểm mạnh/yếu theo topic
 * - Lịch sử sự kiện (quiz, follow-up, re-ask)
 * - Thống kê tổng quan (tổng câu hỏi, accuracy, streak)
 *
 * Lưu trữ SQLite — không cần dependency mới.
 * Bắt đầu học ngay từ ngày đầu tiên.
 *
 * Usage:
 *   import { userProfileManager } from './user_profile.js';
 *   const profile = userProfileManager.getProfile(userId, username);
 *   userProfileManager.recordQuizResult(userId, topic, isCorrect, responseTimeMs);
 *   userProfileManager.recordQuestion(userId, topic);
 *   userProfileManager.recordReAsk(userId, topic);
 *   const context = userProfileManager.buildSystemContext(userId);
 *   const stats = userProfileManager.getProfileStats(userId);
 *   const prefs = userProfileManager.getUserPreference(userId);
 *   userProfileManager.setUserPreference(userId, { style: 'example_first' });
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getLogger } from './logger.js';
import { open } from './sqlite_adapter.js';

const logger = getLogger('UserProfile');

const DB_PATH = path.join(process.cwd(), 'data', 'user_profiles.db');

// ── SQLite wrapper (async via node-sqlite3-wasm — no native compilation) ──
let _dbPromise = null;

async function getDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const db = await open({ filename: DB_PATH });
      await db.exec(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          user_id       TEXT PRIMARY KEY,
          username      TEXT,
          learn_style   TEXT DEFAULT 'example_first',
          learn_speed   REAL DEFAULT 0.5,
          depth_pref    TEXT DEFAULT 'auto',
          strengths     TEXT DEFAULT '{}',
          weak_areas    TEXT DEFAULT '{}',
          topic_stats   TEXT DEFAULT '{}',
          session_count INTEGER DEFAULT 0,
          total_questions INTEGER DEFAULT 0,
          total_correct INTEGER DEFAULT 0,
          current_streak INTEGER DEFAULT 0,
          best_streak   INTEGER DEFAULT 0,
          last_seen     TEXT,
          created_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS profile_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     TEXT NOT NULL,
          event_type  TEXT NOT NULL,
          topic       TEXT,
          payload     TEXT DEFAULT '{}',
          created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_events_user ON profile_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_events_type ON profile_events(event_type);
      `);
      logger.info('[UserProfile] SQLite initialized at', DB_PATH);
      return db;
    } catch (err) {
      logger.warn('[UserProfile] SQLite unavailable:', err.message);
      return null;
    }
  })();
  return _dbPromise;
}

// ── Async SQLite helpers ──

async function dbRun(sql, params = []) {
  const db = await getDb();
  if (!db) return;
  try { await db.run(sql, params); } catch (err) { logger.warn('[UserProfile] dbRun error:', err.message); }
}

async function dbGet(sql, params = []) {
  const db = await getDb();
  if (!db) return null;
  try { return await db.get(sql, params); } catch (err) { logger.warn('[UserProfile] dbGet error:', err.message); return null; }
}

async function dbAll(sql, params = []) {
  const db = await getDb();
  if (!db) return [];
  try { return await db.all(sql, params); } catch (err) { logger.warn('[UserProfile] dbAll error:', err.message); return []; }
}

// ── UserProfileManager (all methods async for WASM SQLite) ──

class UserProfileManager {
  async getProfile(userId, username = '') {
    let row = await dbGet('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    if (!row) {
      await dbRun('INSERT INTO user_profiles (user_id, username, last_seen) VALUES (?, ?, datetime("now"))', [userId, username]);
      row = await dbGet('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    } else if (username && row.username !== username) {
      await dbRun('UPDATE user_profiles SET username = ? WHERE user_id = ?', [username, userId]);
      row.username = username;
    }
    if (!row) return null;
    return this._parseRow(row);
  }

  _parseRow(row) {
    return {
      user_id: row.user_id, username: row.username || '',
      learn_style: row.learn_style || 'example_first',
      learn_speed: row.learn_speed || 0.5,
      depth_pref: row.depth_pref || 'auto',
      strengths: JSON.parse(row.strengths || '{}'),
      weak_areas: JSON.parse(row.weak_areas || '{}'),
      topic_stats: JSON.parse(row.topic_stats || '{}'),
      session_count: row.session_count || 0,
      total_questions: row.total_questions || 0,
      total_correct: row.total_correct || 0,
      current_streak: row.current_streak || 0,
      best_streak: row.best_streak || 0,
      last_seen: row.last_seen, created_at: row.created_at,
    };
  }

  async recordQuizResult(userId, topic, isCorrect, responseTimeMs = 5000) {
    const profile = await this.getProfile(userId);
    if (!profile) return;
    const stats = profile.topic_stats;
    if (!stats[topic]) stats[topic] = { asked: 0, correct: 0, last_seen: null, avg_time_ms: 0 };
    stats[topic].asked++;
    stats[topic].last_seen = new Date().toISOString();
    if (isCorrect) stats[topic].correct++;
    const accuracy = stats[topic].correct / stats[topic].asked;
    const strengths = { ...profile.strengths };
    strengths[topic] = parseFloat(accuracy.toFixed(3));
    const weak = { ...profile.weak_areas };
    if (isCorrect && weak[topic]) { weak[topic] = Math.max(0, (weak[topic] || 0) - 0.5); if (weak[topic] <= 0) delete weak[topic]; }
    const speedSignal = isCorrect ? Math.max(0, 1 - (responseTimeMs / 20000)) : 0;
    const newSpeed = (profile.learn_speed * 0.85) + (speedSignal * 0.15);
    let currentStreak = profile.current_streak;
    let bestStreak = profile.best_streak;
    if (isCorrect) { currentStreak++; if (currentStreak > bestStreak) bestStreak = currentStreak; } else { currentStreak = 0; }
    const prevAvg = stats[topic].avg_time_ms || responseTimeMs;
    stats[topic].avg_time_ms = Math.round(prevAvg * 0.7 + responseTimeMs * 0.3);
    await dbRun(`UPDATE user_profiles SET strengths = ?, weak_areas = ?, topic_stats = ?, learn_speed = ?, total_questions = total_questions + 1, total_correct = total_correct + ?, current_streak = ?, best_streak = ?, last_seen = datetime('now') WHERE user_id = ?`,
      [JSON.stringify(strengths), JSON.stringify(weak), JSON.stringify(stats), newSpeed, isCorrect ? 1 : 0, currentStreak, bestStreak, userId]);
    await this._logEvent(userId, 'quiz_result', topic, { isCorrect, responseTimeMs, accuracy });
  }

  async recordQuestion(userId, topic) {
    const profile = await this.getProfile(userId);
    if (!profile) return;
    const stats = profile.topic_stats;
    if (!stats[topic]) stats[topic] = { asked: 0, correct: 0, last_seen: null, avg_time_ms: 0 };
    stats[topic].asked++;
    stats[topic].last_seen = new Date().toISOString();
    await dbRun('UPDATE user_profiles SET topic_stats = ?, total_questions = total_questions + 1, last_seen = datetime("now") WHERE user_id = ?', [JSON.stringify(stats), userId]);
    await this._logEvent(userId, 'question', topic, {});
  }

  async recordReAsk(userId, topic) {
    const profile = await this.getProfile(userId);
    if (!profile) return;
    const weak = { ...profile.weak_areas };
    weak[topic] = (weak[topic] || 0) + 1;
    await dbRun('UPDATE user_profiles SET weak_areas = ? WHERE user_id = ?', [JSON.stringify(weak), userId]);
    await this._logEvent(userId, 're_ask', topic, { count: weak[topic] });
  }

  async recordFollowUp(userId, topic) {
    const profile = await this.getProfile(userId);
    if (!profile) return;
    const weak = { ...profile.weak_areas };
    weak[topic] = (weak[topic] || 0) + 1;
    await dbRun('UPDATE user_profiles SET weak_areas = ? WHERE user_id = ?', [JSON.stringify(weak), userId]);
    await this._logEvent(userId, 'follow_up', topic, { count: weak[topic] });
  }

  async setUserPreference(userId, prefs = {}) {
    const profile = await this.getProfile(userId);
    if (!profile) return;
    const updates = [];
    const params = [];
    if (prefs.style) { const v = ['example_first','theory_first','code_heavy','visual']; if (v.includes(prefs.style)) { updates.push('learn_style = ?'); params.push(prefs.style); } }
    if (prefs.depth) { const v = ['concise','detailed','auto']; if (v.includes(prefs.depth)) { updates.push('depth_pref = ?'); params.push(prefs.depth); } }
    if (updates.length > 0) { params.push(userId); await dbRun(`UPDATE user_profiles SET ${updates.join(', ')} WHERE user_id = ?`, params); logger.info(`[UserProfile] ${userId} updated:`, Object.keys(prefs).join(', ')); }
    const extraPrefs = {};
    if (prefs.model) extraPrefs.model = prefs.model;
    if (prefs.sources) extraPrefs.sources = prefs.sources;
    if (prefs.learningEnabled !== undefined) extraPrefs.learning = prefs.learningEnabled;
    if (Object.keys(extraPrefs).length > 0) { await this._logEvent(userId, 'preference_change', null, extraPrefs); }
  }

  async getUserPreference(userId) {
    const profile = await this.getProfile(userId);
    if (!profile) { return { preferredModel: 'auto', preferredSources: [], learningEnabled: true, learn_style: 'example_first', depth_pref: 'auto' }; }
    const prefEvents = await dbAll("SELECT payload FROM profile_events WHERE user_id = ? AND event_type = 'preference_change' ORDER BY created_at DESC LIMIT 1", [userId]);
    let extraPrefs = {};
    if (prefEvents.length > 0) { try { extraPrefs = JSON.parse(prefEvents[0].payload || '{}'); } catch { /* ignore */ } }
    return { preferredModel: extraPrefs.model || 'auto', preferredSources: extraPrefs.sources || [], learningEnabled: extraPrefs.learning !== false, learn_style: profile.learn_style, depth_pref: profile.depth_pref, learn_speed: profile.learn_speed };
  }

  async incrementSession(userId) {
    await dbRun('UPDATE user_profiles SET session_count = session_count + 1, last_seen = datetime("now") WHERE user_id = ?', [userId]);
  }

  async buildSystemContext(userId) {
    const p = await this.getProfile(userId);
    if (!p) return '';
    const topStrengths = Object.entries(p.strengths).sort(([,a],[,b]) => b-a).slice(0,3).map(([t,s]) => `${t} (${Math.round(s*100)}%)`).join(', ');
    const topWeak = Object.entries(p.weak_areas).sort(([,a],[,b]) => b-a).slice(0,3).map(([t]) => t).join(', ');
    const speedLabel = p.learn_speed > 0.7 ? 'nhanh' : p.learn_speed > 0.4 ? 'trung bình' : 'cần giải thích kỹ';
    const styleNote = { example_first: 'Ưu tiên ví dụ cụ thể trước lý thuyết.', theory_first: 'Giải thích lý thuyết rõ ràng trước khi đưa ví dụ.', code_heavy: 'Tập trung vào code thực tế, ít lý thuyết trừu tượng.', visual: 'Dùng sơ đồ, hình ảnh, visualization khi có thể.' }[p.learn_style] || 'Tự điều chỉnh phong cách phù hợp.';
    const depthNote = p.depth_pref === 'concise' ? 'Trả lời ngắn gọn, thẳng vào điểm chính.' : p.depth_pref === 'detailed' ? 'Trả lời chi tiết, đầy đủ ví dụ minh họa.' : 'Tự điều chỉnh độ dài phù hợp với câu hỏi.';
    return ['[USER PROFILE - ' + (p.username || userId) + ']', '- Phong cách học: ' + p.learn_style + ' → ' + styleNote, '- Tốc độ tiếp thu: ' + speedLabel + ' (score: ' + p.learn_speed.toFixed(2) + ')', '- Độ chi tiết: ' + depthNote, '- Điểm mạnh: ' + (topStrengths || 'chưa đủ dữ liệu'), '- Cần chú ý thêm: ' + (topWeak || 'không có'), '- Streak hiện tại: ' + p.current_streak + ' | Best: ' + p.best_streak].join('\n');
  }

  async getProfileStats(userId) {
    const profile = await this.getProfile(userId);
    if (!profile) return null;
    const totalQuestions = profile.total_questions || 0;
    const totalCorrect = profile.total_correct || 0;
    const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    const topicCount = Object.keys(profile.topic_stats).length;
    const strengthCount = Object.keys(profile.strengths).length;
    const weakCount = Object.keys(profile.weak_areas).length;
    const level = totalQuestions < 10 ? 1 : totalQuestions < 50 ? 2 : totalQuestions < 150 ? 3 : totalQuestions < 500 ? 4 : 5;
    const xp = totalQuestions * 10;
    const xpForNext = level < 5 ? (level * 1000) : xp;
    const xpProgress = level < 5 ? Math.round((xp / xpForNext) * 100) : 100;
    const topStrengths = Object.entries(profile.strengths).sort(([,a],[,b]) => b-a).slice(0,5);
    const topWeak = Object.entries(profile.weak_areas).sort(([,a],[,b]) => b-a).slice(0,3);
    const recentEvents = await dbAll("SELECT event_type, COUNT(*) as count FROM profile_events WHERE user_id = ? AND created_at > datetime('now', '-7 days') GROUP BY event_type", [userId]);
    const recentActivity = {};
    for (const e of recentEvents) recentActivity[e.event_type] = e.count;
    return { userId, username: profile.username, level, xp, xpForNext, xpProgress, totalQuestions, totalCorrect, accuracy, currentStreak: profile.current_streak, bestStreak: profile.best_streak, topicCount, strengthCount, weakCount, learnStyle: profile.learn_style, learnSpeed: profile.learn_speed, depthPref: profile.depth_pref, sessionCount: profile.session_count, topStrengths, topWeak, recentActivity, lastSeen: profile.last_seen, createdAt: profile.created_at };
  }

  async cleanupOldEvents(daysToKeep = 90) {
    await dbRun("DELETE FROM profile_events WHERE created_at < datetime('now', ?)", [`-${daysToKeep} days`]);
    logger.info(`[UserProfile] Cleaned up events older than ${daysToKeep} days`);
  }

  async _logEvent(userId, type, topic, payload) {
    await dbRun('INSERT INTO profile_events (user_id, event_type, topic, payload) VALUES (?, ?, ?, ?)', [userId, type, topic || '', JSON.stringify(payload || {})]);
  }
}

// ── Singleton export ──
export const userProfileManager = new UserProfileManager();
export default userProfileManager;
