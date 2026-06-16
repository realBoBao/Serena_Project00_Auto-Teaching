/**
 * lib/gap_router.js — Weighted Gap Routing (Tier 2)
 *
 * When user gets a flashcard wrong, propagates "gap penalty" up to parent
 * nodes in the knowledge graph via BFS traversal.
 *
 * This turns Serena from a flashcard reminder into a strategic advisor
 * who knows exactly where your foundational gaps are.
 *
 * @module lib/gap_router
 */
import { getLogger } from './logger.js';
import { getDb } from './knowledge_graph.js';
const logger = getLogger('GapRouter');

/**
 * Propagate gap penalty from a failed flashcard up through the knowledge graph.
 * Uses BFS to find all ancestor nodes and increase their "gap_score".
 *
 * @param {string} entityName — The entity/concept the user got wrong
 * @param {string} entityType — e.g. 'concept', 'algorithm', 'technology'
 * @param {number} penalty — Gap penalty amount (default 1.0)
 * @returns {Promise<{affected: number, ancestors: Array}>}
 */
export async function propagateGap(entityName, entityType = 'concept', penalty = 1.0) {
  const db = await getDb();
  const affected = [];
  const visited = new Set();

  // Find the entity
  const entity = await db.get('SELECT * FROM entities WHERE name = ? AND type = ?', entityName, entityType);
  if (!entity) {
    // Try fuzzy match by name
    const fuzzy = await db.get("SELECT * FROM entities WHERE name LIKE ?", `%${entityName}%`);
    if (!fuzzy) return { affected: 0, ancestors: [] };
    return propagateGapById(fuzzy.id, penalty, db, affected, visited);
  }

  return propagateGapById(entity.id, penalty, db, affected, visited);
}

async function propagateGapById(entityId, penalty, db, affected, visited) {
  // BFS upward through edges (find all ancestors)
  const queue = [{ id: entityId, level: 0 }];
  visited.add(entityId);

  // Increase gap_score on the failed entity itself
  await db.run(
    'UPDATE entities SET metadata = json_set(COALESCE(metadata, "{}"), "$.gap_score", COALESCE(json_extract(metadata, "$.gap_score"), 0) + ?), updated_at = datetime("now") WHERE id = ?',
    penalty, entityId
  );
  const entity = await db.get('SELECT name, type FROM entities WHERE id = ?', entityId);
  affected.push({ id: entityId, name: entity?.name, level: 0, penalty });

  // BFS: find all nodes that have an edge TO this node (prerequisites / parents)
  while (queue.length > 0) {
    const { id, level } = queue.shift();
    const parentPenalty = penalty * Math.pow(0.5, level + 1); // Decay by level

    if (parentPenalty < 0.01) break; // Stop when penalty becomes negligible

    // Find all edges where this node is the target (i.e., parents)
    const parents = await db.all(`
      SELECT e.* FROM entities e
      JOIN edges ON edges.source_id = e.id
      WHERE edges.target_id = ?
    `, id);

    for (const parent of parents) {
      if (visited.has(parent.id)) continue;
      visited.add(parent.id);

      await db.run(
        'UPDATE entities SET metadata = json_set(COALESCE(metadata, "{}"), "$.gap_score", COALESCE(json_extract(metadata, "$.gap_score"), 0) + ?), updated_at = datetime("now") WHERE id = ?',
        parentPenalty, parent.id
      );

      affected.push({ id: parent.id, name: parent.name, level: level + 1, penalty: parentPenalty });
      queue.push({ id: parent.id, level: level + 1 });
    }
  }

  logger.info(`[GapRouter] Propagated gap penalty ${penalty} for "${entity?.name}" → ${affected.length} nodes affected`);
  return { affected: affected.length, ancestors: affected };
}

/**
 * Get the top gap nodes — concepts the user is weakest at.
 * @param {number} [limit=5]
 * @returns {Promise<Array>}
 */
export async function getTopGaps(limit = 5) {
  try {
    const db = await getDb();
    return await db.all(`
      SELECT name, type, description,
             COALESCE(json_extract(metadata, '$.gap_score'), 0) as gap_score
      FROM entities
      WHERE json_extract(metadata, '$.gap_score') > 0
      ORDER BY gap_score DESC
      LIMIT ?
    `, limit);
  } catch { return []; }
}

/**
 * Generate a strategic advice message based on gap analysis.
 * @returns {Promise<string>}
 */
export async function generateGapAdvice() {
  const gaps = await getTopGaps(3);
  if (gaps.length === 0) return null;

  const lines = gaps.map((g, i) =>
    `${i + 1}. **${g.name}** (gap score: ${g.gap_score.toFixed(1)}) — ${g.description || 'Cần ôn tập thêm'}`
  );

  return `📊 **Phân tích lỗ hổng kiến thức:**\n\n${lines.join('\n')}\n\n💡 *Serena tự động thêm bài ôn tập cho các chủ đề yếu vào lịch học ngày mai.*`;
}

/**
 * Hook: Call this after a failed flashcard review to auto-propagate gaps.
 * @param {string} category — Flashcard category (maps to entity name)
 * @param {boolean} correct — Whether the answer was correct
 */
export async function onFlashcardReview(category, correct) {
  if (correct) return null; // No gap on correct answers

  try {
    const result = await propagateGap(category, 'concept', 1.0);
    if (result.affected > 1) {
      return generateGapAdvice();
    }
  } catch { /* ignore errors */ }
  return null;
}

export default { propagateGap, getTopGaps, generateGapAdvice, onFlashcardReview };
