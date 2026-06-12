/**
 * ═══════════════════════════════════════════════════════════════
 * Last30Days Skill — Auto-ingest recent activity
 * ═══════════════════════════════════════════════════════════════
 *
 * Tự động nghiên cứu topic từ 30 ngày gần nhất trên Reddit + X + Web,
 * trở thành chuyên gia, và tạo copy-paste-ready prompts.
 */

import { getLogger } from './logger.js';
const logger = getLogger('Last30Days');

/**
 * Research a topic from the last 30 days.
 * @param {string} topic - Topic to research
 * @returns {{ summary: string, sources: string[], prompts: string[] }}
 */
export async function researchTopic(topic) {
  logger.info(`[Last30Days] Researching: ${topic}`);

  try {
    const { research } = await import('@polyskill/mvanhorn.last30days-skill');
    if (research) {
      const result = await research(topic);
      return {
        summary: result.summary || result.content || '',
        sources: result.sources || [],
        prompts: result.prompts || [],
      };
    }
  } catch (err) {
    logger.warn('[Last30Days] Package not available, using fallback:', err.message);
  }

  // Fallback: dùng RagAgent để search
  try {
    const { answerQuestion } = await import('../agents/RagAgent.js');
    const result = await answerQuestion(
      `Latest developments about ${topic} in the last 30 days`,
      { sources: ['reddit', 'twitter', 'web'] }
    );
    return {
      summary: result.answer || '',
      sources: result.sources || [],
      prompts: [],
    };
  } catch {
    return { summary: '', sources: [], prompts: [] };
  }
}
