'use strict';

const http = require('node:http');

const source = new URL(process.env.HAI_SOURCE_URL || 'http://booking:8787');
const token = process.env.HAI_CONNECTOR_TOKEN || '';
const port = Number(process.env.PORT || 8790);
const host = process.env.HOST || '0.0.0.0';
const timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS || 10000);
if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.search || source.hash) {
  throw new Error('HAI_SOURCE_URL must be an HTTP(S) origin or base path without credentials, query, or fragment');
}
if (token.length < 32) throw new Error('HAI_CONNECTOR_TOKEN must contain at least 32 characters');

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://connector.local');
  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
  if (req.method !== 'GET' || url.pathname !== '/feed') return json(res, 404, { error: 'not_found' });
  const upstream = new URL('api/integrations/hai/feed', source.href.endsWith('/') ? source : `${source.href}/`);
  if (url.searchParams.has('cursor')) upstream.searchParams.set('cursor', url.searchParams.get('cursor'));
  if (url.searchParams.has('limit')) upstream.searchParams.set('limit', url.searchParams.get('limit'));
  try {
    const response = await fetch(upstream, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('upstream response exceeded 2 MB');
    res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return res.end(body);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'HAI upstream request failed', reason: error.name }));
    return json(res, 502, { error: 'upstream_unavailable' });
  }
});
server.requestTimeout = timeoutMs + 2000;
server.headersTimeout = 5000;
server.listen(port, host, () => console.log(`HAI connector listening on http://${host}:${port}`));

function shutdown() { server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
