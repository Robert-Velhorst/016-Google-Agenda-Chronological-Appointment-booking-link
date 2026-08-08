'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GoogleCalendarProvider } = require('../src/google-provider');

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
