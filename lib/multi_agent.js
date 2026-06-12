/**
 * ═══════════════════════════════════════════════════════════════
 * Multi-Agent Orchestrator — open-multi-agent integration
 * ═══════════════════════════════════════════════════════════════
 *
 * Điều phối nhiều agents cùng lúc cho complex tasks.
 * Ví dụ: "Phân tích + Code + Animation" → 3 agents chạy song song.
 */

import { getLogger } from './logger.js';
const logger = getLogger('MultiAgent');

/**
 * Spawn multiple agents in parallel for a complex task.
 * @param {Array} tasks - [{ agent: 'RagAgent'|'CoderAgent'|'ManimAgent', action, input }]
 * @param {Object} options - { timeout, onProgress }
 * @returns {Array} Results in same order as tasks
 */
export async function spawnAgents(tasks, options = {}) {
  const { timeout = 120000, onProgress } = options;
  const results = new Array(tasks.length);
  let completed = 0;

  const promises = tasks.map(async (task, i) => {
    try {
      const start = Date.now();
      const result = await _dispatchAgent(task);
      const duration = Date.now() - start;

      results[i] = { status: 'ok', result, duration, agent: task.agent };
      completed++;

      if (onProgress) {
        onProgress({ completed, total: tasks.length, agent: task.agent, duration });
      }

      logger.info(`[MultiAgent] ${task.agent} completed in ${duration}ms`);
    } catch (err) {
      results[i] = { status: 'error', error: err.message, agent: task.agent };
      completed++;
      logger.error(`[MultiAgent] ${task.agent} failed: ${err.message}`);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Dispatch một agent cụ thể.
 */
async function _dispatchAgent(task) {
  const { agent, action, input } = task;

  switch (agent) {
    case 'RagAgent': {
      const { answerQuestion } = await import('../agents/RagAgent.js');
      return await answerQuestion(input.query, input.options || {});
    }
    case 'CoderAgent': {
      const { solveWithDebugLoop } = await import('../agents/CoderAgent.js');
      return await solveWithDebugLoop(input.problem, input.opts || {});
    }
    case 'ManimAgent': {
      const { createAnimationAsync } = await import('../agents/ManimAgent.js');
      const { jobId, promise } = createAnimationAsync(input.description);
      return { jobId, result: await promise };
    }
    case 'PdfAgent': {
      const { processPdf } = await import('../agents/PdfAgent.js');
      return await processPdf(input.filePath);
    }
    case 'DebateAgent': {
      const { runDebate } = await import('../agents/DebateAgent.js');
      return await runDebate(input.problem, input.options || {});
    }
    case 'VisionAgent': {
      const { analyzeImageBuffer } = await import('../agents/VisionAgent.js');
      return await analyzeImageBuffer(input.imageBuffer, input.mimeType, input.prompt);
    }
    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

/**
 * Pipeline: Chạy agents tuần tự, output của agent này → input của agent kia.
 */
export async function pipeline(stages, initialInput = {}) {
  let context = { ...initialInput };
  const results = [];

  for (const stage of stages) {
    const input = typeof stage.input === 'function' ? stage.input(context) : { ...stage.input, ...context };
    const result = await _dispatchAgent({ agent: stage.agent, action: stage.action, input });
    results.push({ agent: stage.agent, result });
    context = { ...context, [`${stage.agent}Result`]: result };
  }

  return { results, context };
}
