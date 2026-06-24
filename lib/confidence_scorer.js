/**
 * lib/confidence_scorer.js — Confidence scoring for RAG answers
 * Combines multiple signals into a 0-1 confidence score.
 * @module lib/confidence_scorer
 */

/**
 * Score answer confidence based on search results and answer quality.
 * @param {Object} params
 * @param {string} params.question — Original question
 * @param {string} params.answer — Generated answer
 * @param {Array} params.results — Search results with .score
 * @param {number} params.jaccardSim — Jaccard similarity of query vs context
 * @param {boolean} params.skipSelfCheck — Skip self-consistency check
 * @param {string} [params.source] — Source name (e.g. 'HN', 'GitHub', 'cached')
 * @param {string} [params.topic] — Topic/skill context
 * @returns {{ score: number, level: string, reasons: string[] }}
 */
export async function scoreConfidence({ question, answer, results = [], jaccardSim = 0, skipSelfCheck = false, source, topic }) {
  const reasons = [];
  let score = 0.5; // baseline

  // Signal 1: Search result quality
  if (results.length > 0) {
    const avgScore = results.reduce((s, r) => s + (r.score || 0), 0) / results.length;
    score += avgScore * 0.2;
    if (avgScore > 0.7) reasons.push('high_search_relevance');
  } else {
    score -= 0.2;
    reasons.push('no_search_results');
  }

  // Signal 2: Answer length (too short = low confidence)
  if (answer.length < 50) {
    score -= 0.15;
    reasons.push('answer_too_short');
  } else if (answer.length > 200) {
    score += 0.05;
    reasons.push('answer_substantial');
  }

  // Signal 3: Source citation
  if (/source|according to|dựa trên|theo nguồn/i.test(answer)) {
    score += 0.1;
    reasons.push('has_citation');
  }

  // Signal 4: Jaccard similarity
  score += jaccardSim * 0.1;

  // Signal 5: Uncertainty markers
  if (/không tìm thấy|không có dữ liệu|không đủ|could not find|not found/i.test(answer)) {
    score -= 0.3;
    reasons.push('uncertainty_detected');
  }

  // Signal 6: Tool/Source reputation (Skill-Conditional Trust)
  if (source) {
    try {
      const { getTrustScore } = await import('./tool_reputation.js');
      const trust = getTrustScore(source, topic);
      // Map trust 0.1–1.0 → adjustment -0.15 to +0.15
      const trustAdj = (trust - 0.5) * 0.3;
      score += trustAdj;
      if (trust < 0.3) reasons.push(`low_source_trust(${source})`);
      else if (trust > 0.8) reasons.push(`high_source_trust(${source})`);
    } catch { /* ignore — reputation module optional */ }
  }

  // Clamp
  score = Math.max(0, Math.min(1, score));

  const level = score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low';

  return { score: Math.round(score * 100) / 100, level, reasons };
}

/**
 * Format confidence suffix for Discord message.
 */
export function formatConfidenceSuffix({ score, level, reasons = [] }) {
  const trustInfo = reasons.find(r => r.includes('source_trust'));
  const trustLine = trustInfo
    ? `\n📊 Source trust: ${trustInfo.includes('low') ? '🔴 Thấp' : '🟢 Cao'}`
    : '';
  if (level === 'high') return `\n\n✅ Độ tin cậy: Cao${trustLine}`;
  if (level === 'medium') return `\n\n⚠️ Độ tin cậy: Trung bình${trustLine}`;
  return `\n\n❌ Độ tin cậy: Thấp — nên kiểm tra lại nguồn khác${trustLine}`;
}

export default { scoreConfidence, formatConfidenceSuffix };
