/**
 * REST API Server — Phase 11: Open API / Webhook
 * Cung cấp endpoint API bảo mật cho phép:
 * - Gửi ý tưởng từ điện thoại (iOS Shortcuts) thằng vào AI
 * - Quản lý flashcards qua API
 * - Trigger debate, quiz, sandbox từ bên ngoài
 * - Webhook receiver cho alerts
 *
 * Usage: node rest_api_server.js
 */

import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addFlashcard, getDueFlashcards, getRandomFlashcards, reviewFlashcard, getStats, deleteFlashcard, clearAll } from './lib/flashcard_db.js';
import { sandboxGateway } from './sandbox_gateway.js';
import { getSupportedLanguages } from './lib/code_sandbox.js';
import { runDebate, quickDebate } from './agents/DebateAgent.js';
import { withTimeout, TimeoutError } from './lib/with_timeout.js';
import { getEmbeddingCacheStats } from './lib/embeddings.js';
import { getGraphStats, searchEntities, exportGraphForVisualization } from './lib/knowledge_graph.js';
import { getEvaluationStats, getModelPerformanceReport, getAllABTestResults, detectKnowledgeGaps } from './lib/self_evolution.js';
import { listVideos, cleanupOldVideos } from './lib/video_cdn.js';
import { generateLearningPath, formatLearningPath } from './lib/learning_path.js';
import { getSecurityHeaders, validateApiKey, isIpAllowed, checkBodySize, auditLog } from './lib/security.js';
import { handleInteraction, registerSlashCommands } from './discord_interactions.js';
import { handleJob } from './cloud_scheduler_triggers.js';

// Register Discord slash commands on startup (idempotent)
registerSlashCommands().catch(err => {
  console.warn('[REST API] Slash command registration failed:', err.message);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve('./public');

// Cloud Run sets PORT (default 8080); local dev uses REST_API_PORT or 3005
const PORT = process.env.PORT || process.env.REST_API_PORT || 3005;
const API_KEY = process.env.REST_API_KEY || 'change-me-in-production';

if (!API_KEY) {
  console.warn('[REST API] WARNING: REST_API_KEY not set in .env. All authenticated endpoints will reject requests.');
  console.warn('[REST API] Set REST_API_KEY in .env and restart to enable API access.');
}

// ── Auth Middleware (supports API key rotation) ──
function authenticate(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return { ok: false, error: 'Missing Authorization header', status: 401 };
  }
  if (!validateApiKey(token)) {
    auditLog(req, { action: 'auth_failed', status: 'denied', details: { tokenPrefix: token.slice(0, 8) } });
    return { ok: false, error: 'Unauthorized — invalid API key', status: 401 };
  }
  return { ok: true };
}

// ── Rate Limiting (simple in-memory) ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute

// Cleanup old entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 300000);

function checkRateLimit(clientIp) {
  const now = Date.now();
  const entry = rateLimitMap.get(clientIp);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(clientIp, { windowStart: now, count: 1 });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { ok: false, error: 'Rate limit exceeded', status: 429 };
  }
  entry.count++;
  return { ok: true };
}

// ── JSON Response Helper (with security headers) ──
function json(res, data, status = 200) {
  const secHeaders = getSecurityHeaders();
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...secHeaders,
  });
  res.end(JSON.stringify(data));
}

// ── Body Parser (uses pre-read body from server) ──
function parseBody(req) {
  // Body is already read and parsed by the server handler
  return Promise.resolve(req.body || {});
}

// ── Router ──
const routes = [];

function route(method, path, handler, options = {}) {
  routes.push({ method, path, handler, public: options.public || false });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    // Simple param matching: /api/flashcards/:id
    const pattern = r.path.replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    const match = pathname.match(regex);
    if (match) {
      const paramNames = [...r.path.matchAll(/:([^/]+)/g)].map(m => m[1]);
      const params = {};
      paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
      return { handler: r.handler, params, isPublic: r.public };
    }
  }
  return null;
}

