/**
 * Learning Path Generator — Phase 26
 *
 * Generates ordered learning paths by combining:
 * 1. Knowledge Graph (prerequisite edges + BFS traversal)
 * 2. Flashcard DB (spaced repetition stats per topic)
 * 3. Topological sort (Kahn's algorithm) for correct learning order
 *
 * Usage:
 *   import { LearningPathGenerator } from './learning_path.js';
 *   const path = await LearningPathGenerator.generate('user123', 'distributed systems');
 *
 * @module lib/learning_path
 */

import { getDb as getKgDb, searchEntities, upsertEntity, addRelationship } from './knowledge_graph.js';
import { getDb as getFlashDb } from './flashcard_db.js';
import { ask } from './llm.js';

// ─── Status Thresholds ──────────────────────────────────────────────────────
const STATUS = {
  MASTERED:    { minAccuracy: 0.80, minReviews: 5, label: 'mastered',    icon: '✅', bar: '█' },
  LEARNING:    { minAccuracy: 0.50, minReviews: 2, label: 'learning',    icon: '📘', bar: '▓' },
  WEAK:        { minAccuracy: 0.00, minReviews: 1, label: 'weak',        icon: '⚠️', bar: '░' },
  NOT_STARTED: { minAccuracy: 0.00, minReviews: 0, label: 'not started', icon: '⬜', bar: '·' },
};

const PREREQ_RELATIONS = ['prerequisite', 'requires', 'depends_on'];

export class LearningPathGenerator {

  static async generate(userId, goalTopic, options = {}) {
    const { maxDepth = 6, maxNodes = 20 } = options;
    try {
      const rootNode = await this._findTopicNode(goalTopic);
      if (!rootNode) {
        return { error: `Không tìm thấy "${goalTopic}" trong Knowledge Graph. Thử \`!path\` với topic cụ thể hơn.` };
      }
      const subgraph = await this._buildPrerequisiteSubgraph(rootNode.id, maxDepth, maxNodes);
      const orderedNodes = this._topoSort(subgraph);
      const hasCycle = !orderedNodes;
      const finalOrder = hasCycle
        ? [...subgraph.nodes.values()].sort((a, b) => (a.level || 0) - (b.level || 0))
        : orderedNodes;
      return await this._buildResult(userId, goalTopic, finalOrder, subgraph, hasCycle);
    } catch (err) {
      console.error('[LearningPath] Error:', err.message);
      return { error: `Lỗi tạo lộ trình: ${err.message}` };
    }
  }

  static async _findTopicNode(topic) {
    const db = await getKgDb();
    const lower = topic.toLowerCase().trim();
    let row = await db.get('SELECT id, name, type FROM entities WHERE LOWER(name) = ? LIMIT 1', lower);
    if (!row) {
      row = await db.get('SELECT id, name, type FROM entities WHERE LOWER(name) LIKE ? OR LOWER(name) LIKE ? LIMIT 1', `%${lower}%`, `${lower}%`);
    }
    if (!row) {
      const aliasMatch = await db.get('SELECT e.id, e.name, e.type FROM entities e JOIN entity_aliases ea ON ea.entity_id = e.id WHERE LOWER(ea.alias) = ? LIMIT 1', lower);
      row = aliasMatch;
    }
    return row || null;
  }

  static async _buildPrerequisiteSubgraph(rootId, maxDepth, maxNodes) {
    const db = await getKgDb();
    const nodes = new Map();
    const edges = [];
    const queue = [{ id: rootId, level: 0 }];
    const visited = new Set();

    while (queue.length > 0 && nodes.size < maxNodes) {
      const { id, level } = queue.shift();
      if (visited.has(id) || level > maxDepth) continue;
      visited.add(id);

      const node = await db.get('SELECT id, name, type FROM entities WHERE id = ?', id);
      if (!node) continue;
      nodes.set(id, { ...node, level, prerequisites: [] });
      if (level >= maxDepth) continue;

      const prereqs = await db.all(
        `SELECT e.id, e.name, e.type, eg.relation FROM edges eg JOIN entities e ON e.id = eg.source_id WHERE eg.target_id = ? AND eg.relation IN (${PREREQ_RELATIONS.map(() => '?').join(',')}) LIMIT ?`,
        [id, ...PREREQ_RELATIONS, maxNodes - nodes.size]
      );
      for (const p of prereqs) {
        edges.push({ from: p.id, to: id, type: p.relation });
        const existingNode = nodes.get(id);
        if (existingNode) existingNode.prerequisites.push(p.id);
        if (!visited.has(p.id)) queue.push({ id: p.id, level: level + 1 });
      }

      const subtopics = await db.all(
        `SELECT e.id, e.name, e.type FROM edges eg JOIN entities e ON e.id = eg.target_id WHERE eg.source_id = ? AND eg.relation = 'part_of' LIMIT ?`,
        [id, maxNodes - nodes.size]
      );
      for (const s of subtopics) {
        if (!visited.has(s.id)) {
          edges.push({ from: id, to: s.id, type: 'part_of' });
          queue.push({ id: s.id, level: level + 1 });
        }
      }
    }
    return { nodes, edges, rootId };
  }

