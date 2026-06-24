/**
 * lib/crawlee_scraper.js — Shared Crawlee scraper for Serena
 *
 * Dùng CheerioCrawler + MemoryStorage để:
 * - Tự động retry khi bị 429/5xx
 * - Rate-limit thông minh (maxConcurrency)
 * - Không ghi disk (MemoryStorage)
 * - Headers giống trình duyệt thật
 *
 * @module lib/crawlee_scraper
 */

import { CheerioCrawler, Configuration, MemoryStorage } from 'crawlee';

const CONFIG = {
  maxConcurrency: 5,
  maxRequestRetries: 3,
  requestHandlerTimeoutSecs: 30,
  additionalMimeTypes: ['text/html', 'application/json'],
};

/**
 * Tạo CheerioCrawler instance với MemoryStorage.
 * @param {Object} options
 * @param {string} options.userAgent — custom UA string
 * @param {number} [options.maxConcurrency]
 * @returns {CheerioCrawler}
 */
export function createCrawler({ userAgent, maxConcurrency = CONFIG.maxConcurrency } = {}) {
  const config = new Configuration({
    storageClient: new MemoryStorage(),
    purgeOnStart: true, // xóa queue cũ, tránh disk bloat
  });

  return new CheerioCrawler({
    maxConcurrency,
    maxRequestRetries: CONFIG.maxRequestRetries,
    requestHandlerTimeoutSecs: CONFIG.requestHandlerTimeoutSecs,
    additionalMimeTypes: CONFIG.additionalMimeTypes,
    preNavigationHooks: [
      ({ request }) => {
        request.headers = {
          ...request.headers,
          'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        };
      },
    ],
  }, config);
}

/**
 * Chạy crawler với danh sách URL, trả về kết quả.
 * @param {string[]} urls — danh sách URL cần crawl
 * @param {Object} options
 * @param {Function} options.extractFn — ($, url) => result | null
 * @param {string} options.userAgent
 * @param {number} options.maxConcurrency
 * @returns {Promise<Array>} kết quả từ extractFn
 */
export async function crawlUrls(urls, { extractFn, userAgent, maxConcurrency = CONFIG.maxConcurrency } = {}) {
  if (!urls.length) return [];

  const results = [];
  const crawler = createCrawler({ userAgent, maxConcurrency });

  await crawler.addRequests(urls.map(url => ({
    url,
    userData: { originalUrl: url },
    skipNavigation: false,
  })));

  await crawler.run();

  // Lấy kết quả từ crawler storage
  const dataset = crawler.dataset;
  if (dataset) {
    const items = await dataset.getData();
    for (const item of items) {
      if (item && typeof extractFn === 'function') {
        try {
          const extracted = extractFn(item);
          if (extracted) results.push(extracted);
        } catch { /* skip bad items */ }
      }
    }
  }

  return results;
}

/**
 * Crawl đơn URL, trả về HTML string.
 * @param {string} url
 * @param {Object} options
 * @param {string} options.userAgent
 * @returns {Promise<string|null>} HTML content hoặc null nếu fail
 */
export async function crawlSingleUrl(url, { userAgent } = {}) {
  const crawler = createCrawler({ userAgent, maxConcurrency: 1 });
  let html = null;

  crawler.requestHandler = async ({ $, request, body }) => {
    html = $.html();
  };

  await crawler.run([url]);
  return html;
}

export default { createCrawler, crawlUrls, crawlSingleUrl };
