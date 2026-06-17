/**
 * Groq LPU Provider Tests — Tier 2
 *
 * Tests the Groq provider integration in the LLM fallback chain.
 * No actual API calls — tests module loading and factory behavior.
 */
import { describe, test, expect } from '@jest/globals';

describe('Groq Provider — module integration', () => {
  test('llm.js loads without errors after Groq addition', async () => {
    const llm = await import('../lib/llm.js');
    expect(llm.ask).toBeDefined();
    expect(llm.askWithContext).toBeDefined();
    expect(typeof llm.ask).toBe('function');
  });

  test('createGroqLlm is exported and is a function', async () => {
    const { createGroqLlm } = await import('../lib/llm.js');
    expect(typeof createGroqLlm).toBe('function');
  });

  test('createGroqLlm returns null when GROQ_API_KEY is not set', async () => {
    const { createGroqLlm } = await import('../lib/llm.js');
    const llm = createGroqLlm();
    expect(llm).toBeNull();
  });

  test('createGroqLlm does not throw with model option', async () => {
    const { createGroqLlm } = await import('../lib/llm.js');
    expect(() => createGroqLlm({ model: 'llama-3.3-70b-versatile' })).not.toThrow();
  });
});
