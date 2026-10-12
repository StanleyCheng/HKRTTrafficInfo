import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fetchOfficial } from '../lib/official-fetch.ts';
import { getCameraData } from '../lib/traffic-client.ts';
import { fetchUpstream } from '../lib/upstream.ts';
import { politeQueue, ETA_REFRESH_TIMEOUT_MS } from '../lib/polite-fetch.ts';
import { loadCitybusNear } from '../lib/citybus-feed.ts';

test('official downloads retry interrupted bodies, but not permanent or rate-limit responses', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1 ? new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection dropped')); } })) : new Response('recovered');
  });
  assert.equal(await (await fetchOfficial('https://example.test/body', { backoffMs: 0 })).text(), 'recovered');
  assert.equal(calls, 2);
  for (const status of [404, 429]) {
    calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('unavailable', { status }); });
    await assert.rejects(fetchOfficial('https://example.test/error', { backoffMs: 0 }), new RegExp(String(status)));
    assert.equal(calls, 1);
  }
});

test('official body timeout aborts the download and permits one bounded retry', async t => {
  let calls = 0, aborted = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls++;
    if (calls > 1) return new Response('recovered');
    return new Response(new ReadableStream({ start(controller) {
      options.signal!.addEventListener('abort', () => { aborted++; controller.error(options.signal!.reason); }, { once: true });
    } }));
  });
  assert.equal(await (await fetchOfficial('https://example.test/timeout', { timeoutMs: 10, retryTimeoutMs: 10, backoffMs: 0 })).text(), 'recovered');
  assert.equal(calls, 2);
  assert.equal(aborted, 1);
});

test('manual original-feed refresh bypasses cache while ordinary reads still reuse it', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('<image-list><image><key>fixture</key><description>Camera</description><latitude>22.3</latitude><longitude>114.1</longitude><url>https://example.test/photo.jpg</url></image></image-list>');
  });
  const first = await getCameraData('snapshot');
  assert.equal(calls, 2);
  assert.equal(await getCameraData('snapshot'), first);
  assert.equal(calls, 2);
  const refreshed = await getCameraData('snapshot', { force: true });
  assert.notEqual(refreshed, first);
  assert.equal(calls, 4);
});

test('aborting one upstream consumer leaves the shared request usable for another', async t => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; await gate; return new Response('shared result'); });
  const controller = new AbortController();
  const first = fetchUpstream('https://example.test/shared-consumer', 30000, { signal: controller.signal });
  const second = fetchUpstream('https://example.test/shared-consumer', 30000);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await setImmediate();
  controller.abort();
  await rejected;
  release();
  assert.equal(new TextDecoder().decode((await second).body), 'shared result');
  assert.equal(calls, 1);
});

test('expired queued work never starts and an abandoned producer still occupies its slot', async () => {
  const queue = politeQueue(1), active = new AbortController(), waiting = new AbortController();
  let release!: () => void, started = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const producer = queue(async () => { started++; await gate; return 'first'; }, active.signal);
  await setImmediate();
  const queued = queue(async () => { started++; return 'cancelled'; }, waiting.signal);
  const producerRejected = assert.rejects(producer, { name: 'AbortError' });
  const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
  waiting.abort(); active.abort();
  await Promise.all([producerRejected, queuedRejected]);
  const next = queue(async () => { started++; return 'next'; });
  await setImmediate();
  assert.equal(started, 1, 'An aborted consumer must not release an active producer slot early');
  release();
  assert.equal(await next, 'next');
  assert.equal(started, 2, 'Cancelled queued work must never start');
});

test('a bus refresh deadline includes queued stops and reports unfinished arrivals as a failure', { timeout: 1000 }, async t => {
  let release!: () => void, started = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const deadline = new AbortController();
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => ms === ETA_REFRESH_TIMEOUT_MS ? deadline.signal : nativeTimeout(ms));
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => { started++; await gate; return Response.json({ data: [] }); });
  const timer = setTimeout(() => deadline.abort(new DOMException('Batch expired', 'TimeoutError')), 20);
  try {
    const result = await loadCitybusNear(114.17, 22.32, Date.now(), 15);
    assert.ok(result.stops.length > 0);
    assert.equal(result.stale, true);
    assert.ok(result.error, 'Unfinished ETA requests must not be reported as a successful refresh');
    assert.ok(started > 0 && started <= 6, 'The whole batch must keep the shared concurrency limit');
    const before = started;
    release();
    await setImmediate();
    assert.equal(started, before, 'Cancelled queued stops must not start after the response has returned');
  } finally {
    clearTimeout(timer);
    release();
  }
});
