/**
 * lib/langchain_bridge.js - LangChain lazy bridge
 *
 * Dung dynamic import de tranh loi "X is not defined" tren VPS.
 * Chi load LangChain khi can thiet.
 *
 * @module lib/langchain_bridge
 */

let _cache = null;

async function _load() {
  if (_cache) return _cache;
  try {
    const mod = await import('@langchain/core/messages');
    _cache = {
      HumanMessage: mod.HumanMessage,
      SystemMessage: mod.SystemMessage,
      AIMessage: mod.AIMessage,
      ChatMessage: mod.ChatMessage,
    };
    return _cache;
  } catch (err) {
    // Fallback: return stubs if LangChain not installed
    return {
      HumanMessage: class HumanMessage { constructor(content) { this.content = content; } },
      SystemMessage: class SystemMessage { constructor(content) { this.content = content; } },
      AIMessage: class AIMessage { constructor(content) { this.content = content; } },
      ChatMessage: class ChatMessage { constructor(content, role) { this.content = content; this.role = role; } },
    };
  }
}

// Export as sync functions that return promises
export async function getHumanMessage(content) {
  const m = await _load();
  return new m.HumanMessage(content);
}

export async function getSystemMessage(content) {
  const m = await _load();
  return new m.SystemMessage(content);
}

export async function getAIMessage(content) {
  const m = await _load();
  return new m.AIMessage(content);
}

// Re-export for backward compat (async)
export const HumanMessage = new Proxy({}, {
  get: async (_, prop) => {
    const m = await _load();
    return m.HumanMessage[prop];
  },
  construct: async (_, args) => {
    const m = await _load();
    return new m.HumanMessage(...args);
  },
});

export default { getHumanMessage, getSystemMessage, getAIMessage, HumanMessage };
