#!/usr/bin/env node
/**
 * Import từ artifacts/*.md reports → flashcards.db
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import * as db from '../lib/flashcard_db.js';

const ARTIFACTS_DIR = path.resolve('./artifacts');

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Import Artifacts → Flashcards');
  console.log('═══════════════════════════════════════════════');

  const files = (await fs.readdir(ARTIFACTS_DIR))
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(ARTIFACTS_DIR, f));

  console.log(`Found ${files.length} report files`);

  let totalCreated = 0;
  const seenQuestions = new Set();

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const filename = path.basename(file);

      const titleMatch = content.match(/^#\s+🚀\s+BÁO CÁO[:\s]+(.+)/m);
      const topic = titleMatch ? titleMatch[1].trim() : filename;

      // Extract GitHub Repos
      const repoSection = content.match(/##\s+🏆[^\n]+\n([\s\S]*?)(?=##\s+📺|$)/);
      if (repoSection) {
        const repoLines = repoSection[1].split('\n').filter(l => l.includes('github.com'));
        for (const line of repoLines.slice(0, 3)) {
          const nameMatch = line.match(/\[([^\]]+)\]\(https:\/\/github\.com\/([^\)]+)\)/);
          if (nameMatch) {
            const name = nameMatch[1].replace(/⭐\s*/, '').trim();
            const q = `Repository nào trên GitHub liên quan đến "${topic}"?`;
            const a = `${name} - Repository GitHub về ${topic}.`;
            await saveFlashcard(q, a, filename, 'Backend', seenQuestions);
            totalCreated++;
          }
        }
      }

      // Extract YouTube Videos
      const videoSection = content.match(/##\s+📺[^\n]+\n([\s\S]*?)(?=##\s+💬|$)/);
      if (videoSection) {
        const videoLines = videoSection[1].split('\n').filter(l => l.includes('youtube.com') || l.includes('youtu.be'));
        for (const line of videoLines.slice(0, 3)) {
          const titleMatch = line.match(/\[([^\]]+)\]\(https:\/\/youtu\.be\/([^\)]+)\)/);
          if (titleMatch) {
            const title = titleMatch[1].replace(/&amp;/g, '&').trim();
            const q = `Video nào trên YouTube giải thích về "${topic}"?`;
            const a = `"${title}" - Video YouTube về ${topic}.`;
            await saveFlashcard(q, a, filename, 'Backend', seenQuestions);
            totalCreated++;
          }
        }
      }

      // Extract StackOverflow Questions
      const soSection = content.match(/##\s+💬[^\n]+\n([\s\S]*?)(?=##\s+📰|$)/);
      if (soSection) {
        const soLines = soSection[1].split('\n').filter(l => l.includes('stackoverflow.com'));
        for (const line of soLines.slice(0, 3)) {
          const titleMatch = line.match(/\[([^\]]+)\]\(https:\/\/stackoverflow\.com\/([^\)]+)\)/);
          if (titleMatch) {
            const title = titleMatch[1].trim();
            const q = `Câu hỏi StackOverflow nào liên quan đến "${topic}"?`;
            const a = `"${title}" - Câu hỏi về ${topic} trên StackOverflow.`;
            await saveFlashcard(q, a, filename, 'Backend', seenQuestions);
            totalCreated++;
          }
        }
      }

      // Extract bullet points
      const bulletPoints = content.match(/^[-*]\s+(.+)/gm) || [];
      for (const bp of bulletPoints.slice(0, 3)) {
        const text = bp.replace(/^[-*]\s*/, '').trim();
        if (text.length > 30 && text.length < 200 && !text.includes('http')) {
          const q = `Khái niệm: ${text.slice(0, 80)}`;
          const a = text;
          await saveFlashcard(q, a, filename, detectCategory(topic), seenQuestions);
          totalCreated++;
        }
      }

    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }

  const stats = await db.getStats();
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  ✅ Created: ${totalCreated} flashcards`);
  console.log(`  📊 Total in DB: ${stats.total}`);
  console.log('═══════════════════════════════════════════════');

  await db.closeDb();
}

async function saveFlashcard(question, answer, source, category, seen) {
  const key = question.slice(0, 80);
  if (seen.has(key)) return;
  seen.add(key);
  try {
    await db.addFlashcard({ question: question.slice(0, 200), answer: answer.slice(0, 500), source, category });
  } catch (e) { /* skip */ }
}

function detectCategory(topic) {
  const t = topic.toLowerCase();
  if (t.includes('backend') || t.includes('api')) return 'Backend';
  if (t.includes('devops') || t.includes('docker')) return 'DevOps';
  if (t.includes('ai') || t.includes('llm')) return 'AI';
  if (t.includes('algorithm')) return 'Algorithms';
  if (t.includes('database')) return 'Database';
  if (t.includes('network')) return 'Networking';
  return 'general';
}

main().catch(console.error);