  static _topoSort({ nodes, edges }) {
    const inDegree = new Map();
    const adjList = new Map();
    for (const id of nodes.keys()) { inDegree.set(id, 0); adjList.set(id, []); }
    for (const { from, to } of edges) {
      if (nodes.has(from) && nodes.has(to)) {
        adjList.get(from).push(to);
        inDegree.set(to, (inDegree.get(to) || 0) + 1);
      }
    }
    const queue = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
    const sorted = [];
    while (queue.length > 0) {
      queue.sort((a, b) => (nodes.get(a)?.level || 0) - (nodes.get(b)?.level || 0));
      const id = queue.shift();
      sorted.push(nodes.get(id));
      for (const neighbor of adjList.get(id) || []) {
        const newDeg = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
    if (sorted.length < nodes.size) return null;
    return sorted;
  }

  static async _buildResult(userId, goalTopic, orderedNodes, subgraph, hasCycle) {
    const flashDb = await getFlashDb();
    const enriched = [];
    for (const node of orderedNodes) {
      const topicPattern = `%${node.name.toLowerCase()}%`;
      const stats = await flashDb.get(
        `SELECT COUNT(*) AS total, SUM(review_count) AS reviews, SUM(correct_count) AS correct, MAX(updated_at) AS last_seen, MIN(next_review) AS next_due FROM flashcards WHERE (LOWER(question) LIKE ? OR LOWER(category) LIKE ?)`,
        topicPattern, topicPattern
      );
      const totalReviews = stats?.reviews || 0;
      const correctCount = stats?.correct || 0;
      const accuracy = totalReviews > 0 ? correctCount / totalReviews : 0;
      let status;
      if (totalReviews === 0) status = 'NOT_STARTED';
      else if (accuracy >= STATUS.MASTERED.minAccuracy && totalReviews >= STATUS.MASTERED.minReviews) status = 'MASTERED';
      else if (accuracy >= STATUS.LEARNING.minAccuracy && totalReviews >= STATUS.LEARNING.minReviews) status = 'LEARNING';
      else status = 'WEAK';
      const gapScore = status === 'NOT_STARTED' ? 0.9 : status === 'WEAK' ? 0.8 : status === 'LEARNING' ? 0.4 : 0.1;
      const prereqIds = node.prerequisites || [];
      const blockedBy = prereqIds.map(pid => orderedNodes.find(n => n.id === pid)).filter(n => n && n.status !== 'MASTERED').map(n => n.name);
      enriched.push({ id: node.id, name: node.name, type: node.type, level: node.level, accuracy: Math.round(accuracy * 100) / 100, reviews: totalReviews, correctCount, lastSeen: stats?.last_seen || null, nextDue: stats?.next_due || null, status, gapScore, blockedBy, flashcardCount: stats?.total || 0 });
    }
    const total = enriched.length;
    const mastered = enriched.filter(n => n.status === 'MASTERED').length;
    const learning = enriched.filter(n => n.status === 'LEARNING').length;
    const weak = enriched.filter(n => n.status === 'WEAK').length;
    const notStarted = enriched.filter(n => n.status === 'NOT_STARTED').length;
    const nextUp = enriched.find(n => n.status !== 'MASTERED' && n.blockedBy.length === 0);
    return { goal: goalTopic, userId, nodes: enriched, hasCycle, progress: { total, mastered, learning, weak, notStarted }, nextUp, generatedAt: new Date().toISOString() };
  }

  static formatDiscord(result, options = {}) {
    const { short = false, gapsOnly = false } = options;
    const { goal, nodes, progress, nextUp, hasCycle } = result;
    if (!nodes.length) return { embeds: [{ color: 0x888780, title: `Lộ trình: ${goal}`, description: 'Không tìm thấy topic nào.' }] };
    const barLen = 20;
    const filled = progress.total > 0 ? Math.round((progress.mastered / progress.total) * barLen) : 0;
    const progressBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    const progressPct = progress.total > 0 ? Math.round((progress.mastered / progress.total) * 100) : 0;
    let displayNodes = gapsOnly ? nodes.filter(n => n.status === 'WEAK' || n.status === 'NOT_STARTED') : nodes;
    if (short) displayNodes = displayNodes.slice(0, 5);
    const nodeLines = displayNodes.map(node => {
      const icon = STATUS[node.status]?.icon || '⬜';
      const acc = node.reviews > 0 ? ` ${Math.round(node.accuracy * 100)}%` : '';
      const rev = node.reviews > 0 ? ` · ${node.reviews} reviews` : '';
      const block = node.blockedBy.length > 0 ? `\n    ↳ chờ: ${node.blockedBy.slice(0, 2).join(', ')}` : '';
      return `${icon} **${node.name}**${acc}${rev}${block}`;
    }).join('\n');
    const nextAction = nextUp ? `Học tiếp: **${nextUp.name}** — gõ \`!quiz ${nextUp.name}\` hoặc \`!learn ${nextUp.name}\`` : progress.mastered === progress.total ? 'Hoàn thành! Gõ `!quiz` để ôn tập.' : 'Hoàn thành prerequisites trước khi tiếp tục.';
    return { embeds: [{ color: progressPct >= 80 ? 0x1D9E75 : progressPct >= 40 ? 0x7F77DD : 0x888780, title: `Lộ trình học: ${goal}`, description: [`\`${progressBar}\` **${progressPct}%** hoàn thành`, `${progress.mastered} đã nắm · ${progress.learning} đang học · ${progress.weak} cần ôn · ${progress.notStarted} chưa bắt đầu`, hasCycle ? '\n> ⚠️ KG có vòng lặp — thứ tự có thể chưa hoàn toàn chính xác' : ''].filter(Boolean).join('\n'), fields: [{ name: gapsOnly ? 'Cần học ngay' : short ? '5 bước tiếp theo' : `Toàn bộ lộ trình (${displayNodes.length} topics)`, value: nodeLines || '_Không có topic nào._', inline: false }, { name: 'Bước tiếp theo', value: nextAction, inline: false }], footer: { text: `!path ${goal} --short · --gaps · !path  để xem lộ trình khác` } }] };
  }
}

export default LearningPathGenerator;
