import test from "node:test"
import assert from "node:assert/strict"
import { fetchUpstreamResilient } from "../lib/upstream-resilient.ts"

const symbol = Symbol.for("vinext.fetchCache.originalFetch")

interface CapturedLog {
  source?: string
  event?: string
  [key: string]: unknown
}

interface CaptureState {
  logs: CapturedLog[]
}

async function captureAcrossTest(callback: (state: CaptureState) => Promise<void>): Promise<void> {
  const original = console.error
  ;(globalThis as { __capturedOriginalConsoleError?: (...args: unknown[]) => void }).__capturedOriginalConsoleError = original
  const state: CaptureState = { logs: [] }
  console.error = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === "string") {
        try { state.logs.push(JSON.parse(arg)) } catch { state.logs.push({ raw: arg }) }
      } else state.logs.push({ raw: arg })
    }
  }
  try {
    await callback(state)
  } finally {
    console.error = original
    delete (globalThis as { __capturedOriginalConsoleError?: (...args: unknown[]) => void }).__capturedOriginalConsoleError
  }
}

async function withMock(handler: (callIndex: number) => Response): Promise<{ calls: number; restore: () => void }> {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  const previousFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => { throw new Error("vinext wrapper must be bypassed in tests") }) as typeof fetch
  globals[symbol] = (async () => {
    calls += 1
    return handler(calls)
  }) as typeof fetch
  return { calls, restore: () => {
    if (previousFetch) globalThis.fetch = previousFetch
    else delete (globalThis as { fetch?: typeof fetch }).fetch
    if (globals[symbol]) globals[symbol] = previousFetch
    else delete globals[symbol]
  } }
}

test("a successful call emits attempt (with status) and a final ok log", async () => {
  const mock = await withMock(() => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } }))
  try {
    await captureAcrossTest(async (logs) => {
      await fetchUpstreamResilient("https://example.test/log-ok", 60_000, { timeoutMs: 1000, backoffMs: 1 })
      const events = logs.logs.map((l) => l.event).filter(Boolean)
      assert.deepEqual(events, ["attempt", "ok"], "First attempt is logged, then a final ok event")
      const okLog = logs.logs.find((l) => l.event === "ok")
      assert.equal(okLog?.attempts, 1)
      assert.equal(okLog?.host, "example.test")
    })
  } finally { mock.restore() }
})

test("a transient 503 retry emits two attempt logs and a final ok", async () => {
  const mock = await withMock((callIndex) => callIndex === 1
    ? new Response("blocked", { status: 503 })
    : new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } }))
  try {
    await captureAcrossTest(async (logs) => {
      const body = await fetchUpstreamResilient("https://example.test/log-retry", 60_000, { timeoutMs: 1000, backoffMs: 1 })
      assert.equal(body.attempts, 2)
      const attempts = logs.logs.filter((l) => l.event === "attempt")
      assert.equal(attempts.length, 2)
      assert.equal(attempts[0]?.outcome, "http-503")
      assert.equal(attempts[1]?.outcome, "ok")
      assert.deepEqual(logs.logs.map((l) => l.event), ["attempt", "attempt", "ok"])
    })
  } finally { mock.restore() }
})

test("total failure falls back to last-good and emits a stale log rather than ok/throw", async () => {
  // Two-phase mock: respond 200 to the first call (seed the cache), 503 to all
  // subsequent calls. The mock instance is shared so we can advance mode.
  let phase: "seed" | "fail" = "seed"
  const mock = await withMock(() => phase === "seed"
    ? new Response(JSON.stringify({ ok: "seed" }), { status: 200, headers: { "content-type": "application/json" } })
    : new Response("blocked", { status: 503 }))
  try {
    await captureAcrossTest(async () => {
      const seed = await fetchUpstreamResilient("https://example.test/log-fallback", 60_000, { timeoutMs: 1000, backoffMs: 1 })
      assert.equal(seed.servedFromCache, undefined, "Seed must succeed")
    })
    phase = "fail"
    // Advance the clock past the memory cache TTL so the second call actually
    // hits the mock instead of returning the fresh seed body.
    const originalNow = Date.now
    const offset = 120_000
    Date.now = () => originalNow() + offset
    try {
      await captureAcrossTest(async (logs) => {
        const body = await fetchUpstreamResilient("https://example.test/log-fallback", 60_000, { timeoutMs: 1000, backoffMs: 1 })
        assert.equal(body.servedFromCache, true, "Should fall back to last-good after expiry and a failure")
        const events = logs.logs.map((l) => l.event)
        assert.ok(events.includes("stale"), `Expected a stale event, saw ${JSON.stringify(events)}`)
        assert.ok(!events.includes("throw"), "Stale path must not also throw")
      })
    } finally {
      Date.now = originalNow
    }
  } finally { mock.restore() }
})

test("a thrown fetch (network error) is logged as attempt with kind:timeout", async () => {
  const mock = await withMock(() => { throw new Error("connection reset") })
  try {
    await captureAcrossTest(async (logs) => {
      await assert.rejects(
        fetchUpstreamResilient("https://example.test/log-throw", 60_000, { timeoutMs: 1000, backoffMs: 1 }),
        /Upstream failed/,
      )
      const attempts = logs.logs.filter((l) => l.event === "attempt")
      assert.equal(attempts.length, 1, "TimeoutError path is single attempt (no retry)")
      assert.equal(attempts[0]?.outcome, "throw")
      assert.equal(attempts[0]?.kind, "timeout")
    })
  } finally { mock.restore() }
})
