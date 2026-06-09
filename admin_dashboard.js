/**
 * Admin Dashboard — Web UI for AI Brain
 * Port: 3003
 *
 * Features:
 * - Flashcard management (CRUD)
 * - Real-time log streaming (SSE)
 * - Agent control panel (toggle on/off)
 * - System stats
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ADMIN_DASHBOARD_PORT || 3003);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Health check ──
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // ── API: Flashcard stats ──
  if (url.pathname === '/api/stats') {
    try {
      const { getCacheStats } = await import('./lib/embedding_cache.js');
      const stats = await getCacheStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ── Serve static files ──
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>AI Brain Admin Dashboard</h1><p>Status: Running</p>');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Bind to 0.0.0.0 to accept connections from outside the VM
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[AdminDashboard] Running on http://0.0.0.0:${PORT}`);
});
