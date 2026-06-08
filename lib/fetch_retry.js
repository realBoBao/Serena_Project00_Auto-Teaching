/**
 * fetch_retry.js — HTTP fetch với retry logic
 */

export async function fetchWithRetry(url, options = {}, maxRetries = 3, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429) {
        // Rate limited — wait longer
        const retryAfter = parseInt(res.headers.get('retry-after') || '5') * 1000;
        console.log(`[fetch] Rate limited, waiting ${retryAfter}ms...`);
        await new Promise(r => setTimeout(r, retryAfter));
        continue;
      }
      if (res.status >= 500) {
        // Server error — retry
        console.log(`[fetch] Server error ${res.status}, retry ${i + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      return res; // 4xx errors — don't retry
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.log(`[fetch] Error: ${err.message}, retry ${i + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error(`Failed after ${maxRetries} retries: ${url}`);
}
