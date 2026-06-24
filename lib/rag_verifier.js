/**
 * lib/rag_verifier.js — Output Grounding via Datalog verification (Tier 3)
 *
 * Orchestrates DatalogEngine + FactExtractor to verify RAG answers:
 * 1. Extract ground-truth facts from context chunks (verified source)
 * 2. Extract claims from the generated answer
 * 3. Run forward chaining with domain rules (transitivity, inheritance)
 * 4. Check each answer claim against derived facts
 * 5. Detect contradictions (e.g. deprecated + recommended for same entity)
 *
 * Key difference from ConfidenceScorer:
 *   - ConfidenceScorer: probabilistic self-check ("certainty: 0.7")
 *   - RagVerifier: deterministic logic proof ("claim X contradicts fact Y")
 *
 * Usage:
 *   import { RagVerifier } from './rag_verifier.js';
 *   const result = await RagVerifier.verify(answer, contextChunks);
 *   // result.status: 'VERIFIED' | 'PARTIAL' | 'UNGROUNDED' | 'CONTRADICTED'
 */

import { DatalogEngine } from './datalog_engine.js';
import { FactExtractor } from './fact_extractor.js';
import { getLogger } from './logger.js';

const logger = getLogger('RagVerifier');

/**
 * Predicate pairs that are mutually exclusive.
 * If both hold for the same entity → contradiction.
 */
const DEFAULT_EXCLUSIVE_PAIRS = [
  ['deprecated', 'recommended'],
];

export class RagVerifier {

  /**
   * Verify an answer against context chunks.
   *
   * @param {string} answer — the generated answer text
   * @param {Array} contextChunks — RAG search results (ground truth source)
   * @param {Object} options
   * @param {Array<[string, string]>} options.exclusivePairs — custom exclusive predicate pairs
   * @returns {Promise<{
   *   status: 'VERIFIED' | 'PARTIAL' | 'UNGROUNDED' | 'CONTRADICTED',
   *   verifiedCount: number,
   *   totalClaims: number,
   *   unverifiedClaims: string[],
   *   contradictions: Array<{entity: string, predicate: string, conflictsWith: string, args: string[]}>,
   * }>}
   */
  static async verify(answer, contextChunks, options = {}) {
    const engine = new DatalogEngine();
    const exclusivePairs = options.exclusivePairs || DEFAULT_EXCLUSIVE_PAIRS;

    // ─── Step 1: Extract facts from answer (claims to verify) ──────────────
    const answerFacts = await FactExtractor.extractFromAnswer(answer);

    // ─── Step 2: Extract ground-truth facts from context ────────────────────
    const groundTruthFacts = await FactExtractor.extractFromContext(contextChunks);

    // ─── Step 3: Load ground truth into engine ──────────────────────────────
    for (const f of groundTruthFacts) {
      engine.addFact(f.predicate, ...f.args);
    }

    // ─── Step 4: Add domain rules ───────────────────────────────────────────
    // Transitivity: if A is_a B and B is_a C → A is_a C
    engine.addRule('is_a', ['X', 'Z'], [
      { predicate: 'is_a', args: ['X', 'Y'] },
      { predicate: 'is_a', args: ['Y', 'Z'] },
    ]);

    // Inheritance: if X is_a Y and Y deprecated → X deprecated
    engine.addRule('deprecated', ['X'], [
      { predicate: 'is_a', args: ['X', 'Y'] },
      { predicate: 'deprecated', args: ['Y'] },
    ]);

    // Inheritance: if X is_a Y and Y recommended → X recommended
    engine.addRule('recommended', ['X'], [
      { predicate: 'is_a', args: ['X', 'Y'] },
      { predicate: 'recommended', args: ['Y'] },
    ]);

    // Part-of transitivity: if A part_of B and B part_of C → A part_of C
    engine.addRule('part_of', ['X', 'Z'], [
      { predicate: 'part_of', args: ['X', 'Y'] },
      { predicate: 'part_of', args: ['Y', 'Z'] },
    ]);

    // Run forward chaining
    const derived = engine.run();
    logger.info(`[RagVerifier] Derived ${derived} new facts from ${engine.factCount} total facts`);

    // ─── Step 5: Verify each answer claim ──────────────────────────────────
    const results = answerFacts.map(claim => {
      const verified = engine.query(claim.predicate, ...claim.args);
      return { ...claim, verified };
    });

    const verifiedCount = results.filter(r => r.verified).length;
    const unverifiedClaims = results
      .filter(r => !r.verified)
      .map(c => `${c.predicate}(${c.args.join(', ')})`);

    // ─── Step 6: Check for contradictions in knowledge base ────────────────
    const contradictions = engine.findContradictions(exclusivePairs);

    // ─── Step 7: Determine status ───────────────────────────────────────────
    let status;
    if (contradictions.length > 0) {
      status = 'CONTRADICTED';
    } else if (answerFacts.length === 0) {
      status = 'UNGROUNDED';
    } else if (verifiedCount === answerFacts.length) {
      status = 'VERIFIED';
    } else if (verifiedCount > 0) {
      status = 'PARTIAL';
    } else {
      status = 'UNGROUNDED';
    }

    logger.info(`[RagVerifier] Status: ${status} (${verifiedCount}/${answerFacts.length} claims verified, ${contradictions.length} contradictions)`);

    // ── Update tool reputation based on verification result ────────────────
    if (contextChunks && contextChunks.length > 0) {
      try {
        const { recordVerified, recordContradiction } = await import('./tool_reputation.js');
        // Extract source from context chunks (if available)
        const sources = new Set();
        for (const chunk of contextChunks) {
          if (chunk.source) sources.add(chunk.source);
          if (chunk.src) sources.add(chunk.src);
        }
        for (const src of sources) {
          if (status === 'VERIFIED') {
            recordVerified(src);
          } else if (status === 'CONTRADICTED') {
            recordContradiction(src);
          } else if (status === 'PARTIAL') {
            // Partial: reward verified, penalize contradicted
            if (verifiedCount > 0) recordVerified(src);
            if (contradictions.length > 0) recordContradiction(src);
          }
        }
      } catch { /* ignore — reputation module optional */ }
    }

    return {
      status,
      verifiedCount,
      totalClaims: answerFacts.length,
      unverifiedClaims,
      contradictions,
    };
  }
}
