/**
 * cron/daily_rss_fetch.js — Daily RSS fetch from engineering blogs
 * Scheduled via node-cron in scheduler.js
 *
 * Fetches top posts from engineering blogs (kilimchoi/engineering-blogs),
 * creates flashcards for new tech concepts, and caches in web_cache.
 *
 * Triggered daily at 6:00 AM PDT (13:00 UTC)
 */
import { getLogger } from '../lib/logger.js';
import { scrapeUrl } from '../lib/web_scraper.js';
import { getDb } from '../lib/flashcard_db.js';
import { fsrsSchedule, booleanToRating } from '../lib/fsrs.js';

const logger = getLogger('DailyRSS');

// Top engineering blog RSS feeds (from kilimchoi/engineering-blogs)
const RSS_FEEDS = [
  { name: 'Netflix Tech Blog', url: 'https://netflixtechblog.com/feed' },
  { name: 'Uber Engineering', url: 'https://eng.uber.com/feed/' },
  { name: 'Airbnb Engineering', url: 'https://medium.com/feed/airbnb-engineering' },
  { name: 'Stripe Engineering', url: 'https://stripe.com/blog/feed.rss' },
  { name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/' },
  { name: 'Vercel Blog', url: 'https://vercel.com/feed.xml' },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/' },
  { name: 'Discord Blog', url: 'https://discord.com/blog/rss.xml' },
];

/**
 * Fetch RSS feed and extract article links.
 * @param {string} feedUrl
 * @returns {Promise<Array<{title, url}>>}
 */
async function fetchRssLinks(feedUrl) {
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'my-ai-brain/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    // Simple regex-based RSS parsing (no external dependency)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      if (titleMatch && linkMatch) {
        items.push({
          title: titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          url: linkMatch[1].trim(),
        });
      }
    }
    return items.slice(0, 3); // Top 3 posts per feed
  } catch {
    return [];
  }
}

/**
 * Generate a flashcard from an article URL.
 * Scrapes the article and creates a Q&A pair.
 */
async function generateFlashcard(url, source) {
  try {
    const markdown = await scrapeUrl(url, { useCache: true, timeout: 8000 });
    if (!markdown || markdown.length < 200) return null;

    // Extract key concept from title/first heading
    const titleMatch = markdown.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Tech Article';

    // Create a simple flashcard
    const question = `📰 **${source}**: ${title}\n\nBài viết này nói về gì? (Đọc tóm tắt)`;
    const answer = markdown.slice(0, 1000) + (markdown.length > 1000 ? '\n\n[...]' : '');

    return { question, answer, source, category: 'tech-news' };
  } catch {
    return null;
  }
}

/**
 * Main: Fetch daily RSS and create flashcards.
 * Called by scheduler.js cron job.
 */
export async function runDailyRssFetch() {
  logger.info('[DailyRSS] Starting daily RSS fetch...');
  let totalArticles = 0;
  let totalFlashcards = 0;

  for (const feed of RSS_FEEDS) {
    const articles = await fetchRssLinks(feed.name);
    totalArticles += articles.length;

    for (const article of articles) {
      // Check if already processed
      const db = await getDb();
      const existing = await db.get('SELECT id FROM flashcards WHERE source = ?', article.url);
      if (existing) continue;

      const card = await generateFlashcard(article.url, feed.name);
      if (card) {
        try {
          await db.run(
            `INSERT INTO flashcards (question, answer, source, category, difficulty, review_count, correct_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, 0, 0, datetime('now'), datetime('now'))`,
            card.question, card.answer, card.source, card.category
          );
          totalFlashcards++;
        } catch { /* ignore duplicate errors */ }
      }
    }
  }

  logger.info(`[DailyRSS] Fetched ${totalArticles} articles, created ${totalFlashcards} flashcards`);
  return { articles: totalArticles, flashcards: totalFlashcards };
}

export default { runDailyRssFetch };
