/**
 * lib/roadmap_engine.js — Dynamic Ontology Generation (Tier 1)
 *
 * Generates DAG learning paths for ANY topic using LLM.
 * Stores in SQLite for persistence. Enables Just-In-Time knowledge fetching.
 *
 * Schema:
 *   roadmap_nodes: id, topic, parent_id, label, status, metadata
 *   roadmap_edges: id, source_id, target_id, relation
 *
 * @module lib/roadmap_engine
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { createHash } from 'crypto';
import { getLogger } from './logger.js';
import { invokeLlm } from './llm.js';
import { HumanMessage } from '@langchain/core/messages';
import { buildXmlPrompt } from './prompt_xml.js';

const logger = getLogger('RoadmapEngine');
const DB_PATH = path.resolve('./data/roadmap.db');

let _db = null;

async function getDb() {
  if (_db) return _db;
  _db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_nodes (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      parent_id TEXT,
      label TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'not_started',
      priority INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS roadmap_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT DEFAULT 'prerequisite',
      FOREIGN KEY (source_id) REFERENCES roadmap_nodes(id),
      FOREIGN KEY (target_id) REFERENCES roadmap_nodes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_topic ON roadmap_nodes(topic);
    CREATE INDEX IF NOT EXISTS idx_roadmap_parent ON roadmap_nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_roadmap_status ON roadmap_nodes(status);
    CREATE INDEX IF NOT EXISTS idx_roadmap_edges_source ON roadmap_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_roadmap_edges_target ON roadmap_edges(target_id);
  `);
  return _db;
}

/**
 * Generate a DAG learning path for any topic using LLM.
 * @param {string} topic — e.g. "Docker", "Quantum Computing", "Web3"
 * @param {string} [goal] — Optional learning goal
 * @returns {Promise<{nodes: Array, edges: Array, topic: string}>}
 */
export async function generateRoadmap(topic, goal = '') {
  logger.info(`[RoadmapEngine] Generating roadmap for: ${topic}`);

  const prompt = buildXmlPrompt({
    system: `Bạn là chuyên gia giáo dục Computer Science. Bạn tạo lộ trình học tập chi tiết dưới dạng DAG (Directed Acyclic Graph).`,
    context: `Chủ đề: ${topic}${goal ? `\nMục tiêu học tập: ${goal}` : ''}`,
    instructions: `Tạo lộ trình học tập từ cơ bản đến nâng cao cho chủ đề "${topic}".
Mỗi node là một kỹ năng/khái niệm cần học.
Mỗi edge là mối quan hệ "prerequisite" (phải học A trước B).
Tối thiểu 5 nodes, tối đa 15 nodes.
Nodes phải theo thứ tự logic: fundamentals → intermediate → advanced.`,
    constraints: `Chỉ trả về JSON hợp lệ, không giải thích thêm.
Format chính xác:
{
  "nodes": [
    { "id": "node1", "label": "Tên kỹ năng", "description": "Mô tả ngắn", "priority": 1 },
    { "id": "node2", "label": "Tên kỹ năng", "description": "Mô tả ngắn", "priority": 2 }
  ],
  "edges": [
    { "source": "node1", "target": "node2", "relation": "prerequisite" }
  ]
}`,
    output: '[JSON DAG]',
  });

  try {
    const raw = await invokeLlm([new HumanMessage(prompt)], 'RoadmapGeneration');
    if (typeof raw !== 'string') throw new Error('LLM returned non-string response');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in LLM response');

    const dag = JSON.parse(jsonMatch[0]);
    if (!dag.nodes || !Array.isArray(dag.nodes)) throw new Error('Invalid DAG structure');

    logger.info(`[RoadmapEngine] Generated ${dag.nodes.length} nodes, ${dag.edges?.length || 0} edges for "${topic}"`);
    return { nodes: dag.nodes, edges: dag.edges || [], topic };
  } catch (err) {
    logger.error(`[RoadmapEngine] generateRoadmap failed: ${err.message}`);
    return { nodes: [], edges: [], topic, error: err.message };
  }
}

/**
 * Save a generated roadmap to SQLite.
 * @param {string} topic
 * @param {object} dag — { nodes, edges }
 * @returns {Promise<string>} roadmapId
 */
export async function saveRoadmap(topic, dag) {
  const db = await getDb();
  const roadmapId = createHash('sha256').update(topic.toLowerCase().trim()).digest('hex').slice(0, 16);

  // Clear old roadmap for this topic
  await db.run('DELETE FROM roadmap_edges WHERE source_id IN (SELECT id FROM roadmap_nodes WHERE topic = ?)', topic);
  await db.run('DELETE FROM roadmap_nodes WHERE topic = ?', topic);

  // Insert nodes
  for (const node of dag.nodes) {
    const nodeId = `${roadmapId}_${node.id}`;
    await db.run(
      'INSERT INTO roadmap_nodes (id, topic, parent_id, label, description, priority) VALUES (?, ?, ?, ?, ?, ?)',
      nodeId, topic, node.parent || null, node.label, node.description || '', node.priority || 0
    );
  }

  // Insert edges
  for (const edge of (dag.edges || [])) {
    const sourceId = `${roadmapId}_${edge.source}`;
    const targetId = `${roadmapId}_${edge.target}`;
    await db.run(
      'INSERT INTO roadmap_edges (source_id, target_id, relation) VALUES (?, ?, ?)',
      sourceId, targetId, edge.relation || 'prerequisite'
    );
  }

  logger.info(`[RoadmapEngine] Saved roadmap "${topic}" (${dag.nodes.length} nodes)`);
  return roadmapId;
}

/**
 * Get a roadmap by topic.
 * @param {string} topic
 * @returns {Promise<{nodes: Array, edges: Array}>}
 */
export async function getRoadmap(topic) {
  try {
    const db = await getDb();
    const nodes = await db.all('SELECT * FROM roadmap_nodes WHERE topic = ? ORDER BY priority', topic);
    const edges = await db.all(`
      SELECT e.* FROM roadmap_edges e
      JOIN roadmap_nodes n ON e.source_id = n.id
      WHERE n.topic = ?
    `, topic);
    return { nodes, edges };
  } catch { return { nodes: [], edges: [] }; }
}

/**
 * Get all roadmaps (list of topics).
 * @returns {Promise<Array>}
 */
export async function listRoadmaps() {
  try {
    const db = await getDb();
    return await db.all('SELECT DISTINCT topic, COUNT(*) as node_count FROM roadmap_nodes GROUP BY topic');
  } catch { return []; }
}

/**
 * Update node status (for JIT fetching trigger).
 * @param {string} nodeId
 * @param {string} status — 'not_started' | 'in_progress' | 'completed' | 'skipped'
 */
export async function updateNodeStatus(nodeId, status) {
  try {
    const db = await getDb();
    await db.run('UPDATE roadmap_nodes SET status = ?, updated_at = datetime("now") WHERE id = ?', status, nodeId);
  } catch { /* ignore */ }
}

/**
 * Get active (in_progress) nodes — triggers JIT knowledge fetching.
 * @returns {Promise<Array>}
 */
export async function getActiveNodes() {
  try {
    const db = await getDb();
    return await db.all('SELECT * FROM roadmap_nodes WHERE status = ? ORDER BY priority', 'in_progress');
  } catch { return []; }
}

export default { generateRoadmap, saveRoadmap, getRoadmap, listRoadmaps, updateNodeStatus, getActiveNodes };
