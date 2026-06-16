/**
 * Outbox Worker — quét outbox và gửi pending messages.
 *
 * Gọi startOutboxWorker() để bắt đầu background polling.
 * Worker chạy mỗi 30 giây, gửi tối đa 10 messages mỗi batch.
 *
 * ponytail: setInterval-based polling, không dùng job queue.
 *   Đủ cho single-instance. Multi-instance cần distributed lock.
 */

import { getPending, markSent, markFailed } from './outbox.js';
import { info, warn, error } from './structured_logger.js';

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const BATCH_SIZE = 10;
const MAX_CONCURRENT = 3;

let _timer = null;
let _running = false;

/**
 * Gửi một message từ outbox.
 * Dispatch theo channel type.
 */
async function sendOne(msg) {
  const { id, channel, payload } = msg;

  switch (channel) {
    case 'discord':
      return sendDiscord(payload);
    case 'webhook':
      return sendWebhook(payload);
    default:
      warn('OutboxWorker', 'unknown channel', { id, channel });
      return false;
  }
}

/**
 * Gửi message qua Discord webhook.
 */
async function sendDiscord(payload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('DISCORD_WEBHOOK not configured');
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: payload.content || payload.text || '',
      embeds: payload.embeds || [],
      username: payload.username || 'AI Brain',
    }),
  });

  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
  }

  return true;
}

/**
 * Gửi qua generic webhook URL.
 */
async function sendWebhook(payload) {
  const url = payload._webhookUrl;
  if (!url) throw new Error('Missing _webhookUrl in payload');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Webhook returned ${res.status}`);
  }

  return true;
}

/**
 * Một batch: lấy pending messages và gửi song song (giới hạn concurrent).
 */
async function processBatch() {
  const pending = await getPending(BATCH_SIZE);
  if (pending.length === 0) return 0;

  info('OutboxWorker', 'processing batch', { count: pending.length });

  let sent = 0;
  // Process in chunks of MAX_CONCURRENT
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
    const chunk = pending.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      chunk.map(async (msg) => {
        try {
          await sendOne(msg);
          await markSent(msg.id);
          return true;
        } catch (err) {
          await markFailed(msg.id, err);
          return false;
        }
      })
    );
    sent += results.filter(r => r.status === 'fulfilled' && r.value).length;
  }

  return sent;
}

/**
 * Start background worker.
 */
export function startOutboxWorker() {
  if (_timer) return; // already running

  info('OutboxWorker', 'starting', { poll_interval_ms: POLL_INTERVAL_MS });

  _timer = setInterval(async () => {
    if (_running) return; // skip if previous batch still running
    _running = true;
    try {
      await processBatch();
    } catch (err) {
      error('OutboxWorker', 'batch error', { error: err.message });
    } finally {
      _running = false;
    }
  }, POLL_INTERVAL_MS);

  // Also run immediately on start
  processBatch().catch(() => {});
}

/**
 * Stop worker.
 */
export function stopOutboxWorker() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    info('OutboxWorker', 'stopped');
  }
}
