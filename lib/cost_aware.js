/**
 * lib/cost_aware.js — Query complexity classification
 * Phân loại độ phức tạp của query để quyết định có cần LLM hay không.
 */

/**
 * Phân loại độ phức tạp của query.
 * @param {string} query
 * @returns {'simple'|'medium'|'complex'}
 */
export function classifyQueryComplexity(query) {
  if (!query) return 'simple';

  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).length;

  // Complex indicators
  const complexKeywords = [
    'explain', 'analyze', 'compare', 'design', 'architecture',
    'implement', 'debug', 'optimize', 'refactor', 'review',
    'how does', 'why does', 'what is the difference',
  ];

  const isComplex = complexKeywords.some(kw => lower.includes(kw)) || words > 20;
  const isSimple = words <= 5 && !isComplex;

  if (isSimple) return 'simple';
  if (isComplex) return 'complex';
  return 'medium';
}

/**
 * Estimate token cost cho query.
 * @param {string} query
 * @returns {number} Estimated tokens
 */
export function estimateTokenCost(query) {
  if (!query) return 0;
  // Rough estimate: 1 token ≈ 4 chars (English) or ≈ 1.5 chars (Vietnamese)
  return Math.ceil(query.length / 3);
}

export default { classifyQueryComplexity, estimateTokenCost };
