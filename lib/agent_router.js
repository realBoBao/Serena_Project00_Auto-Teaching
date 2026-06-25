/**
 * lib/agent_router.js - Intent-to-Agent Router (Tier 3: Speed Up)
 *
 * Thay voi dung LLM de phan loai intent (token + latency),
 * dung embedding vector de map cau hoi → Agent nhanh hon.
 *
 * Usage:
 *   import { routeToAgent } from './lib/agent_router.js';
 *   const agent = await routeToAgent("Viet code Python tinh giai thua");
 *   // agent = { name: 'CoderAgent', confidence: 0.92 }
 *
 * @module lib/agent_router
 */

import { embedText, cosineSimilarity } from './embeddings.js';
import { getLogger } from './logger.js';

const logger = getLogger('AgentRouter');

// ── Agent Registry: Moi agent co mot tap cac mo ta (utterances) ──
const AGENT_REGISTRY = [
  {
    name: 'CoderAgent',
    intents: [
      'viet code', 'compile', 'debug', 'test code', 'algorithm',
      'write python', 'write javascript', 'write java', 'write c++',
      'fix bug', 'refactor code', 'code review', 'unit test',
    ],
  },
  {
    name: 'RagAgent',
    intents: [
      'tim kiem', 'search', 'find information', 'lookup',
      'search documents', 'find in database', 'query vectors',
      'search knowledge base', 'lookup data',
    ],
  },
  {
    name: 'AnalysisAgent',
    intents: [
      'phan tich', 'analyze', 'review code', 'check security',
      'performance analysis', 'code quality', 'audit',
      'detect vulnerability', 'scan code',
    ],
  },
  {
    name: 'PlannerAgent',
    intents: [
      'lap ke hoach', 'plan', 'roadmap', 'schedule',
      'project timeline', 'milestone', 'task breakdown',
      'learning path', 'study plan',
    ],
  },
  {
    name: 'DebateAgent',
    intents: [
      'tranh luan', 'debate', 'compare', 'pros and cons',
      'argument', 'discuss', 'evaluate options',
      'weigh options', 'compare approaches',
    ],
  },
  {
    name: 'VisionAgent',
    intents: [
      'xem anh', 'view image', 'image analysis', 'ocr',
      'read image', 'describe image', 'visual inspection',
      'screenshot analysis', 'photo recognition',
    ],
  },
  {
    name: 'ManimAgent',
    intents: [
      'tao animation', 'animate', 'video explanation',
      'math animation', 'visualize concept', 'create video',
      'motion graphics', 'explain with animation',
    ],
  },
  {
    name: 'SuggestionAgent',
    intents: [
      'goi y', 'suggest', 'recommend', 'what should i learn',
      'next step', 'learning suggestion', 'study tips',
      'career advice', 'skill recommendation',
    ],
  },
  {
    name: 'MentorAgent',
    intents: [
      'huong dan', 'mentor', 'teach me', 'explain',
      'how to learn', 'tutorial', 'guide me',
      'help me understand', 'walk me through',
    ],
  },
  {
    name: 'SecurityAuditor',
    intents: [
      'security audit', 'check vulnerability', 'penetration test',
      'security scan', 'find security issues', 'secure code review',
      'threat model', 'security assessment',
    ],
  },
];

// ── Cache: Embed vectors for all intents (computed once) ──
let _intentVectors = null;
let _agentNames = null;

async function _ensureVectors() {
  if (_intentVectors) return;

  logger.info('[AgentRouter] Computing intent vectors...');
  const startTime = Date.now();

  _intentVectors = [];
  _agentNames = [];

  for (const agent of AGENT_REGISTRY) {
    for (const intent of agent.intents) {
      try {
        const vector = await embedText(intent);
        _intentVectors.push(vector);
        _agentNames.push(agent.name);
      } catch (err) {
        logger.warn(`[AgentRouter] Failed to embed "${intent}":`, err.message);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[AgentRouter] ${_intentVectors.length} intent vectors computed in ${elapsed}ms`);
}

/**
 * Route a user query to the best matching agent.
 * @param {string} query - User's question/message
 * @param {number} [threshold=0.3] - Minimum cosine similarity to accept
 * @returns {Promise<{name: string, confidence: number, agent: Object}|null>}
 */
export async function routeToAgent(query, threshold = 0.3) {
  await _ensureVectors();

  try {
    const queryVector = await embedText(query);

    let bestScore = -1;
    let bestIndex = -1;

    for (let i = 0; i < _intentVectors.length; i++) {
      const score = cosineSimilarity(queryVector, _intentVectors[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestScore < threshold) {
      logger.debug(`[AgentRouter] No match for "${query.slice(0, 40)}..." (best: ${bestScore.toFixed(2)})`);
      return null;
    }

    const agentName = _agentNames[bestIndex];
    const agent = AGENT_REGISTRY.find(a => a.name === agentName);

    logger.debug(`[AgentRouter] "${query.slice(0, 40)}..." → ${agentName} (${bestScore.toFixed(2)})`);

    return {
      name: agentName,
      confidence: Math.round(bestScore * 100) / 100,
      agent,
    };
  } catch (err) {
    logger.error('[AgentRouter] routeToAgent error:', err.message);
    return null;
  }
}

/**
 * Get all registered agents.
 * @returns {Array<{name: string, intents: string[]}>}
 */
export function getRegisteredAgents() {
  return AGENT_REGISTRY.map(a => ({ name: a.name, intents: a.intents }));
}

export default { routeToAgent, getRegisteredAgents };
