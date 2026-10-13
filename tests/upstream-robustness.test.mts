import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchUpstream, lastGoodUpstream } from '../lib/upstream.ts';
import { fetchOfficial } from '../lib/official-fetch.ts';
import { getCameraData } from '../lib/traffic-client.ts';

test('a timed-out shared-cache body cannot replace a newer network body', async t => {
  let release!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    release = () => { controller.enqueue(new TextEncoder().encode('older cache')); controller.close(); };
  } });
  // Some browsers and Node do not provide CacheStorage; restore explicitly.
  const oldCaches = globalThis.caches;
  let network = 0;
  globalThis.caches = { open: async () => ({
    match: async () => new Response(body, { headers: { 'X-Feed-Fetched-At': new Date().toISOString() } }),
    put: async () => {},
  }) } as unknown as CacheStorage;
  t.mock.method(globalThis, 'fetch', async () => { network++; return new Response('new network'); });
  try {
    const url = 'https://example.test/late-cache-body';
    assert.equal(new TextDecoder().decode((await fetchUpstream(url, 60_000, { timeoutMs: 2000 })).body), 'new network');
    release();
    await delay(1);
    assert.equal(new TextDecoder().decode((await fetchUpstream(url, 60_000)).body), 'new network');
    assert.equal(network, 1);
  } finally { globalThis.caches = oldCaches; }
});

test('a stalled upstream body clears its producer so a later refresh can recover', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1 ? new Response(new ReadableStream()) : new Response('recovered');
  });
  const url = 'https://example.test/stalled-upstream-body';
  // Keep Node alive while AbortSignal.timeout is pending (its timer is unrefed).
  const alive = delay(50);
  await assert.rejects(fetchUpstream(url, 60_000, { timeoutMs: 10 }), { name: 'TimeoutError' });
  await delay(1);
  assert.equal(new TextDecoder().decode((await fetchUpstream(url, 60_000, { timeoutMs: 100 })).body), 'recovered');
  assert.equal(calls, 2);
  await alive;
});

test('HTTP failures surface immediately even when their error body stalls', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 }));
  const response = await fetchUpstream('https://example.test/stalled-error-page', 60_000, { timeoutMs: 100 });
  assert.equal(response.status, 503);
  assert.equal(cancelled, true);
});

test('malformed JSON success cannot replace the last-good upstream body', async t => {
  let malformed = false, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(malformed ? '{"partial":' : '{"arrivals":[1]}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });
  const url = 'https://example.test/invalid-json';
  const good = await fetchUpstream(url, 0);
  malformed = true;
  await assert.rejects(fetchUpstream(url, 0), { name: 'SyntaxError' });
  assert.equal(lastGoodUpstream(url), good);
  malformed = false;
  assert.equal((await fetchUpstream(url, 0)).status, 200);
  assert.equal(calls, 3, 'Rejected JSON must not leave pending or a fresh corrupt cache entry');
});

test('official external cancellation interrupts a stalled body without a retry', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(new ReadableStream()); });
  const controller = new AbortController();
  const task = fetchOfficial('https://example.test/cancel-official', { signal: controller.signal, backoffMs: 0 });
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await delay(1);
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
});

test('malformed original feed successes cannot clear incident notices or parking vacancies', async t => {
  let incident = '<body><message><msgID>notice</msgID><ChinText>交通消息</ChinText></message></body>';
  let vacancy: unknown = { results: [{ park_Id: 'fixture', privateCar: [{ vacancy_type: 'A', vacancy: 9 }] }] };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('specialtrafficnews.xml')) return new Response(incident);
    return Response.json(url.searchParams.get('data') === 'vacancy' ? vacancy : {
      results: [{ park_Id: 'fixture', name: 'Car park', latitude: 22.3, longitude: 114.1, privateCar: { space: 20 } }],
    });
  });
  const notices = await getCameraData('incident', { force: true });
  assert.equal(notices.notices?.length, 1);
  incident = '<html><body>Service unavailable</body></html>';
  await assert.rejects(getCameraData('incident', { force: true }), /交通消息格式不符/);
  assert.equal(await getCameraData('incident'), notices);
  incident = '<body><message><msgID>partial</msgID><ChinText>Incomplete notice</ChinText></message>';
  await assert.rejects(getCameraData('incident', { force: true }), /交通消息格式不符/);
  assert.equal(await getCameraData('incident'), notices, 'Truncated XML cannot remove the rest of a bulletin');
  incident = '<body/>';
  assert.equal((await getCameraData('incident', { force: true })).notices?.length, 0, 'A valid empty bulletin still clears resolved notices');

  const parking = await getCameraData('parking', { force: true });
  assert.equal(parking.cameras[0].parkingSpaces?.[0].available, 9);
  vacancy = { error: 'Service unavailable' };
  await assert.rejects(getCameraData('parking', { force: true }), /空位數據格式不符/);
  assert.equal(await getCameraData('parking'), parking);
});

test('optional incident geocoding shares one deadline and keeps all notices visible', async t => {
  const deadline = new AbortController();
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => ms === 5000 ? deadline.signal : nativeTimeout(ms));
  let lookups = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (new URL(String(input)).hostname === 'www.als.gov.hk') {
      lookups++;
      return new Response(new ReadableStream());
    }
    return new Response('<body><message><msgID>1</msgID><EngText>Budget Test Road</EngText></message><message><msgID>2</msgID><EngText>Another Test Street</EngText></message></body>');
  });
  const task = getCameraData('incident', { force: true });
  await delay(1);
  deadline.abort(new DOMException('Optional lookup budget expired', 'TimeoutError'));
  const data = await task;
  assert.equal(data.notices?.length, 2);
  assert.ok(data.notices?.every(notice => !notice.located));
  assert.equal(lookups, 1, 'After the common deadline no more optional lookups may start');
});

test('failed geocoding retries after its short negative-cache lifetime', async t => {
  const originalNow = Date.now;
  let elapsed = 0, lookups = 0;
  t.mock.method(Date, 'now', () => originalNow() + elapsed);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (new URL(String(input)).hostname === 'www.als.gov.hk') {
      lookups++;
      if (lookups === 1) return new Response('offline', { status: 404 });
      return Response.json({ SuggestedAddress: [{ ValidationInformation: { Score: 90 }, Address: { PremisesAddress: { GeospatialInformation: { Latitude: '22.3', Longitude: '114.1' } } } }] });
    }
    return new Response('<body><message><msgID>recovery</msgID><EngText>Recovery Test Road</EngText></message></body>');
  });
  assert.equal((await getCameraData('incident', { force: true })).notices?.[0].located, false);
  assert.equal((await getCameraData('incident', { force: true })).notices?.[0].located, false);
  assert.equal(lookups, 1);
  elapsed = 60_001;
  assert.equal((await getCameraData('incident', { force: true })).notices?.[0].located, true);
  assert.equal(lookups, 2);
});
