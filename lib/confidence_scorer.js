/**
 * Confidence Scorer — 4-signal confidence scoring for RAG pipeline
 *
 * Signals:
 *   1. Retrieval  (0.40) — cosine similarity from vector search
 *   2. Consensus  (0.25) — shadow execution Jaccard similarity
 *   3. Source     (0.20) — collection tier + freshness
 *   4. SelfCheck  (0.15) — LLM self-evaluation (only when signals conflict)
 *
 * Usage:
 *   import { ConfidenceScorer } from './confidence_scorer.js';
 *   const confidence = await ConfidenceScorer.compute({ question, answer, searchResults, jaccardSim });
 */

import { ask } from './llm.js';

// ─── Signal Weights ──────────────────────────────────────────────────────────
const WEIGHTS = {
  retrieval: 0.40,
  consensus: 0.25,
  source:    0.20,
  selfCheck: 0.15,
};

// ─── Action Thresholds ──────────────────────────────────────────────────────
const THRESHOLDS = {
  HIGH:     0.75,  // Answer normally
  MEDIUM:   0.50,  // Answer with mild warning
  LOW:      0.30,  // Clear warning + offer help
  // < 0.30 → very_low: refuse to answer, send fallback
};

// ─── Collection Tier Scores ─────────────────────────────────────────────────
const COLLECTION_TIER = {
  'academic-docs': 1.0,
  'academic':      1.0,
  'daily-memory':  0.70,
  'daily':         0.70,
  'system-logs':   0.50,
  'system':        0.50,
};

// ─── Self-check prompt template ─────────────────────────────────────────────
const SELF_CHECK_PROMPT = (question, answer, contextSummary) => `Bạn vừa tạo ra câu trả lời này:
---
${answer.slice(0, 600)}
---

Dựa vào các đoạn context sau:
${contextSummary}

Câu hỏi gốc: "${question}"

Hãy đánh giá: câu trả lời có dựa trực tiếp vào context không, hay bạn đang suy diễn/bịa thêm?

Trả về JSON:
{
  "grounded": true|false,
  "certainty": 0.0-1.0,
  "unsupported_claims": ["claim nào không có trong context"]
}

Chỉ JSON, không có gì khác.`;

export class ConfidenceScorer {

  // ─── Signal 1: Retrieval Score ───────────────────────────────────────────
  // Input: array of search results with .score (cosine similarity from Qdrant/SQLite)
  static computeRetrievalScore(searchResults) {
    if (!searchResults?.length) return 0.15;

    const scores = searchResults.map(r => {
      // Support both Qdrant payload format and SQLite format
      const score = r.score ?? r._score ?? r.similarity ?? r.payload?.score ?? 0;
      return typeof score === 'number' ? score : 0;
    });

    const topScore = Math.max(...scores);

    // Count how many results are "good" (>= 0.60 cosine similarity)
    const highScores = scores.filter(s => s >= 0.60);
    const coverage = Math.min(highScores.length / 3, 1.0); // max at 3 good results

    // Combine: top score (70%) + coverage (30%)
    return (topScore * 0.70) + (coverage * 0.30);
  }

  // ─── Signal 2: Shadow Consensus ─────────────────────────────────────────
  // Input: jaccardSim from shadow_executor.js (0-1, already available)
  static computeConsensusScore(jaccardSim) {
    if (jaccardSim === null || jaccardSim === undefined) {
      return 0.5; // No shadow execution → neutral, no penalty
    }
    return Math.max(0, Math.min(1, jaccardSim)); // Clamp to [0, 1]
  }

  // ─── Signal 3: Source Quality ───────────────────────────────────────────
  // Input: array of search results with metadata
  static computeSourceScore(searchResults) {
    if (!searchResults?.length) return 0.3;

    // Tier score by collection
    const tierScores = searchResults.map(r => {
      const collection = r.payload?.collection
        ?? r.collection
        ?? r.payload?.source_collection
        ?? 'unknown';
      return COLLECTION_TIER[collection] ?? 0.40;
    });

    const avgTier = tierScores.reduce((a, b) => a + b, 0) / tierScores.length;

    // Freshness: prefer chunks indexed within last 30 days
    const now = Date.now();
    const freshnessScores = searchResults.map(r => {
      const indexedAt = r.payload?.indexed_at
        ?? r.payload?.added_at
        ?? r.indexed_at
        ?? r.added_at;
      if (!indexedAt) return 0.5;
      try {
        const ageDays = (now - new Date(indexedAt).getTime()) / 86_400_000;
        return ageDays < 30 ? 1.0 : ageDays < 90 ? 0.7 : ageDays < 365 ? 0.4 : 0.2;
      } catch {
        return 0.5;
      }
    });

    const avgFreshness = freshnessScores.length > 0
      ? freshnessScores.reduce((a, b) => a + b, 0) / freshnessScores.length
      : 0.5;

    // 70% tier + 30% freshness
    return (avgTier * 0.70) + (avgFreshness * 0.30);
  }

