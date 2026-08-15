import crypto from 'node:crypto';
import { query } from './db.js';

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /"?(password|token|api[_-]?key|secret)"?\s*[:=]\s*"?[^\s,"}]+/gi,
];

export function sanitizeLogText(value, maxLength = 500) {
  let text = String(value || '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text.slice(0, maxLength);
}

export function requestContextMiddleware(req, res, next) {
  req.requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 80);
  res.setHeader('X-Request-Id', req.requestId);
  const started = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - started;
    if (res.statusCode >= 500) {
      console.error(`[${req.requestId}] ${req.method} ${req.path} -> ${res.statusCode} (${latency}ms)`);
    } else if (latency > 5000) {
      console.warn(`[${req.requestId}] slow ${req.method} ${req.path} -> ${res.statusCode} (${latency}ms)`);
    }
  });
  next();
}

export async function recordSystemError({ req, error, statusCode = 500, errorCode = '' }) {
  const message = sanitizeLogText(error?.message || errorCode || 'UNKNOWN_ERROR', 500);
  const code = sanitizeLogText(errorCode || error?.code || error?.name || 'SERVER_ERROR', 80);
  try {
    await query(
      `INSERT INTO system_error_logs (request_id, user_id, method, path, status_code, error_code, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req?.requestId || null,
        req?.user?.id || null,
        String(req?.method || '').slice(0, 10) || null,
        String(req?.path || '').slice(0, 255) || null,
        Number(statusCode || 500),
        code,
        message,
      ],
    );
  } catch {
    // Monitoring không được làm request chính thất bại thêm.
  }
}

export async function recordAiUsage({
  userId = null,
  route = 'unknown',
  keyId = null,
  keyLabel = '',
  status = 'ERROR',
  httpStatus = null,
  latencyMs = 0,
  promptChars = 0,
  responseChars = 0,
  errorCode = '',
}) {
  try {
    await query(
      `INSERT INTO ai_usage_events
       (user_id, route_name, api_key_id, key_label, status, http_status, latency_ms, prompt_chars, response_chars, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        String(route || 'unknown').slice(0, 80),
        keyId || null,
        String(keyLabel || '').slice(0, 80) || null,
        String(status || 'ERROR').slice(0, 24),
        httpStatus ? Number(httpStatus) : null,
        Math.max(0, Number(latencyMs) || 0),
        Math.max(0, Number(promptChars) || 0),
        Math.max(0, Number(responseChars) || 0),
        sanitizeLogText(errorCode, 120) || null,
      ],
    );
  } catch {
    // Không chặn AI chỉ vì bảng monitoring gặp lỗi.
  }
}
