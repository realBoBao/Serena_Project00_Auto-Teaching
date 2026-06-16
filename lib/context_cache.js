/**
 * lib/context_cache.js — Gemini Context Caching
 * Cache nội dung tĩnh (system prompt, tài liệu lớn) để giảm chi phí input token.
 * @module lib/context_cache
 */

import { getLogger } from './logger.js';
const logger = getLogger('ContextCache');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const CACHE_API = 'https://generativelanguage.googleapis.com/v1beta/cachedContents';

// In-memory cache state
const _caches = new Map(); // cacheName → { name, uri, expireTime, ttl }

/**
 * Tạo hoặc lấy context cache từ Gemini API.
 * @param {string} displayName — Tên định danh cho cache
 * @param {string} content — Nội dung cần cache (system prompt, tài liệu, etc.)
 * @param {string} ttl — Thời gian sống (ví dụ: '3600s' cho 1 tiếng)
 * @returns {string|null} — Cache name hoặc null nếu fail
 */
export async function getOrCreateCache(displayName, content, ttl = '3600s') {
  if (!GEMINI_KEY) return null;

  // Check in-memory trước
  const existing = _caches.get(displayName);
  if (existing && new Date(existing.expireTime) > new Date()) {
    logger.debug(`[ContextCache] Hit: ${displayName}`);
    return existing.name;
  }

  try {
    // Tạo cache mới qua Gemini API
    const res = await fetch(`${CACHE_API}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/gemini-2.0-flash`,
        displayName,
        systemInstruction: { parts: [{ text: content }] },
        ttl,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logger.warn(`[ContextCache] Create failed: ${res.status} ${err.error?.message || ''}`);
      return null;
    }

    const data = await res.json();
    const cacheInfo = {
      name: data.name,
      uri: data.uri,
      expireTime: data.expireTime,
      ttl,
    };

    _caches.set(displayName, cacheInfo);
    logger.info(`[ContextCache] Created: ${displayName} (TTL: ${ttl})`);
    return data.name;
  } catch (err) {
    logger.error(`[ContextCache] Error: ${err.message}`);
    return null;
  }
}

/**
 * Lấy cached content name để gọi API.
 * @param {string} displayName
 * @returns {string|null}
 */
export function getCacheName(displayName) {
  const cache = _caches.get(displayName);
  if (cache && new Date(cache.expireTime) > new Date()) {
    return cache.name;
  }
  return null;
}

/**
 * Xóa cache.
 * @param {string} displayName
 */
export async function deleteCache(displayName) {
  const cache = _caches.get(displayName);
  if (!cache) return;

  try {
    await fetch(`${CACHE_API}/${cache.name}?key=${GEMINI_KEY}`, { method: 'DELETE' });
    _caches.delete(displayName);
    logger.info(`[ContextCache] Deleted: ${displayName}`);
  } catch (err) {
    logger.error(`[ContextCache] Delete error: ${err.message}`);
  }
}

/**
 * Liệt kê tất cả caches đang hoạt động.
 */
export function listCaches() {
  return [..._caches.entries()].map(([name, info]) => ({
    name,
    expireTime: info.expireTime,
    ttl: info.ttl,
  }));
}
