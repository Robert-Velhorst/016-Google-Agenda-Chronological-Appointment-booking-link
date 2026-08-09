'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GoogleCalendarProvider } = require('../src/google-provider');
const { testRuntime } = require('./helpers');

test('conflict lookup follows Google pagination and filters ignorable events', async () => {
  const provider = new GoogleCalendarProvider({ config: { providerTimeoutMs: 1000 }, db: {}, vault: {}, fetchImpl: fetch });
  const urls = [];
  provider.request = async (_owner, url) => {
    urls.push(new URL(url));
    if (urls.length === 1) return { data: { items: [{ id: 'busy' }, { id: 'transparent', transparency: 'transparent' }], nextPageToken: 'page-two' } };
    return { data: { items: [{ id: 'excluded' }, { id: 'cancelled', status: 'cancelled' }] } };
  };
  const events = await provider.conflicts('owner','primary','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','excluded');
  assert.deepEqual(events.map((event)=>event.id), ['busy']);
  assert.equal(urls[0].searchParams.get('maxResults'),'2500');
  assert.equal(urls[1].searchParams.get('pageToken'),'page-two');
});

test('provider requests time out with a safe retryable error', async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const provider = new GoogleCalendarProvider({ config: { providerTimeoutMs: 10 }, db: {}, vault: {}, fetchImpl });
  await assert.rejects(() => provider.fetchRequest('https://example.test'), (error) => error.code === 'GOOGLE_NETWORK_ERROR' && error.retryable);
});

test('temporary refresh failures preserve authorization and concurrent refreshes are deduplicated', async (t) => {
  const runtime=testRuntime();t.after(()=>runtime.cleanup());
  runtime.db.prepare(`INSERT OR REPLACE INTO oauth_connections(owner_id,encrypted_tokens,scopes,status,expires_at,updated_at)
    VALUES (?,?,?,'connected',?,?)`).run(runtime.config.ownerId,runtime.vault.encrypt(JSON.stringify({access_token:'old',refresh_token:'refresh'})),'scope','2020-01-01T00:00:00.000Z',new Date().toISOString());
  const unavailable=new GoogleCalendarProvider({config:runtime.config,db:runtime.db,vault:runtime.vault,fetchImpl:async()=>new Response(JSON.stringify({error:'server_error'}),{status:503})});
  await assert.rejects(()=>unavailable.accessToken(runtime.config.ownerId),(error)=>error.retryable);
  assert.equal(runtime.db.prepare('SELECT status FROM oauth_connections WHERE owner_id=?').get(runtime.config.ownerId).status,'connected');

  let requests=0;
  const provider=new GoogleCalendarProvider({config:runtime.config,db:runtime.db,vault:runtime.vault,fetchImpl:async()=>{requests+=1;await new Promise((resolve)=>setTimeout(resolve,20));return new Response(JSON.stringify({access_token:'new',expires_in:3600}),{status:200});}});
  const tokens=await Promise.all([provider.accessToken(runtime.config.ownerId),provider.accessToken(runtime.config.ownerId)]);
  assert.deepEqual(tokens,['new','new']);assert.equal(requests,1);
});
