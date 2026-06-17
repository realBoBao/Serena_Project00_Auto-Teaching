/**
 * Groq LPU Provider Tests — Tier 2
 *
 * Tests the Groq provider integration in the LLM fallback chain.
 * No actual API calls — tests module loading and ask() behavior.
 */
import { describe, test, expect } from '@jest/globals';

describe('Groq Provider — module integration', () => {
  test('llm.js loads without errors after Groq addition', async () => {
    const llm = await import('../lib/llm.js');
    expect(llm.ask).toBeDefined();
    expect(llm.askWithContext).toBeDefined();
    expect(typeof llm.ask).toBe('function');
  });

  test('ask() with provider="groq" falls through gracefully without API key', async () => {
    const { ask } = await import('../lib/llm.js');
    // Without GROQ_API_KEY, Groq provider returns null → falls through to next provider
    const result = await ask('test', { provider: 'groq', maxTokens: 10 });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('provider');
  });

  test('ask() default chain works (Groq is first, falls through)', async () => {
    const { ask } = await import('../lib/llm.js');
    const result = await ask('hello', { maxTokens: 10 });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('provider');
    expect(['groq', 'openrouter', 'gemini', 'local', 'static']).toContain(result.provider);
  });


  test('ask() returns result with answer property', async () => {
    const { ask } = await import('../lib/llm.js');
    const result = await ask('What is 2+2?', { maxTokens: 50 });
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('provider');
    // answer may be string or object (static fallback returns object in some cases)
    expect(result.answer).toBeDefined();
  });
});
