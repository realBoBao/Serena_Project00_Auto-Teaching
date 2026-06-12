/**
 * SocraticAgent — Unit Tests
 * Tests logic không cần LLM: shouldUseSocratic, isConfusedSignal
 */

import { SocraticAgent } from '../agents/SocraticAgent.js';

// ── Mock flashcard_db module ──
// SocraticAgent uses getFlashcardDb() which does require('../lib/flashcard_db.js')
// We mock the module via jest.mock

// Mock flashcard_db
jest.mock('../lib/flashcard_db.js', () => {
  return {
    __esModule: true,
    default: { prepare: () => ({ get: () => mockDb }) },
    getDb: () => ({ prepare: () => ({ get: () => mockDb }) }),
  };
});

// Mock session_store
jest.mock('../lib/session_store.js', () => {
  return {
    __esModule: true,
    default: {
      get: async (key) => mockSessions[key] || null,
      set: async (key, val, ttl) => { mockSessions[key] = val; },
      del: async (key) => { delete mockSessions[key]; },
    },
    sessionStore: {
      get: async (key) => mockSessions[key] || null,
      set: async (key, val, ttl) => { mockSessions[key] = val; },
      del: async (key) => { delete mockSessions[key]; },
    },
  };
});

let mockDb = null;
const mockSessions = {};

describe('SocraticAgent — shouldUseSocratic', () => {
  test('returns false when no flashcards exist', () => {
    mockDb = { prepare: () => ({ get: () => null }) };
    expect(SocraticAgent.shouldUseSocratic('user1', 'binary search')).toBe(false);
  });

  test('returns false when accuracy < 60%', () => {
    mockDb = { prepare: () => ({ get: () => ({ total: 10, correct: 3, reviews: 5 }) }) };
    expect(SocraticAgent.shouldUseSocratic('user1', 'binary search')).toBe(false);
  });

  test('returns false when reviews < 3', () => {
    mockDb = { prepare: () => ({ get: () => ({ total: 10, correct: 8, reviews: 1 }) }) };
    expect(SocraticAgent.shouldUseSocratic('user1', 'binary search')).toBe(false);
  });

  test('returns true when accuracy >= 60% AND reviews >= 3', () => {
    mockDb = { prepare: () => ({ get: () => ({ total: 10, correct: 7, reviews: 5 }) }) };
    expect(SocraticAgent.shouldUseSocratic('user1', 'binary search')).toBe(true);
  });

  test('returns true at exact threshold (60% accuracy, 3 reviews)', () => {
    mockDb = { prepare: () => ({ get: () => ({ total: 10, correct: 6, reviews: 3 }) }) };
    expect(SocraticAgent.shouldUseSocratic('user1', 'binary search')).toBe(true);
  });

  test('returns false when topic is empty', () => {
    mockDb = { prepare: () => ({ get: () => ({ total: 10, correct: 10, reviews: 10 }) }) };
    expect(SocraticAgent.shouldUseSocratic('user1', '')).toBe(false);
  });

  test('returns false when topic is null', () => {
    mockDb = { prepare: () => ({ get: () => ({ total: 10, correct: 10, reviews: 10 }) }) };
    expect(SocraticAgent.shouldUseSocratic('user1', null)).toBe(false);
  });
});

describe('SocraticAgent — isConfusedSignal', () => {
  test('detects Vietnamese confused signals', () => {
    expect(SocraticAgent.isConfusedSignal('không biết')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('chịu rồi')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('bó tay')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('không hiểu gì')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('mù tịt')).toBe(true);
  });

  test('detects escape commands', () => {
    expect(SocraticAgent.isConfusedSignal('!explain')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('skip')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('hint đi')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('nói thẳng đi')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('giải thích đi')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('trả lời đi')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('thôi nói luôn đi')).toBe(true);
  });

  test('detects short/empty responses', () => {
    expect(SocraticAgent.isConfusedSignal('')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('ok')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('??')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('???')).toBe(true);
  });

  test('does not flag normal answers', () => {
    expect(SocraticAgent.isConfusedSignal('binary search tìm kiếm bằng cách chia đôi mảng')).toBe(false);
    expect(SocraticAgent.isConfusedSignal('O(log n)')).toBe(false);
    expect(SocraticAgent.isConfusedSignal('dùng hash map để tìm kiếm O(1)')).toBe(false);
    expect(SocraticAgent.isConfusedSignal('theo tôi thì đáp án là quicksort')).toBe(false);
  });

  test('detects English confused signals', () => {
    expect(SocraticAgent.isConfusedSignal('wtf')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('help')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('cứu')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('bó đi')).toBe(true);
    expect(SocraticAgent.isConfusedSignal('huhu')).toBe(true);
  });
});

describe('SocraticAgent — evaluateAnswer (fallback heuristic)', () => {
  test('returns confused for very short answers', async () => {
    const result = await SocraticAgent.evaluateAnswer('binary search', 'what is it?', 'ok');
    expect(result.quality).toBe('confused');
  });

  test('returns partial for medium-length answers', async () => {
    const result = await SocraticAgent.evaluateAnswer('binary search', 'what is it?', 'là thuật toán tìm kiếm');
    expect(result.quality).toBe('partial');
  });
});