  // ─── Signal 4: LLM Self-Check (only called when signals conflict) ───────
  static async computeSelfCheckScore(question, answer, contextChunks) {
    const contextSummary = (contextChunks || [])
      .slice(0, 3)
      .map((c, i) => {
        const text = c.payload?.text ?? c.text ?? c.chunk_text ?? '';
        return `[${i + 1}] ${String(text).slice(0, 200)}`;
      })
      .join('\n');

    if (!contextSummary.trim()) {
      return { score: 0.5, unsupportedClaims: [] };
    }

    const prompt = SELF_CHECK_PROMPT(question, answer, contextSummary);

    try {
      const raw = await ask(prompt, { maxTokens: 200, temperature: 0.1 });
      const clean = raw.replace(/```json|```/g, '').trim();
      // Extract JSON from response
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd < jsonStart) {
        return { score: 0.5, unsupportedClaims: [] };
      }
      const result = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
      return {
        score: result.grounded ? (result.certainty ?? 0.5) : (result.certainty ?? 0.5) * 0.4,
        unsupportedClaims: result.unsupported_claims ?? [],
      };
    } catch {
      return { score: 0.5, unsupportedClaims: [] };
    }
  }

  // ─── Main Aggregator ────────────────────────────────────────────────────
  static async compute(params) {
    const {
      question,
      answer,
      searchResults = [],
      jaccardSim = null,
      skipSelfCheck = false,
    } = params;

    const s1 = this.computeRetrievalScore(searchResults);
    const s2 = this.computeConsensusScore(jaccardSim);
    const s3 = this.computeSourceScore(searchResults);

    // Determine if LLM self-check is needed:
    // 1. Signals disagree strongly (spread > 0.35), OR
    // 2. Preliminary score is in uncertain zone (0.45-0.70)
    const prelimScore = s1 * WEIGHTS.retrieval + s2 * WEIGHTS.consensus + s3 * WEIGHTS.source;
    const signalSpread = Math.max(s1, s2, s3) - Math.min(s1, s2, s3);
    const needSelfCheck = !skipSelfCheck
      && answer
      && (signalSpread > 0.35 || (prelimScore > 0.45 && prelimScore < 0.70));

    let s4 = 0.5; // Default neutral
    let unsupportedClaims = [];

    if (needSelfCheck) {
      const selfCheck = await this.computeSelfCheckScore(question, answer, searchResults);
      s4 = selfCheck.score;
      unsupportedClaims = selfCheck.unsupportedClaims;
    }

    // Weighted combination
    const score = needSelfCheck
      ? s1 * WEIGHTS.retrieval + s2 * WEIGHTS.consensus + s3 * WEIGHTS.source + s4 * WEIGHTS.selfCheck
      : prelimScore / (WEIGHTS.retrieval + WEIGHTS.consensus + WEIGHTS.source); // Normalize without selfCheck weight

    const level = score >= THRESHOLDS.HIGH ? 'high'
      : score >= THRESHOLDS.MEDIUM ? 'medium'
      : score >= THRESHOLDS.LOW ? 'low'
      : 'very_low';

    return {
      score: Math.round(score * 1000) / 1000, // Round to 3 decimals
      level,
      signals: {
        retrieval: Math.round(s1 * 1000) / 1000,
        consensus: Math.round(s2 * 1000) / 1000,
        source: Math.round(s3 * 1000) / 1000,
        selfCheck: Math.round(s4 * 1000) / 1000,
      },
      unsupportedClaims,
      usedSelfCheck: needSelfCheck,
    };
  }

  // ─── Discord suffix formatter ────────────────────────────────────────────
  static formatDiscordSuffix(confidence) {
    const { score, level, unsupportedClaims } = confidence;
    const pct = Math.round(score * 100);

    if (level === 'high') return ''; // No suffix needed

    if (level === 'medium') {
      return `\n\n> ⚠️ **Độ tin cậy ~${pct}%** — Tôi khá chắc về câu trả lời này nhưng bạn nên kiểm tra lại từ tài liệu gốc.`;
    }

    if (level === 'low') {
      const claimsNote = unsupportedClaims.length > 0
        ? ` Các điểm chưa chắc chắn: *${unsupportedClaims.slice(0, 2).join(', ')}*.`
        : '';
      return `\n\n> ⚠️ **Độ tin cậy thấp (~${pct}%)** — Tôi không tìm thấy đủ tài liệu liên quan trong knowledge base.${claimsNote}\n> Gõ \`!search \` để tôi tìm thêm hoặc \`!pdf\` để upload tài liệu mới.`;
    }

    // very_low → return null (caller should not send answer)
    return null;
  }
}

export default ConfidenceScorer;