// ═══════════════════════════════════════════
// ── Route Definitions ──
// ═══════════════════════════════════════════

// Health check (public)
route('GET', '/api/health', (req, res) => {
  json(res, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}, { public: true });

// ── Prometheus Metrics ──
import { getPrometheusMetrics } from './lib/metrics.js';
route('GET', '/api/metrics', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.end(getPrometheusMetrics());
}, { public: true });

// ── Scheduler Status (catch-up tracking) ──
route('GET', '/api/scheduler/status', async (req, res) => {
  try {
    const catchUpFile = path.resolve('.scheduler_last_run.json');
    let lastRuns = {};
    if (fs.existsSync(catchUpFile)) {
      lastRuns = JSON.parse(fs.readFileSync(catchUpFile, 'utf8'));
    }
    const now = Date.now();
    const jobs = ['pipeline', 'memory', 'backup', 'evo', 'graph'];
    const status = {};
    for (const job of jobs) {
      const lastRun = lastRuns[job] ? new Date(lastRuns[job]) : null;
      const hoursAgo = lastRun ? ((now - lastRun.getTime()) / 3600000).toFixed(1) : null;
      status[job] = {
        lastRun: lastRun ? lastRun.toISOString() : null,
        hoursAgo: hoursAgo ? parseFloat(hoursAgo) : null,
        status: hoursAgo === null ? 'never_run' : (parseFloat(hoursAgo) < 12 ? 'ok' : 'missed'),
      };
    }
    json(res, { ok: true, jobs: status, checkedAt: new Date().toISOString() });
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
}, { public: true });

// ── Learning Path Generator (Phase 26) ──
route('GET', '/api/learning-path', async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const topic = url.searchParams.get('topic');
  if (!topic) return json(res, { error: 'Missing topic parameter' }, 400);

  const userId = url.searchParams.get('userId') || 'anonymous';
  const maxDepth = parseInt(url.searchParams.get('depth') || '6');
  const maxNodes = parseInt(url.searchParams.get('maxNodes') || '20');
  const short = url.searchParams.get('short') === 'true';
  const gapsOnly = url.searchParams.get('gaps') === 'true';

  try {
    const { LearningPathGenerator } = await import('./lib/learning_path.js');
    const result = await LearningPathGenerator.generate(userId, topic, { maxDepth, maxNodes });
    if (result.error) return json(res, { error: result.error }, 404);

    // Also include Discord-formatted embeds for convenience
    const discordFormat = LearningPathGenerator.formatDiscord(result, { short, gapsOnly });
    json(res, { ok: true, ...result, discord: discordFormat });
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
}, { public: true });

// ── Quick Note (from iOS Shortcuts) ──
route('POST', '/api/notes', async (req, res, params) => {
  const body = await parseBody(req);
  const { content, tags = [] } = body;
  if (!content) return json(res, { error: 'Missing content' }, 400);

  const { addMemory } = await import('./lib/memory_manager.js');
  const id = await addMemory({
    id: `api-note:${Date.now()}`,
    type: 'api_note',
    source: 'rest-api',
    content,
    tags: ['api', ...tags],
  });
  json(res, { ok: true, id, message: 'Note saved to memory' });
});

// ── Feedback Receiver (gộp từ feedback_server.js) ──
route('POST', '/api/feedback', async (req, res) => {
  const body = await parseBody(req);
  const { userId, feedback, rating, category } = body;
  if (!feedback) return json(res, { error: 'Missing feedback content' }, 400);

  // Lưu feedback vào file log
  const feedbackDir = path.resolve('./artifacts');
  if (!fs.existsSync(feedbackDir)) fs.mkdirSync(feedbackDir, { recursive: true });
  const feedbackFile = path.join(feedbackDir, 'feedback.json');
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch { /* empty */ }
  existing.push({ userId: userId || 'anonymous', feedback, rating: rating || 0, category: category || 'general', timestamp: new Date().toISOString() });
  fs.writeFileSync(feedbackFile, JSON.stringify(existing, null, 2));

  console.log(`[Feedback] User ${userId || 'Anonymous'} rated ${rating || 0}: ${feedback.slice(0, 80)}`);
  json(res, { ok: true, message: 'Feedback received' });
}, { public: true });

// ── Quick Ask (from iOS Shortcuts) ──
route('POST', '/api/ask', async (req, res) => {
  const body = await parseBody(req);
  const { query } = body;
  if (!query) return json(res, { error: 'Missing query' }, 400);

  const { answerQuestion } = await import('./agents/RagAgent.js');
  const result = await answerQuestion(query);
  json(res, {
    ok: true,
    answer: result.answer,
    source: result.source,
    sourcesFormatted: result.sourcesFormatted || null,
    resultsCount: result.results?.length || 0,
  });
});

// ── Flashcard CRUD ──
route('GET', '/api/flashcards', async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const category = url.searchParams.get('category');
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const cards = await getRandomFlashcards(limit, category);
  json(res, { ok: true, count: cards.length, cards });
});

