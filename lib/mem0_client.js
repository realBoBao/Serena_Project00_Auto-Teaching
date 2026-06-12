/**
 * ═══════════════════════════════════════════════════════════════
 * Mem0 Client — Universal Memory Layer
 * ═══════════════════════════════════════════════════════════════
 *
 * Mem0 quản lý per-conversation short-term facts:
 * - "User vừa hỏi về Raft consensus"
 * - "User đang debug memory leak trong Python"
 * - "User preference: example-first learning"
 *
 * Kết hợp với Qdrant (long-term knowledge) và user_profile (learning style).
 *
 * Fallback: Nếu mem0 không available, dùng in-memory Map.
 */

import { getLogger } from './logger.js';
const logger = getLogger('Mem0');

let Mem0Client = null;
let mem0Available = false;

// ── In-memory fallback ──
const _memoryStore = new Map(); // userId → [{ content, timestamp }]

/**
 * Initialize Mem0 client.
 */
export async function initMem0() {
  try {
    const { Memory } = await import('@mem0/openclaw-mem0');
    if (Memory) {
      Mem0Client = new Memory({
        vectorStore: {
          provider: 'qdrant',
          config: {
            collectionName: 'mem0_facts',
            url: process.env.QDRANT_URL || 'http://localhost:6333',
          },
        },
        llm: {
          provider: 'openai',
          config: {
            apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
            model: 'openrouter/auto',
          },
        },
        embedder: {
          provider: 'google',
          config: {
            apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
            modelName: 'gemini-embedding-001',
          },
        },
      });
      mem0Available = true;
      logger.info('[Mem0] Initialized with Qdrant backend');
    }
  } catch (err) {
    logger.warn('[Mem0] Not available, using in-memory fallback:', err.message);
    mem0Available = false;
  }
}

/**
 * Add memory for a user.
 */
export async function addMemory(userId, content, metadata = {}) {
  if (mem0Available && Mem0Client) {
    try {
      await Mem0Client.add(content, { userId, metadata });
      return;
    } catch (err) {
      logger.warn('[Mem0] add failed, using fallback:', err.message);
    }
  }
  // Fallback
  if (!_memoryStore.has(userId)) _memoryStore.set(userId, []);
  _memoryStore.get(userId).push({ content, timestamp: Date.now(), metadata });
  // Keep last 50 memories per user
  const mems = _memoryStore.get(userId);
  if (mems.length > 50) mems.splice(0, mems.length - 50);
}

/**
 * Search memories for a user.
 */
export async function searchMemory(userId, query, limit = 5) {
  if (mem0Available && Mem0Client) {
    try {
      const results = await Mem0Client.search(query, { userId, limit });
      return results?.map(r => r.memory || r.content || '') || [];
    } catch (err) {
      logger.warn('[Mem0] search failed, using fallback:', err.message);
    }
  }
  // Fallback: simple keyword match
  const mems = _memoryStore.get(userId) || [];
  const lower = query.toLowerCase();
  return mems
    .filter(m => m.content.toLowerCase().includes(lower) || lower.includes(m.content.toLowerCase().slice(0, 20)))
    .slice(-limit)
    .map(m => m.content);
}

/**
 * Get all memories for a user.
 */
export async function getAllMemories(userId) {
  if (mem0Available && Mem0Client) {
    try {
      const results = await Mem0Client.getAll({ userId });
      return results?.map(r => r.memory || r.content || '') || [];
    } catch (err) {
      logger.warn('[Mem0] getAll failed, using fallback:', err.message);
    }
  }
  return (_memoryStore.get(userId) || []).map(m => m.content);
}

/**
 * Delete all memories for a user.
 */
export async function deleteMemories(userId) {
  if (mem0Available && Mem0Client) {
    try {
      await Mem0Client.deleteAll({ userId });
      return;
    } catch (err) {
      logger.warn('[Mem0] deleteAll failed:', err.message);
    }
  }
  _memoryStore.delete(userId);
}

export { mem0Available };
