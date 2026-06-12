/**
 * Seed Prerequisites — Auto-discover prerequisite relationships via LLM
 *
 * Reads all entities from Knowledge Graph, asks LLM to identify
 * prerequisite pairs, and inserts them as edges.
 *
 * Usage: node scripts/seed_prerequisites.js
 */

import 'dotenv/config';
import { getDb } from '../lib/knowledge_graph.js';
import { ask } from '../lib/llm.js';

async function main() {
  const db = await getDb();

  // Get all entities
  const entities = await db.all('SELECT id, name, type FROM entities ORDER BY name');
  console.log(`[Seed] Found ${entities.length} entities`);

  if (entities.length < 2) {
    console.log('[Seed] Not enough entities to discover prerequisites.');
    return;
  }

  // Build entity list for LLM
  const entityList = entities.map(e => `- ${e.name} (${e.type})`).join('\n');

  const prompt = `Từ danh sách các khái niệm kỹ thuật sau:
${entityList}

Hãy liệt kê các cặp (prerequisite → dependent) theo thứ tự học đúng.
Chỉ liệt kê những quan hệ thực sự rõ ràng (ví dụ: "phải biết A trước khi học B").

Trả về JSON array:
[{"prerequisite": "tên", "dependent": "tên"}, ...]

Tối đa 30 cặp. Chỉ JSON, không có gì khác.`;

  console.log('[Seed] Asking LLM to discover prerequisite relationships...');

  try {
    const raw = await ask(prompt, { maxTokens: 600, temperature: 0.1 });
    const clean = raw.replace(/```json|```/g, '').trim();
    const jsonStart = clean.indexOf('[');
    const jsonEnd = clean.lastIndexOf(']');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      console.error('[Seed] No JSON array found in LLM response');
      return;
    }
    const pairs = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));

    let inserted = 0;
    let skipped = 0;

    for (const { prerequisite, dependent } of pairs) {
      if (!prerequisite || !dependent) continue;

      // Find entity IDs
      const prereqEntity = await db.get('SELECT id FROM entities WHERE LOWER(name) = LOWER(?)', prerequisite.trim());
      const depEntity = await db.get('SELECT id FROM entities WHERE LOWER(name) = LOWER(?)', dependent.trim());

      if (!prereqEntity || !depEntity) {
        console.log(`[Seed] Skipping: "${prerequisite}" → "${dependent}" (entity not found)`);
        skipped++;
        continue;
      }

      // Check if edge already exists
      const existing = await db.get(
        'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
        prereqEntity.id, depEntity.id, 'prerequisite'
      );

      if (existing) {
        skipped++;
        continue;
      }

      // Insert prerequisite edge
      await db.run(
        'INSERT INTO edges (source_id, target_id, relation, weight, created_at) VALUES (?, ?, ?, 0.7, datetime("now"))',
        prereqEntity.id, depEntity.id, 'prerequisite'
      );
      inserted++;
      console.log(`[Seed] Inserted: "${prerequisite}" → "${dependent}"`);
    }

    console.log(`\n[Seed] Done! Inserted ${inserted} prerequisite edges, skipped ${skipped}`);

    // Show stats
    const totalEdges = await db.get('SELECT COUNT(*) as n FROM edges WHERE relation = ?', 'prerequisite');
    console.log(`[Seed] Total prerequisite edges in KG: ${totalEdges?.n || 0}`);

  } catch (err) {
    console.error('[Seed] Error:', err.message);
  }
}

main().catch(console.error);
