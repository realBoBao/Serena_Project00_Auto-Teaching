/**
 * Migration: Thêm cột fsrs_state vào flashcards DB
 * Chạy 1 lần: node scripts/migrate_fsrs.js
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const FLASHCARD_DB = path.resolve('./flashcards.db');

async function migrate() {
  const db = await open({ filename: FLASHCARD_DB, driver: sqlite3.Database });

  // Kiểm tra cột đã tồn tại chưa
  const cols = await db.all('PRAGMA table_info(flashcards)');
  const hasFsrs = cols.some(c => c.name === 'fsrs_state');

  if (!hasFsrs) {
    await db.exec('ALTER TABLE flashcards ADD COLUMN fsrs_state TEXT DEFAULT \'{}\'');
    console.log('✅ Added fsrs_state column');
  } else {
    console.log('ℹ️  fsrs_state column already exists');
  }

  // Init FSRS state cho cards cũ
  const cards = await db.all('SELECT * FROM flashcards WHERE fsrs_state = \'{}\' OR fsrs_state IS NULL');
  console.log(`📊 Initializing FSRS state for ${cards.length} cards...`);

  for (const card of cards) {
    const reviewCount = card.review_count || 0;
    const correctCount = card.correct_count || 0;

    // Estimate initial stability từ review history
    let stability = 1;
    if (reviewCount > 0) {
      const accuracy = correctCount / reviewCount;
      stability = Math.max(1, Math.min(365, reviewCount * accuracy * 3));
    }

    // Estimate difficulty từ accuracy
    let difficulty = 5;
    if (reviewCount > 0) {
      const accuracy = correctCount / reviewCount;
      difficulty = Math.max(1, Math.min(10, 10 - accuracy * 8));
    }

    const fsrsState = JSON.stringify({
      stability: Math.round(stability * 100) / 100,
      difficulty: Math.round(difficulty * 100) / 100,
      last_review: card.updated_at || card.created_at || new Date().toISOString(),
      reps: reviewCount,
      lapses: reviewCount - correctCount,
    });

    await db.run('UPDATE flashcards SET fsrs_state = ? WHERE id = ?', [fsrsState, card.id]);
  }

  console.log('✅ Migration complete!');
  await db.close();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