route('GET', '/api/flashcards/due', async (req, res) => {
  const cards = await getDueFlashcards(20);
  json(res, { ok: true, count: cards.length, cards });
});

route('GET', '/api/flashcards/stats', async (req, res) => {
  const stats = await getStats();
  json(res, { ok: true, stats });
});

route('POST', '/api/flashcards', async (req, res) => {
  const body = await parseBody(req);
  const { question, answer, source, category } = body;
  if (!question || !answer) return json(res, { error: 'Missing question or answer' }, 400);
  const id = await addFlashcard({ question, answer, source: source || 'api', category: category || 'general' });
  json(res, { ok: true, id }, 201);
});

route('POST', '/api/flashcards/:id/review', async (req, res, params) => {
  const body = await parseBody(req);
  const { correct } = body;
  if (typeof correct !== 'boolean') return json(res, { error: 'Missing correct (boolean)' }, 400);
  const result = await reviewFlashcard(parseInt(params.id, 10), correct);
  if (!result) return json(res, { error: 'Flashcard not found' }, 404);
  json(res, { ok: true, result });
});

route('DELETE', '/api/flashcards/:id', async (req, res, params) => {
  const deleted = await deleteFlashcard(parseInt(params.id, 10));
  if (!deleted) return json(res, { error: 'Flashcard not found' }, 404);
  json(res, { ok: true, deleted: parseInt(params.id, 10) });
});

// ── Sandbox Execution (via SandboxGateway) ──
route('POST', '/api/sandbox/run', async (req, res) => {
  const body = await parseBody(req);
  const { code, language } = body;
  if (!code) return json(res, { error: 'Missing code' }, 400);
  try {
    const result = await withTimeout(
      sandboxGateway.execute({ agent: 'api_request', code, language }),
      60_000,
      'API sandbox execution'
    );
    json(res, { ok: result.success, ...result });
  } catch (err) {
    if (err instanceof TimeoutError) {
      json(res, { ok: false, error: 'Sandbox execution timed out (>60s)', timedOut: true }, 504);
    } else {
      json(res, { ok: false, error: err.message || 'Sandbox error' }, 500);
    }
  }
});

route('GET', '/api/sandbox/languages', (req, res) => {
  json(res, { ok: true, languages: getSupportedLanguages() });
});

// ── Debate ──
route('POST', '/api/debate', async (req, res) => {
  const body = await parseBody(req);
  const { problem, quick = false } = body;
  if (!problem) return json(res, { error: 'Missing problem' }, 400);
  const result = quick ? await quickDebate(problem) : await runDebate(problem);
  json(res, { ok: true, ...result });
});

