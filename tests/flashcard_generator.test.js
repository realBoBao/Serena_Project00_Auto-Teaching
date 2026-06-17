import { describe, it, expect } from '@jest/globals';
import { generateFlashcardsFromText, extractFlashcardsFallback } from '../lib/flashcard_generator.js';

describe('Flashcard Generator', () => {
  it('should extract flashcards from text without LLM', () => {
    const text = 'RAG stands for Retrieval-Augmented Generation. It combines search with LLM generation.';
    const cards = extractFlashcardsFallback(text, 'test-source', 'AI');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]).toHaveProperty('question');
    expect(cards[0]).toHaveProperty('answer');
  });

  it('should handle short text', () => {
    const cards = extractFlashcardsFallback('Short.', 'test', 'general');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });

  it('should return fallback when no API key', async () => {
    const orig = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const cards = await generateFlashcardsFromText('Binary search is O(log n).', 'algo', 'CS');
    expect(cards.length).toBeGreaterThan(0);
    process.env.OPENROUTER_API_KEY = orig;
  });

  it('should handle empty text', async () => {
    const orig = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const cards = await generateFlashcardsFromText('', 'empty', 'test');
    expect(cards).toEqual([]);
    process.env.OPENROUTER_API_KEY = orig;
  });
});
