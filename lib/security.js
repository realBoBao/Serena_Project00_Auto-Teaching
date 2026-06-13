/**
 * lib/security.js — Security utilities cho REST API
 */

/**
 * Lấy security headers cho response.
 */
export function getSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'self'",
  };
}

/**
 * Validate API key từ Authorization header.
 */
export function validateApiKey(token) {
  const API_KEY = process.env.REST_API_KEY || 'change-me-in-production';
  if (!token || token !== API_KEY) return false;
  return true;
}

/**
 * Kiểm tra IP có được phép truy cập không.
 */
export function isIpAllowed(clientIp) {
  const allowedIps = (process.env.ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedIps.length === 0) return true; // No IP restriction
  return allowedIps.includes(clientIp);
}

/**
 * Kiểm tra body size có hợp lệ không.
 */
export function checkBodySize(contentLength) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (!contentLength) return { ok: true };
  const size = parseInt(contentLength, 10);
  if (size > maxSize) return { ok: false, error: 'Request body too large' };
  return { ok: true };
}

/**
 * Audit log cho security events.
 */
export function auditLog(req, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    method: req.method,
    path: req.url,
    ...details,
  };
  console.log('[AUDIT]', JSON.stringify(entry));
}