// ── Vision: Image Analysis via Gemini Vision ──
route('POST', '/api/vision/analyze', async (req, res) => {
  const contentType = req.headers['content-type'] || '';

  // Support both JSON (base64) and raw binary upload
  if (contentType.includes('application/json')) {
    // JSON mode: { image: "base64...", mimeType: "image/png", prompt: "..." }
    try {
      const body = await parseBody(req);
      const { image, mimeType = 'image/png', prompt = '' } = body;
      if (!image) return json(res, { error: 'Missing image (base64 string)' }, 400);

      const imageBuffer = Buffer.from(image, 'base64');
      const { analyzeImageBuffer } = await import('./agents/VisionAgent.js');
      const result = await analyzeImageBuffer(imageBuffer, mimeType, prompt);
      json(res, result);
    } catch (err) {
      json(res, { ok: false, error: err.message || 'Vision analysis failed' }, 500);
    }
  } else {
    // Binary mode: raw image bytes in body
    try {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const imageBuffer = Buffer.concat(chunks);
          const mimeType = contentType.split(';')[0].trim() || 'image/png';

          if (imageBuffer.length === 0) return json(res, { error: 'Empty image body' }, 400);
          if (imageBuffer.length > 10 * 1024 * 1024) return json(res, { error: 'Image too large (>10MB)' }, 400);

          // Parse prompt from query string
          const url = new URL(req.url, `http://localhost`);
          const prompt = url.searchParams.get('prompt') || '';

          const { analyzeImageBuffer } = await import('./agents/VisionAgent.js');
          const result = await analyzeImageBuffer(imageBuffer, mimeType, prompt);
          json(res, result);
        } catch (err) {
          json(res, { ok: false, error: err.message || 'Vision analysis failed' }, 500);
        }
      });
    } catch (err) {
      json(res, { ok: false, error: err.message || 'Failed to read image' }, 500);
    }
  }
});

// ── Webhook Receiver (public, for Alertmanager) ──
route('POST', '/api/webhook/alerts', async (req, res) => {
  const body = await parseBody(req);
  const { alerts } = body;
  if (!alerts || !Array.isArray(alerts)) return json(res, { error: 'Invalid format' }, 400);

  // Forward to Discord bot if available
  console.log('[Webhook] Received alerts:', alerts.length);
  for (const alert of alerts) {
    const name = alert.labels?.alertname || 'Unknown';
    const severity = alert.labels?.severity || 'info';
    const status = alert.status || 'unknown';
    console.log(`[Alert] ${status.toUpperCase()} | ${severity} | ${name}`);
  }

  json(res, { ok: true, processed: alerts.length });
}, { public: true });

// ── PWA Static Files (public) ──
route('GET', '/', (req, res) => {
  serveStatic(res, 'index.html', 'text/html');
}, { public: true });

route('GET', '/manifest.json', (req, res) => {
  serveStatic(res, 'manifest.json', 'application/json');
}, { public: true });

route('GET', '/service-worker.js', (req, res) => {
  serveStatic(res, 'service-worker.js', 'application/javascript');
}, { public: true });


// Serve videos from public/videos/
route('GET', '/videos/:id', (req, res, params) => {
  const videoPath = path.join(PUBLIC_DIR, 'videos', params.id + '.mp4');
  if (!fs.existsSync(videoPath)) return json(res, { error: 'Video not found' }, 404);
  const stat = fs.statSync(videoPath);
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=86400',
  });
  fs.createReadStream(videoPath).pipe(res);
}, { public: true });

function serveStatic(res, filePath, contentType) {
  const fullPath = path.join(PUBLIC_DIR, filePath);
  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
    res.end(content);
  } catch {
    json(res, { error: 'Not found' }, 404);
  }
}

// ── Knowledge Graph API (Phase 19) ──
route('GET', '/api/graph/search', async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const q = url.searchParams.get('q') || '';
  const type = url.searchParams.get('type') || null;
  const limit = parseInt(url.searchParams.get('limit') || '10', 10);
  if (!q) return json(res, { error: 'Missing q parameter' }, 400);
  const entities = await searchEntities(q, type, limit);
  json(res, { ok: true, entities });
});

