'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AppError } = require('./errors');
const { safeEqual } = require('./crypto');
const { createRateLimiter } = require('./rate-limit');
const { publicSchedule } = require('./booking-service');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store', ...headers });
  res.end(text);
}

function securityHeaders(res, requestId, config) {
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (new URL(config.baseUrl).protocol === 'https:') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
}

async function readJson(req, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError('BODY_TOO_LARGE', 'Request body is too large.', 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400); }
}

function createApp({ config, service, provider }) {
  const checkRate = createRateLimiter({ windowMs: config.rateLimitWindowMs, publicLimit: config.rateLimitPublic, adminLimit: config.rateLimitAdmin });
  const dist = path.resolve(__dirname, '..', 'dist');

  function admin(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(token, config.adminToken)) throw new AppError('UNAUTHORIZED', 'Operator authentication is required.', 401);
  }

  function hai(req) {
    if (!config.haiConnectorToken) throw new AppError('HAI_NOT_CONFIGURED', 'The HAI connector is not configured.', 503);
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(token, config.haiConnectorToken)) throw new AppError('UNAUTHORIZED', 'HAI connector authentication is required.', 401);
  }

  async function handler(req, res) {
    const requestId = crypto.randomUUID();
    securityHeaders(res, requestId, config);
    try {
      const url = new URL(req.url, config.baseUrl);
      const isAdmin = url.pathname.startsWith('/api/admin');
      const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : req.socket.remoteAddress;
      const rate = checkRate(`${ip}:${isAdmin ? 'admin' : 'public'}`, isAdmin);
      res.setHeader('ratelimit-limit', String(rate.limit));
      res.setHeader('ratelimit-remaining', String(rate.remaining));
      res.setHeader('ratelimit-reset', String(Math.ceil(rate.resetAt / 1000)));
      if (!rate.allowed) throw new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429, true);

      if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/readyz') {
        const status = service.status();
        const ready = !status.emergencyStop && status.google.connected;
        return sendJson(res, ready ? 200 : 503, { status: status.emergencyStop ? 'paused' : ready ? 'ready' : 'provider_not_ready', ...status });
      }
      if (req.method === 'GET' && url.pathname === '/api/integrations/hai/status') {
        hai(req);
        return sendJson(res, 200, { configured: true, authority: 'read_only', schemaVersion: 1 });
      }
      if (req.method === 'GET' && url.pathname === '/api/integrations/hai/feed') {
        hai(req);
        return sendJson(res, 200, service.haiFeed(url.searchParams.get('cursor') || '', url.searchParams.get('limit')));
      }
      if (req.method === 'GET' && url.pathname === '/oauth/google/callback') {
        if (url.searchParams.get('error')) throw new AppError('GOOGLE_CONSENT_DENIED', 'Google authorization was not completed.', 400);
        const ownerId = await provider.completeAuthorization(url.searchParams.get('state') || '', url.searchParams.get('code') || '');
        const html = `<!doctype html><meta charset="utf-8"><title>Google Calendar connected</title><style>body{font:16px system-ui;max-width:640px;margin:80px auto;padding:24px;color:#172033}a{color:#1458d6}</style><h1>Google Calendar connected</h1><p>Authorization was stored securely for ${ownerId}. You can return to the operator dashboard.</p><a href="/">Return to dashboard</a>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
        return res.end(html);
      }

      let match = url.pathname.match(/^\/api\/public\/schedules\/([^/]+)$/);
      if (req.method === 'GET' && match) return sendJson(res, 200, { schedule: publicSchedule(service.scheduleBySlug(decodeURIComponent(match[1]))) });
      match = url.pathname.match(/^\/api\/public\/schedules\/([^/]+)\/slots$/);
      if (req.method === 'GET' && match) {
        const slots = await service.slots(decodeURIComponent(match[1]), Number(url.searchParams.get('duration')), url.searchParams.get('from'), url.searchParams.get('to'));
        return sendJson(res, 200, { slots });
      }
      match = url.pathname.match(/^\/api\/public\/schedules\/([^/]+)\/book$/);
      if (req.method === 'POST' && match) {
        const booking = await service.book(decodeURIComponent(match[1]), await readJson(req), String(req.headers['idempotency-key'] || ''), requestId);
        return sendJson(res, 201, { booking });
      }
      match = url.pathname.match(/^\/api\/public\/bookings\/([^/]+)\/manage$/);
      if (req.method === 'POST' && match) return sendJson(res, 200, { booking: service.managedBooking(match[1], (await readJson(req)).token).response });
      match = url.pathname.match(/^\/api\/public\/bookings\/([^/]+)\/(cancel|reschedule)$/);
      if (req.method === 'POST' && match) {
        const body = await readJson(req);
        const booking = match[2] === 'cancel'
          ? await service.cancel(match[1], body.token, requestId)
          : await service.reschedule(match[1], body.token, body, requestId);
        return sendJson(res, 200, { booking });
      }

      if (isAdmin) admin(req);
      if (req.method === 'GET' && url.pathname === '/api/admin/status') return sendJson(res, 200, service.status());
      if (req.method === 'GET' && url.pathname === '/api/admin/schedules') return sendJson(res, 200, { schedules: service.listSchedules() });
      if (req.method === 'POST' && url.pathname === '/api/admin/schedules') return sendJson(res, 201, { schedule: service.createSchedule(await readJson(req), requestId) });
      match = url.pathname.match(/^\/api\/admin\/schedules\/([^/]+)\/status$/);
      if (req.method === 'PATCH' && match) return sendJson(res, 200, { schedule: await service.setScheduleStatus(match[1], (await readJson(req)).status, requestId) });
      if (req.method === 'GET' && url.pathname === '/api/admin/bookings') return sendJson(res, 200, { bookings: service.listBookings() });
      if (req.method === 'GET' && url.pathname === '/api/admin/audit') return sendJson(res, 200, { audit: service.auditLog() });
      if (req.method === 'POST' && url.pathname === '/api/admin/google/start') return sendJson(res, 200, { authorizationUrl: provider.createAuthorization(config.ownerId) });
      if (req.method === 'POST' && url.pathname === '/api/admin/google/disconnect') {
        await provider.disconnect(config.ownerId);
        return sendJson(res, 200, { google: provider.connectionStatus(config.ownerId) });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/emergency-stop') return sendJson(res, 200, service.setEmergencyStop(Boolean((await readJson(req)).enabled), requestId));
      if (req.method === 'GET' && url.pathname === '/api/admin/export') return sendJson(res, 200, service.exportData(), { 'content-disposition': `attachment; filename="chronological-booking-export-${new Date().toISOString().slice(0, 10)}.json"` });
      if (req.method === 'DELETE' && url.pathname === '/api/admin/data') {
        const body = await readJson(req);
        if (body.confirmation !== 'DELETE LOCAL DATA' || body.acknowledgeGoogleEventsRemain !== true) throw new AppError('DELETION_CONFIRMATION_REQUIRED', 'Confirm local deletion and acknowledge that Google events remain.', 422);
        service.db.exec('BEGIN IMMEDIATE');
        try {
          service.db.prepare('DELETE FROM bookings WHERE schedule_id IN (SELECT id FROM schedules WHERE owner_id=?)').run(config.ownerId);
          service.db.prepare('DELETE FROM schedules WHERE owner_id=?').run(config.ownerId);
          service.db.prepare('DELETE FROM oauth_connections WHERE owner_id=?').run(config.ownerId);
          service.db.prepare('DELETE FROM oauth_states WHERE owner_id=?').run(config.ownerId);
          service.db.prepare('DELETE FROM audit_logs WHERE owner_id=?').run(config.ownerId);
          service.db.prepare(`INSERT INTO audit_logs(owner_id, actor_type, action, entity_type, details_json, created_at)
            VALUES (?, 'operator', 'data.local_deleted', 'system', ?, ?)`)
            .run(config.ownerId, JSON.stringify({ externalGoogleEventsDeleted: false }), new Date().toISOString());
          service.db.exec('COMMIT');
        } catch (error) { service.db.exec('ROLLBACK'); throw error; }
        return sendJson(res, 200, { deleted: true, externalGoogleEventsDeleted: false });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('NOT_FOUND', 'Route not found.', 404);
      const isAsset = url.pathname.startsWith('/assets/');
      const candidate = isAsset ? path.resolve(dist, `.${url.pathname}`) : path.join(dist, 'index.html');
      if (!candidate.startsWith(`${dist}${path.sep}`) || !fs.existsSync(candidate)) throw new AppError('FRONTEND_NOT_BUILT', 'Frontend assets are unavailable. Run npm run build.', 503);
      const body = fs.readFileSync(candidate);
      res.writeHead(200, { 'content-type': MIME[path.extname(candidate)] || 'application/octet-stream', 'content-length': body.length, 'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      return res.end(body);
    } catch (error) {
      const known = error instanceof AppError;
      if (!known) console.error(JSON.stringify({ level: 'error', requestId, message: error.message, stack: config.appEnv === 'development' ? error.stack : undefined }));
      const status = known ? error.status : 500;
      return sendJson(res, status, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'An unexpected error occurred.', retryable: known ? error.retryable : false, ...(known && error.details ? { details: error.details } : {}) }, requestId });
    }
  }

  return handler;
}

module.exports = { createApp, readJson, sendJson };
