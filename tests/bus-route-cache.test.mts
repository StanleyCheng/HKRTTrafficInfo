import test from "node:test"
import assert from "node:assert/strict"
import { selectionCachedGet, type OkBody } from "../lib/view-cache.ts"

interface FixtureBody extends OkBody {
  version: number
  observedAt: string | null
  error?: string
  stale: boolean
}

function makeHandler(current: { calls: number; phase: "ok" | "fail" | "throw" }) {
  return selectionCachedGet<FixtureBody>({
    freshMs: 10_000,
    cacheKey: (request) => new URL(request.url).searchParams.get("id") ?? null,
    load: async (request) => {
      current.calls += 1
      if (current.phase === "throw") throw new Error("upstream unavailable")
      return {
        ok: true,
        version: current.calls,
        cacheable: current.phase === "ok",
        stale: current.phase === "fail",
        observedAt: current.phase === "fail" ? "2026-10-09T04:00:00.000Z" : new Date(Date.now()).toISOString(),
        error: current.phase === "fail" ? "Upstream unavailable for now" : undefined,
        fetchedAt: new Date(Date.now()).toISOString(),
      } as FixtureBody & { error?: string }
    },
    invalid: () => ({ ok: false, version: 0, observedAt: null, stale: false }),
    failed: (error) => ({
      ok: false,
      version: 0,
      observedAt: null,
      stale: true,
      error: error instanceof Error ? error.message : "Unknown failure",
    }),
  })
}

test("selectionCachedGet: a successful first call is served from cache within freshMs", async () => {
  const state = { calls: 0, phase: "ok" as const }
  const GET = makeHandler(state)
  const a = await (await GET(new Request("https://local/api/cache?id=A"))).json() as FixtureBody
  const b = await (await GET(new Request("https://local/api/cache?id=A"))).json() as FixtureBody
  assert.equal(state.calls, 1, "Second call within TTL must hit the cache, not the load function")
  assert.equal(b.version, a.version)
})

test("selectionCachedGet: a partial / stale response is NOT cached, so a subsequent call retriggers load", async () => {
  const state: { calls: number; phase: "ok" | "fail" | "throw" } = { calls: 0, phase: "fail" }
  const GET = makeHandler(state)
  const a = await (await GET(new Request("https://local/api/cache?id=B"))).json() as FixtureBody
  assert.equal(a.ok, true)
  assert.equal(a.stale, true)
  assert.equal(a.error, "Upstream unavailable for now")
  state.phase = "ok"
  const b = await (await GET(new Request("https://local/api/cache?id=B"))).json() as FixtureBody
  assert.equal(state.calls, 2, "A stale result must not occupy the cache slot")
  assert.equal(b.stale, false)
})

test("selectionCachedGet: a load throw falls back to the cached body with stale:true", async () => {
  const state: { calls: number; phase: "ok" | "fail" | "throw" } = { calls: 0, phase: "ok" }
  const GET = makeHandler(state)
  // Seed the cache with a good result.
  const seed = await (await GET(new Request("https://local/api/cache?id=C"))).json() as FixtureBody
  assert.equal(seed.error, undefined)
  // Expire the cache so the next request triggers load(), then force a throw.
  const originalNow = Date.now
  const offset = 11_000
  Date.now = () => originalNow() + offset
  try {
    state.phase = "throw"
    const failed = await (await GET(new Request("https://local/api/cache?id=C"))).json() as FixtureBody
    assert.equal(failed.ok, true, "stale:true + cached body preserves the previous ok:true")
    assert.equal(failed.stale, true)
    assert.match(failed.error ?? "", /upstream unavailable/)
    assert.equal(state.calls, 2, "Two invocations of load: one seed, one forced throw")
  } finally {
    Date.now = originalNow
  }
})

test("selectionCachedGet: missing cacheKey produces a 400 invalid response", async () => {
  const state = { calls: 0, phase: "ok" as const }
  const GET = makeHandler(state)
  const response = await GET(new Request("https://local/api/cache")) // no id param
  assert.equal(response.status, 400)
  const body = await response.json() as FixtureBody
  assert.equal(body.ok, false)
  assert.equal(state.calls, 0, "Invalid requests must not call load()")
})

test("selectionCachedGet: a load throw with no cache hits the failure path with status 502", async () => {
  const state = { calls: 0, phase: "throw" as const }
  const GET = makeHandler(state)
  const response = await GET(new Request("https://local/api/cache?id=D"))
  assert.equal(response.status, 502)
  const body = await response.json() as FixtureBody
  assert.equal(body.ok, false)
})
