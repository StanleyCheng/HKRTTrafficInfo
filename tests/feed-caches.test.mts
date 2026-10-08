import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchUpstream } from '../lib/upstream.ts'
import { cachedFeed } from '../lib/route-cache.ts'
import { viewCachedGet, viewportAllowed } from '../lib/view-cache.ts'
import { keepWorkerRequestAlive } from '../lib/feed-cache.ts'

test('Worker producer survives a disconnected consumer and clears shared state', async () => {
  const symbol = Symbol.for('__cloudflare-context__')
  const globals = globalThis as unknown as Record<symbol, unknown>
  const previous = globals[symbol]
  const retained: Promise<unknown>[] = []
  try {
    globals[symbol] = { ctx: { waitUntil: (promise: Promise<unknown>) => retained.push(promise) } }
    let finish!: (value: { ok: boolean; observedAt: string }) => void
    let calls = 0
    const get = cachedFeed(60000, () => {
      calls++
      return new Promise<{ ok: boolean; observedAt: string }>(resolve => { finish = resolve })
    }, () => ({ ok: false, observedAt: 'failed' }))
    const controller = new AbortController()
    const first = get()
    const disconnected = Promise.race([first, new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('client disconnected')), { once: true })
    })])
    controller.abort()
    await assert.rejects(disconnected, /client disconnected/)
    assert.equal(retained.length, 1, 'Keep the producer alive, not a canceled consumer')
    const second = get()
    assert.equal(calls, 1, 'A later request must still coalesce with retained work')
    finish({ ok: true, observedAt: 'official clock' })
    await Promise.all(retained)
    assert.equal((await (await second).json() as { observedAt: string }).observedAt, 'official clock')
    assert.equal((await (await get()).json() as { observedAt: string }).observedAt, 'official clock')
    assert.equal(calls, 1)
    const failure = Promise.reject(new Error('upstream failed'))
    assert.equal(keepWorkerRequestAlive(failure), failure, 'Retention must preserve the original result/error')
    await assert.rejects(failure, /upstream failed/)
    await Promise.all(retained)
    delete globals[symbol]
    const nodeTask = Promise.resolve('node')
    assert.equal(keepWorkerRequestAlive(nodeTask), nodeTask)
    assert.equal(retained.length, 2, 'Node must not register Worker background work')
  } finally {
    if (previous === undefined) delete globals[symbol]
    else globals[symbol] = previous
  }
})

test('upstream bypasses Vinext wrapper, coalesces fetches, respects shared expiry and memory TTL', async () => {
  const oldFetch = globalThis.fetch, oldCaches = globalThis.caches
  const symbol = Symbol.for('vinext.fetchCache.originalFetch')
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  const oldOriginal = globals[symbol]
  const oldNow = Date.now
  let now = 1_000_000, calls = 0
  const store = new Map<string, Response>()
  try {
    Date.now = () => now
    globalThis.fetch = async () => { throw new Error('Vinext wrapper must be bypassed') }
    globals[symbol] = async () => { calls++; await Promise.resolve(); return new Response('live') }
    // The standard browser Cache API does not expire max-age entries itself.
    globalThis.caches = { open: async () => ({ match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, v: Response) => { store.set(r.url, v.clone()) } }) } as unknown as CacheStorage
    const url = 'https://example.test/ttl'
    await Promise.all([fetchUpstream(url, 100), fetchUpstream(url, 100)])
    assert.equal(calls, 1)
    await fetchUpstream(url, 100)
    assert.equal(calls, 1)
    // Real ISO dates come from Date constructor; explicitly expire the shared record.
    store.set(url, new Response('expired', { headers: { 'X-Feed-Fetched-At': new Date(now - 500).toISOString() } }))
    now += 101
    await fetchUpstream(url, 100)
    assert.equal(calls, 2)
    // A fresh shared hit has only its remaining TTL, never a new full TTL.
    const shared = 'https://example.test/shared-remaining-ttl'
    store.set(shared, new Response('shared', { headers: { 'X-Feed-Fetched-At': new Date(now - 90).toISOString() } }))
    assert.equal(new TextDecoder().decode((await fetchUpstream(shared, 100)).body), 'shared')
    assert.equal(calls, 2)
    now += 11
    await fetchUpstream(shared, 100)
    assert.equal(calls, 3)
    globalThis.caches = undefined as unknown as CacheStorage
    await fetchUpstream('https://example.test/no-cache-api', 100)
    assert.equal(calls, 4)
  } finally { Date.now = oldNow; globalThis.fetch = oldFetch; globalThis.caches = oldCaches; if (oldOriginal) globals[symbol] = oldOriginal; else delete globals[symbol] }
})

