import { ApiError } from '../services/auth.js';
import { randomUUID } from 'node:crypto';

export function requestContext(req, res, next) {
  req.id = randomUUID();
  res.set('X-Request-ID', req.id);
  const start = performance.now();
  res.once('finish', () => console.info(JSON.stringify({
    event: 'http_request', requestId: req.id, method: req.method,
    status: res.statusCode, durationMs: Math.round(performance.now() - start),
  })));
  next();
}

function sendError(req, res, status, code, message, details) {
  res.status(status).json({ success: false, error: { code, message, details }, requestId: req.id });
}

export function notFound(req, res) {
  sendError(req, res, 404, 'NOT_FOUND', 'The requested endpoint was not found.');
}

export function handleError(err, req, res, next) {
  void next;
  if (res.headersSent) {
    console.error(JSON.stringify({ event: 'http_stream_error', requestId: req.id }));
    return res.destroy();
  }
  if (err instanceof ApiError) return sendError(req, res, err.status, err.code, err.message, err.details);
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ER_NO_SUCH_TABLE', 'ER_BAD_DB_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ER_CON_COUNT_ERROR'].includes(err.code)) return sendError(req, res, 503, 'DATABASE_UNAVAILABLE', 'Account services are unavailable. Try again later.');
  if (err.type === 'entity.parse.failed') return sendError(req, res, 400, 'INVALID_JSON', 'Send a valid JSON body.');
  if (err.type === 'entity.too.large') return sendError(req, res, 413, 'BODY_TOO_LARGE', 'The request body exceeds the size limit.');
  if (err.status >= 400 && err.status < 500) return sendError(req, res, err.status, 'INVALID_REQUEST', 'Check the request and try again.');
  console.error(JSON.stringify({ event: 'http_error', requestId: req.id, name: err.name,
    code: typeof err.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(err.code) ? err.code : undefined,
    errno: Number.isInteger(err.errno) ? err.errno : undefined,
  }));
  sendError(req, res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}




