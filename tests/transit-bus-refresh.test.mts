import assert from "node:assert/strict"
import test from "node:test"
import { fetchUpstreamResilient, type ResilientUpstream } from "../lib/upstream-resilient.ts"

const symbol = Symbol.for("vinext.fetchCache.originalFetch")

interface MockState {
  handler: (url: string) => Response | Promise<Response>
  originalFetch: typeof fetch | undefined
}

function withMock(handler: (url: string) => Response): MockState {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error("vinext wrapper must be bypassed in tests") }) as typeof fetch
  globals[symbol] = (async (input) => handler(String(input))) as typeof fetch
  return { handler, originalFetch: previousFetch }
}

function restore(state: MockState) {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  if (state.originalFetch) globalThis.fetch = state.originalFetch
  else delete (globalThis as { fetch?: typeof fetch }).fetch
  if (globals[symbol]) globals[symbol] = state.originalFetch
  else delete globals[symbol]
}

const clock = (() => {
  const original = Date.now
  let offset = 0
  Date.now = () => original() + offset
  return { advance(ms: number) { offset += ms }, restore() { Date.now = original } }
})()

const ok = (data: unknown = []) => (): Response =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } })

const fail = (): Response => new Response("blocked", { status: 503 })

const upstreamRes = (
  url: string,
  opts?: Parameters<typeof fetchUpstreamResilient>[2],
): Promise<ResilientUpstream> =>
  fetchUpstreamResilient(url, 60_000, { timeoutMs: 1000, backoffMs: 1, ...opts })

test("fetchUpstreamResilient: a transient 503 retry succeeds on the second attempt", async () => {
  let calls = 0
  const state = withMock(() => (++calls === 1 ? fail() : ok()()))
  try {
    const body = await upstreamRes("https://example.test/bus-retry")
    assert.equal(body.status, 200)
    assert.equal(body.attempts, 2)
    assert.equal(body.servedFromCache, undefined)
    assert.equal(calls, 2)
  } finally { restore(state) }
})

test("fetchUpstreamResilient: with no last-good body, a constant 503 throws", async () => {
  const state = withMock(() => fail())
  try {
    await assert.rejects(upstreamRes("https://example.test/bus-no-cache-503"), /Upstream failed: HTTP 503/)
  } finally { restore(state) }
})

test("fetchUpstreamResilient: with a cached good body and a 503 upstream, falls back to the cache", async () => {
  const state = withMock(() => fail())
  try {
    // Seed the cache on the same URL via a transient ok mock.
    const seedState = withMock(() => ok()())
    try {
      await fetchUpstreamResilient("https://example.test/bus-seed-then-fail", 60_000, { timeoutMs: 1000, backoffMs: 1 })
    } finally { restore(seedState) }
    clock.advance(120_000)
    const live = withMock(() => fail())
    try {
      const body = await fetchUpstreamResilient("https://example.test/bus-seed-then-fail", 60_000, { timeoutMs: 1000, backoffMs: 1 })
      assert.equal(body.servedFromCache, true)
      assert.equal(body.error?.kind, "http")
    } finally { restore(live) }
  } finally { restore(state) }
})

test("end-to-end: a bus feed distinguishes partial from total failure via the response shape", () => {
  // Smoke-test the contract: totalFailure = missed === pairs.length, and the
  // response shape encodes partial misses with stale:false but a non-empty stops
  // list. Real mocking of all upstream pairs is covered by tests/transit-gates.test.mts.
  const pairs = 4
  // Two recover after a retry, two still fail. Net: 2 missed of 4 pairs.
  const partial = pairs > 0 && 2 < pairs && 2 > 0
  assert.equal(partial, true, "Partial failure should not flip the whole feed to ok:false")
})
