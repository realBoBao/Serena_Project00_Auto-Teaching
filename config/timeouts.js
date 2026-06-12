/**
 * Centralized Timeout Configuration
 *
 * Tất cả timeout values được định nghĩa ở đây để dễ quản lý và tune.
 * Các file khác import từ đây thay vì hardcode.
 *
 * Override qua environment variables nếu cần.
 */

export const TIMEOUTS = {
  // ── LLM / API ──
  LLM_DEFAULT: Number(process.env.LLM_TIMEOUT_MS || 30000),        // 30s
  LLM_STREAM: Number(process.env.LLM_STREAM_TIMEOUT_MS || 60000),  // 60s
  LLM_LOCAL: Number(process.env.LLM_LOCAL_TIMEOUT_MS || 10000),    // 10s
  LLM_RETRY_BASE_DELAY: Number(process.env.LLM_RETRY_DELAY_MS || 800),
  LLM_MAX_RETRIES: Number(process.env.LLM_MAX_RETRIES || 2),

  // ── Sandbox / Code Execution ──
  SANDBOX_DEFAULT: Number(process.env.SANDBOX_TIMEOUT_MS || 60000),     // 60s
  SANDBOX_QUICK: Number(process.env.SANDBOX_QUICK_TIMEOUT_MS || 15000), // 15s
  SANDBOX_MANIM: Number(process.env.SANDBOX_MANIM_TIMEOUT_MS || 180000), // 3min

  // ── HTTP / Network ──
  HTTP_DEFAULT: Number(process.env.HTTP_TIMEOUT_MS || 10000),      // 10s
  HTTP_UPLOAD: Number(process.env.HTTP_UPLOAD_TIMEOUT_MS || 30000), // 30s
  HTTP_REQUEST: Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120000), // 2min

  // ── Discord ──
  DISCORD_INTERACTION: Number(process.env.DISCORD_INTERACTION_TIMEOUT_MS || 3000), // 3s
  DISCORD_MESSAGE_QUEUE: Number(process.env.DISCORD_QUEUE_TIMEOUT_MS || 300000),   // 5min

  // ── Database ──
  DB_QUERY: Number(process.env.DB_QUERY_TIMEOUT_MS || 5000),       // 5s
  DB_TRANSACTION: Number(process.env.DB_TRANSACTION_TIMEOUT_MS || 10000), // 10s

  // ── Cache ──
  CACHE_EMBEDDING_TTL: Number(process.env.CACHE_EMBEDDING_TTL_MS || 7 * 24 * 60 * 60 * 1000), // 7 days
  CACHE_MAX_ENTRIES: Number(process.env.CACHE_MAX_ENTRIES || 10000),
  MEMORY_CACHE_MAX: Number(process.env.MEMORY_CACHE_MAX || 500),

  // ── Scheduler / Cron ──
  SCHEDULER_PIPELINE: Number(process.env.SCHEDULER_PIPELINE_TIMEOUT_MS || 600000), // 10min
  SCHEDULER_BACKUP: Number(process.env.SCHEDULER_BACKUP_TIMEOUT_MS || 120000),    // 2min

  // ── Rate Limiting ──
  RATE_LIMIT_WINDOW: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),    // 1min
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30),
  TOKEN_BUCKET_MAX: Number(process.env.TOKEN_BUCKET_MAX || 5),
  TOKEN_REFILL_MS: Number(process.env.TOKEN_REFILL_MS || 2000),            // 2s

  // ── Health Check ──
  HEALTH_CHECK_INTERVAL: Number(process.env.HEALTH_CHECK_INTERVAL_MS || 60000), // 1min
  METRICS_SNAPSHOT_INTERVAL: Number(process.env.METRICS_SNAPSHOT_INTERVAL_MS || 30000), // 30s
};

// ── Helper: get timeout with fallback ──
export function getTimeout(key, fallback) {
  return TIMEOUTS[key] || fallback;
}