route('GET', '/api/graph/stats', async (req, res) => {
  const stats = await getGraphStats();
  json(res, { ok: true, stats });
});

route('GET', '/api/graph/export', async (req, res) => {
  const data = await exportGraphForVisualization();
  json(res, { ok: true, ...data });
});

// ── Self-Evolution API (Phase 20) ──
route('GET', '/api/evolution/stats', (req, res) => {
  json(res, {
    ok: true,
    evaluation: getEvaluationStats(),
    modelPerformance: getModelPerformanceReport(),
    abTests: getAllABTestResults(),
  });
});

route('GET', '/api/evolution/gaps', async (req, res) => {
  const gaps = await detectKnowledgeGaps();
  json(res, { ok: true, ...gaps });
});

route('GET', '/api/evolution/models', (req, res) => {
  json(res, { ok: true, models: getModelPerformanceReport() });
});

// ── Performance / Cache API (Phase 17) ──
route('GET', '/api/cache/stats', async (req, res) => {
  const stats = await getEmbeddingCacheStats();
  json(res, { ok: true, cache: stats });
});

route('GET', '/api/videos', async (req, res) => {
  const videos = await listVideos();
  json(res, { ok: true, videos });
});

route('POST', '/api/videos/cleanup', async (req, res) => {
  const cleaned = await cleanupOldVideos(48);
  json(res, { ok: true, cleaned });
});

// ── Shadow Review API ──
route('POST', '/api/review/start', async (req, res) => {
  const body = await parseBody(req);
  const { userId, level = 1 } = body;
  if (!userId) return json(res, { error: 'Missing userId' }, 400);
  const { startShadowReview } = await import('./agents/MentorAgent.js');
  const result = await startShadowReview(userId, level);
  json(res, result);
});

route('POST', '/api/review/submit', async (req, res) => {
  const body = await parseBody(req);
  const { userId, sessionId, code, language = 'cpp' } = body;
  if (!userId || !sessionId || !code) return json(res, { error: 'Missing userId, sessionId, or code' }, 400);
  const { submitReviewAnswer } = await import('./agents/MentorAgent.js');
  const result = await submitReviewAnswer(userId, sessionId, code, language);
  json(res, result);
});

route('POST', '/api/review/hint', async (req, res) => {
  const body = await parseBody(req);
  const { userId, sessionId } = body;
  if (!userId || !sessionId) return json(res, { error: 'Missing userId or sessionId' }, 400);
  const { getNextHint } = await import('./agents/MentorAgent.js');
  const result = await getNextHint(userId, sessionId);
  json(res, result);
});

// ── Incident Simulator API ──
route('POST', '/api/incident/start', async (req, res) => {
  const body = await parseBody(req);
  const { userId, difficulty = 'medium' } = body;
  if (!userId) return json(res, { error: 'Missing userId' }, 400);
  const { generateIncident } = await import('./agents/IncidentAgent.js');
  const result = await generateIncident(userId, difficulty);
  json(res, result);
});

route('POST', '/api/incident/hotfix', async (req, res) => {
  const body = await parseBody(req);
  const { userId, sessionId, code, language = 'cpp' } = body;
  if (!userId || !sessionId || !code) return json(res, { error: 'Missing userId, sessionId, or code' }, 400);
  const { getIncidentSession, evaluateHotfix } = await import('./agents/IncidentAgent.js');
  const session = getIncidentSession(sessionId);
  if (!session) return json(res, { error: 'Session not found' }, 404);
  const result = await evaluateHotfix(session.incident, code, language);
  json(res, result);
});

// ── Lazy Agents API (Phase 17) ──
route('GET', '/api/agents/stats', async (req, res) => {
  const { getStats } = await import('./lib/lazy_agents.js');
  json(res, { ok: true, agents: getStats() });
});