test('viewport cache returns stale without changing original timestamps and respects cacheable:false', async () => {
  let failure = false
  let calls = 0
  const get = viewCachedGet<{ ok: boolean; fetchedAt?: string; observedAt: string | null }>({
    freshMs: 0,
    load: async () => { calls++; if (failure) throw Error('offline'); return { ok: true, fetchedAt: '2026-01-01', observedAt: '2025-12-31' } },
    missing: () => ({ ok: false, observedAt: null }), failed: () => ({ ok: false, observedAt: null }),
  })
  const request = new Request('https://local/api/kmb?lng=114.1&lat=22.3&zoom=13')
  await get(request)
  failure = true
  const stale = await (await get(request)).json() as { stale: boolean; fetchedAt: string; observedAt: string }
  assert.equal(stale.stale, true)
  assert.equal(stale.fetchedAt, '2026-01-01')
  assert.equal(stale.observedAt, '2025-12-31')
  assert.equal(calls, 2)
  let partialCalls = 0
  const partial = viewCachedGet<{ ok: boolean; cacheable?: boolean }>({ freshMs: 60000, load: async () => { partialCalls++; return { ok: true, cacheable: false } }, missing: () => ({ ok: false }), failed: () => ({ ok: false }) })
  await partial(request)
  await partial(request)
  assert.equal(partialCalls, 2)
})

test('parsed feed failure preserves observation/fetch timestamps and marks stale', async () => {
  let fail = false, calls = 0
  const get = cachedFeed<{ ok: boolean; observedAt: string | null; fetchedAt?: string }>(0, async () => { calls++; if (fail) throw Error('offline'); return { ok: true, observedAt: '2026-01-01', fetchedAt: '2026-01-02' } }, () => ({ ok: false, observedAt: null, fetchedAt: undefined }))
  await Promise.all([get(), get()])
  assert.equal(calls, 1)
  fail = true
  const stale = await (await get()).json() as { stale: boolean; observedAt: string; fetchedAt: string }
  assert.equal(stale.stale, true)
  assert.equal(stale.observedAt, '2026-01-01')
  assert.equal(stale.fetchedAt, '2026-01-02')
})

test('viewport validation and gates prevent requests, including hosted base paths', async () => {
  let calls = 0
  const get = viewCachedGet<{ ok: boolean; stops: unknown[]; observedAt: string | null }>({ freshMs: 0, load: async () => { calls++; return { ok: true, stops: [], observedAt: 'original' } }, missing: () => ({ ok: false, stops: [], observedAt: null }), failed: () => ({ ok: false, stops: [], observedAt: null }) })
  for (const query of ['', '?lng=114&lat=22', '?lng=&lat=22&zoom=17', '?lng=NaN&lat=22&zoom=17']) {
    assert.equal((await get(new Request(`https://local/api/gmb${query}`))).status, 400)
  }
  for (const path of ['/api/gmb', '/HKRTTrafficInfo/api/gmb', '/api/gmb/places']) {
    assert.equal((await (await get(new Request(`https://local${path}?lng=114&lat=22&zoom=16`))).json() as { gated: boolean }).gated, true)
  }
  assert.equal(calls, 0)
  assert.equal(viewportAllowed('nlb', 114.2, 22.3, 18), false)
  assert.equal(viewportAllowed('nlb', 113.95, 22.3, 13), true)
  assert.equal(viewportAllowed('kmb', 114, 22, 12), false)
  assert.equal(viewportAllowed('citybus', 114, 22, 13), true)
  await Promise.all([get(new Request('https://local/api/gmb?lng=114&lat=22&zoom=17')), get(new Request('https://local/api/gmb?lng=114&lat=22&zoom=17'))])
  assert.equal(calls, 1)
})
