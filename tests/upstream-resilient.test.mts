import test from "node:test"
import assert from "node:assert/strict"
import { fetchUpstreamResilient } from "../lib/upstream-resilient.ts"

const symbol = Symbol.for("vinext.fetchCache.originalFetch")

interface MockState {
  calls: number
  handler: () => Response | Promise<Response>
  originalFetch: typeof fetch | undefined
}

async function withMock(handler: () => Response): Promise<MockState> {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  const previousFetch = globalThis.fetch
  const state: MockState = { calls: 0, handler, originalFetch: previousFetch }
  globalThis.fetch = (async () => { throw new Error("vinext wrapper must be bypassed in tests") }) as typeof fetch
  globals[symbol] = (async () => {
    state.calls += 1
    return state.handler()
  }) as typeof fetch
  return state
}

function restore(state: MockState) {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  if (state.originalFetch) globalThis.fetch = state.originalFetch
  else delete (globalThis as { fetch?: typeof fetch }).fetch
  if (globals[symbol]) globals[symbol] = state.originalFetch
  else delete globals[symbol]
}

// Expire upstream.ts's memory cache between calls so we exercise the resilient
// fallback path instead of the early-return cache hit.
const clock = (() => {
  const originalNow = Date.now
  let offset = 0
  Date.now = () => originalNow() + offset
  return {
    advance(ms: number) { offset += ms },
    restore() { Date.now = originalNow },
  }
})()

test("retryable 5xx triggers exactly one retry then succeeds", async () => {
  const state = await withMock(() =>
    state.calls === 1
      ? new Response("boom", { status: 503 })
      : new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
  )
  try {
    const body = await fetchUpstreamResilient("https://example.test/5xx-then-ok", 60_000, { timeoutMs: 1000, backoffMs: 1 })
    assert.equal(body.status, 200)
    assert.equal(body.attempts, 2)
    assert.equal(state.calls, 2)
  } finally { restore(state) }
})

test("404 falls back to last-good body after the in-memory cache expires", async () => {
  const state = await withMock(() =>
    state.calls === 1
      ? new Response(JSON.stringify({ ok: "seed" }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("missing", { status: 404 }),
  )
  try {
    const url = "https://example.test/404-stale"
    const first = await fetchUpstreamResilient(url, 60_000, { timeoutMs: 1000, backoffMs: 1 })
    assert.equal(first.status, 200)
    assert.equal(first.servedFromCache, undefined)
    // Expire upstream.ts's memory cache so the next call falls through to mock.
    clock.advance(120_000)
    const second = await fetchUpstreamResilient(url, 60_000, { timeoutMs: 1000, backoffMs: 1 })
    assert.equal(second.status, 200, "Should serve the previously-good body from the resilient cache")
    assert.equal(second.servedFromCache, true)
    assert.equal(second.error?.kind, "http")
    if (second.error && second.error.kind === "http") assert.equal(second.error.status, 404)
    assert.equal(state.calls, 2)
  } finally { restore(state) }
})

test("429 is retryable and falls back to last-good when present", async () => {
  const state = await withMock(() =>
    state.calls === 1
      ? new Response(JSON.stringify({ ok: "seed" }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("rate limited", { status: 429 }),
  )
  try {
    const url = "https://example.test/429-stale"
    await fetchUpstreamResilient(url, 60_000, { timeoutMs: 1000, backoffMs: 1 })
    clock.advance(120_000)
    const body = await fetchUpstreamResilient(url, 60_000, { timeoutMs: 1000, backoffMs: 1 })
    assert.equal(body.attempts, 2, "Default retries is 1 (two attempts total)")
    assert.equal(body.servedFromCache, true)
    assert.equal(body.error?.kind, "http")
    if (body.error && body.error.kind === "http") assert.equal(body.error.status, 429)
    // Seed call was a separate fetchUpstreamResilient, so the mock fired once
    // for the seed and once for each of the two 429 attempts.
    assert.ok(state.calls >= 3)
  } finally { restore(state) }
})

test("404 with no cached body throws after one attempt (404 is not retryable)", async () => {
  const state = await withMock(() => new Response("not found", { status: 404 }))
  try {
    await assert.rejects(
      fetchUpstreamResilient("https://example.test/no-cache-404", 60_000, { timeoutMs: 1000, backoffMs: 1 }),
      /Upstream failed: HTTP 404/,
    )
    assert.equal(state.calls, 1, "404 is not in the default retry set; only one attempt is made")
  } finally { restore(state) }
})

test("always-500 throws because there is no cached body to fall back to", async () => {
  const state = await withMock(() => new Response("kaboom", { status: 500 }))
  try {
    await assert.rejects(
      fetchUpstreamResilient("https://example.test/always-500", 60_000, { timeoutMs: 1000, backoffMs: 1 }),
      /Upstream failed: HTTP 500/,
    )
    assert.equal(state.calls, 2)
  } finally { restore(state) }
})