// ── Graph-Enhanced RAG API (Phase 19) ──
route('GET', '/api/graph-rag/stats', async (req, res) => {
  const { getGraphRagStats } = await import('./lib/graph_rag.js');
  const stats = await getGraphRagStats();
  json(res, { ok: true, ...stats });
});

// ═══════════════════════════════════════════
// ── Discord Interactions (Serverless Bot) ──
// ═══════════════════════════════════════════
// Discord sends interaction events here via HTTP POST.
// This replaces the WebSocket-based discord_bot.js for Cloud Run.
// Imports are at top of file (ESM static imports).

route('POST', '/discord/interactions', async (req, res) => {
  // req.rawBody and req.body are pre-populated by the server's body reader.
  // handleInteraction verifies Ed25519 signature using req.rawBody.
  await handleInteraction(req, res);
}, { public: true });

// ═══════════════════════════════════════════
// ── Cloud Scheduler Triggers ──
// ═══════════════════════════════════════════
// Google Cloud Scheduler → HTTP POST → /scheduler/:job
// Replaces node-cron scheduler.js for serverless operation.
// Imports are at top of file (ESM static imports).

route('POST', '/scheduler/:job', async (req, res, params) => {
  const jobName = params.job;

  try {
    const result = await handleJob(jobName);
    // Return 200 even on failure — Cloud Scheduler retries on 5xx only
    json(res, result, 200);
  } catch (err) {
    json(res, { ok: false, error: err.message }, 500);
  }
}, { public: true });

// ── 404 Handler ──
function notFound(res) {
  json(res, { error: 'Not found' }, 404);
}

// ═══════════════════════════════════════════
// ── Server ──
// ═══════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  // Global request timeout — prevents silent hangs
  const REQUEST_TIMEOUT = 120_000; // 2 minutes max per request
  const reqTimer = setTimeout(() => {
    if (!res.writableEnded) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway timeout — request took too long' }));
    }
  }, REQUEST_TIMEOUT);
  if (typeof reqTimer.unref === 'function') reqTimer.unref();

  const url = new URL(req.url, `http://localhost${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // IP filtering
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!isIpAllowed(clientIp)) {
    auditLog(req, { action: 'ip_blocked', status: 'denied' });
    return json(res, { error: 'Forbidden — IP not allowed' }, 403);
  }

  // Rate limiting
  const rl = checkRateLimit(clientIp);
  if (!rl.ok) return json(res, { error: rl.error }, rl.status);

  // Body size check
  const bodySize = checkBodySize(req.headers['content-length']);
  if (!bodySize.ok) return json(res, { error: bodySize.error }, 413);

  // Read raw body (needed for Discord signature verification + general parsing)
  const rawBody = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  // Attach raw body and parsed JSON to req for handlers
  req.rawBody = rawBody;
  try { req.body = JSON.parse(rawBody || '{}'); } catch { req.body = {}; }

  // Route matching
  const matched = matchRoute(method, pathname);
  if (!matched) return notFound(res);

  // Auth check (skip for public routes)
  if (!matched.isPublic) {
    const auth = authenticate(req);
    if (!auth.ok) return json(res, { error: auth.error }, auth.status);
  }

  // Execute handler
  try {
    await matched.handler(req, res, matched.params);
  } catch (err) {
    console.error('[API Error]', err.message);
    json(res, { error: 'Internal server error' }, 500);
  } finally {
    clearTimeout(reqTimer);
  }
});

server.listen(PORT, () => {
  console.log(`[REST API] Server listening on http://localhost:${PORT}`);
  console.log(`[REST API] Health check: http://localhost:${PORT}/api/health`);
  const keyStatus = !API_KEY ? '⚠️  MISSING (set REST_API_KEY in .env)' : (API_KEY === 'change-me-in-production' ? '⚠️  DEFAULT (set REST_API_KEY in .env)' : '✅ Custom');
  console.log(`[REST API] API Key: ${keyStatus}`);
});

// Graceful shutdown for PM2
function gracefulShutdown(signal) {
  console.log(`[REST API] Received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export { server };
