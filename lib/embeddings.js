/**
 * lib/embeddings.js — Embedding via OpenRouter (fallback from Gemini API)
 *
 * Dùng OpenRouter thay vì Gemini API trực tiếp để tránh bug với Google AI Studio key (AQ format).
 * OpenRouter hỗ trợ nhiều embedding models: google/gemini-embedding-001, openai/text-embedding-3-small, v.v.
 */

import 'dotenv/config';
import { getCachedEmbedding, setCachedEmbedding } from './embedding_cache.js';

const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

/**
 * Embed a single text with cache-first strategy.
 */
export async function embedText(text) {
  // Check cache first
  const cached = await getCachedEmbedding(text);
  if (cached) return cached;

  // Call OpenRouter embedding API
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Embedding API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error('Embedding empty from API');
  }

  const result = new Float32Array(embedding);
  // Store in cache (fire-and-forget)
  setCachedEmbedding(text, result).catch(() => {});
  return result;
}

/**
 * Batch embed multiple texts efficiently.
 */
export async function embedTextsBatch(texts) {
  if (!texts || !Array.isArray(texts)) return [];
  const results = [];
  for (const text of texts) {
    try {
      const emb = await embedText(text);
      results.push(emb);
    } catch (err) {
      console.error(`[Embeddings] Batch error: ${err.message}`);
      results.push(new Float32Array(3072)); // zero vector fallback
    }
  }
  return results;
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export default { embedText, embedTextsBatch, cosineSimilarity };
