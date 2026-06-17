/**
 * ═══════════════════════════════════════════════════════════════
 * Qdrant Vector DB Adapter — Production-grade vector search
 * ═══════════════════════════════════════════════════════════════
 *
 * Drop-in replacement for vector_store.js khi cần scale.
 * Qdrant cung cấp:
 * - Persistent vector storage (không mất data khi restart)
 * - HNSW search nhanh hơn in-memory (optimized C++)
 * - Filtering theo metadata (category, project, etc.)
 * - Horizontal scaling
 *
 * Khi nào dùng:
 * - Khi vector count > 10,000 (in-memory HNSW chậm)
 * - Khi cần persistent vectors (không re-ingest mỗi lần restart)
 *
 * Cài đặt Qdrant:
 *   docker run -p 6333:6333 qdrant/qdrant
 *
 * Chuyển đổi từ SQLite → Qdrant:
 *   1. Đặt QDRANT_URL=http://localhost:6333 trong .env
 *   2. Chạy: node -e "import('./lib/vector_store_qdrant.js').then(m => m.migrateFromSqlite())"
 *
 * @module lib/vector_store_qdrant
 */

import { getLogger } from './logger.js';

const logger = getLogger('Qdrant');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'ai_brain';
const VECTOR_DIM = 768;

let _qdrantAvailable = null;

async function checkQdrantAvailable() {
  if (_qdrantAvailable !== null) return _qdrantAvailable;
  try {
    const res = await fetch(`${QDRANT_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    _qdrantAvailable = res.ok;
  } catch {
    _qdrantAvailable = false;
  }
  logger.info(`[Qdrant] Available: ${_qdrantAvailable}`);
  return _qdrantAvailable;
}

async function ensureCollection() {
  const available = await checkQdrantAvailable();
  if (!available) return false;

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      headers: { 'api-key': QDRANT_API_KEY },
    });
    if (res.ok) return true;

    const createRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
      body: JSON.stringify({
        vectors: { size: VECTOR_DIM, distance: 'Cosine' },
        optimizers_config: { default_segment_number: 2 },
        replication_factor: 1,
      }),
    });

    if (createRes.ok) {
      // Create payload indexes
      for (const field of ['category', 'project']) {
        await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/index`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
          body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
        });
      }
      logger.info('[Qdrant] Collection created');
      return true;
    }

    logger.error('[Qdrant] Failed to create collection:', await createRes.text());
    return false;
  } catch (err) {
    logger.error('[Qdrant] ensureCollection error:', err.message);
    return false;
  }
}


/** Upsert a document (chunks + embeddings) into Qdrant */
export async function upsertDocument(docId, metadata, chunks, embeddings, targetSpace = 'academic') {
  const available = await checkQdrantAvailable();
  if (!available) return false;
  try {
    await ensureCollection();
    const points = chunks.map((chunk, i) => ({
      id: docId + '::' + i,
      vector: Array.from(embeddings[i] || []),
      payload: {
        doc_id: docId,
        chunk_index: i,
        text: chunk.slice(0, 2000),
        category: metadata.category || 'general',
        project: metadata.project || '',
        source: metadata.source || '',
        space: targetSpace,
      },
    }));
    const res = await fetch(QDRANT_URL + '/collections/' + COLLECTION_NAME + '/points', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
      body: JSON.stringify({ points }),
    });
    return res.ok;
  } catch (err) {
    logger.error('[Qdrant] upsertDocument error:', err.message);
    return false;
  }
}

/** Upsert a vector with metadata */
export async function upsertVector(id, vector, payload = {}) {
  const available = await checkQdrantAvailable();
  if (!available) return false;

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
      body: JSON.stringify({ points: [{ id, vector, payload }] }),
    });
    return res.ok;
  } catch (err) {
    logger.error('[Qdrant] upsertVector error:', err.message);
    return false;
  }
}

/** Search for nearest vectors */
export async function searchVectors(queryVector, limit = 5, filter = null) {
  const available = await checkQdrantAvailable();
  if (!available) return [];

  try {
    const body = { vector: queryVector, limit, with_payload: true, with_vector: false };
    if (filter) body.filter = filter;

    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      logger.error('[Qdrant] search error:', res.status);
      return [];
    }

    const data = await res.json();
    return (data.result || []).map(point => ({
      id: point.id,
      score: point.score,
      ...point.payload,
    }));
  } catch (err) {
    logger.error('[Qdrant] searchVectors error:', err.message);
    return [];
  }
}

/** Delete a vector by ID */
export async function deleteVector(id) {
  const available = await checkQdrantAvailable();
  if (!available) return false;

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
      body: JSON.stringify({ points: [id] }),
    });
    return res.ok;
  } catch (err) {
    logger.error('[Qdrant] deleteVector error:', err.message);
    return false;
  }
}

/** Get collection stats */
export async function getCollectionStats() {
  const available = await checkQdrantAvailable();
  if (!available) return { available: false };

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      headers: { 'api-key': QDRANT_API_KEY },
    });
    if (!res.ok) return { available: true, error: res.status };
    const data = await res.json();
    return {
      available: true,
      pointsCount: data.result?.points_count || 0,
      status: data.result?.status,
    };
  } catch (err) {
    return { available: true, error: err.message };
  }
}

/** Migrate all vectors from SQLite to Qdrant */
export async function migrateFromSqlite() {
  const available = await checkQdrantAvailable();
  if (!available) {
    logger.error('[Qdrant] Not available for migration');
    return { success: false, error: 'Qdrant not available' };
  }

  await ensureCollection();

  try {
    const sqlite3 = (await import('sqlite3')).default;
    const { open } = await import('sqlite');
    const db = await open({ filename: './vectors.db', driver: null });
    const rows = await db.all('SELECT id, embedding, doc_id, chunk_index, chunk_text, url, project, category, metadata FROM vectors');
    logger.info(`[Qdrant] Migrating ${rows.length} vectors...`);

    let migrated = 0;
    const batchSize = 100;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const points = batch.map(row => {
        const embedding = row.embedding
          ? (row.embedding instanceof Buffer ? Array.from(new Float32Array(row.embedding.buffer)) : JSON.parse(row.embedding))
          : null;
        if (!embedding) return null;
        return {
          id: row.id,
          vector: embedding,
          payload: { doc_id: row.doc_id, chunk_index: row.chunk_index, chunk_text: row.chunk_text, url: row.url, project: row.project, category: row.category, metadata: row.metadata },
        };
      }).filter(Boolean);

      if (points.length === 0) continue;

      const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_API_KEY },
        body: JSON.stringify({ points }),
      });

      if (res.ok) migrated += points.length;
      else logger.warn(`[Qdrant] Batch ${i / batchSize + 1} failed:`, res.status);
    }

    await db.close();
    logger.info(`[Qdrant] Migration complete: ${migrated}/${rows.length}`);
    return { success: true, migrated, total: rows.length };
  } catch (err) {
    logger.error('[Qdrant] Migration error:', err.message);
    return { success: false, error: err.message };
  }
}
