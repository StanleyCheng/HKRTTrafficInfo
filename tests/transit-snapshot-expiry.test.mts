import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { GET as mtr } from "../app/api/mtr/route.ts"
import { GET as lrt } from "../app/api/lrt/route.ts"
import { snapshotFallback } from "../lib/snapshot-cache.ts"
import type { LrtResponse, MtrResponse } from "../lib/types.ts"

test("a newly inserted rail snapshot cannot revive expired source boards", async (t) => {
  const originalFetch = globalThis.fetch
  let now = Date.parse("2026-10-10T04:04:00Z"), fail = false
  t.mock.method(Date, "now", () => now)
  globalThis.fetch = async (input) => {
    if (fail) return new Response("Unavailable", { status: 403 })
    const url = new URL(String(input))
    if (url.pathname.includes("/lrt/")) return Response.json({
      status: 1, system_time: "2026-10-10 12:00:00", platform_list: [{ platform_id: 1, route_list: [] }],
    })
    const key = `${url.searchParams.get("line")}-${url.searchParams.get("sta")}`
    return Response.json({ status: 1, data: { [key]: { curr_time: "2026-10-10 12:00:00", UP: [] } } })
  }
  try {
    for (const read of [mtr, lrt]) {
      const seed = await read()
      const body = await seed.json() as MtrResponse | LrtResponse
      assert.equal(seed.status, 200)
      assert.equal(body.observedAt, "2026-10-10T04:00:00.000Z", "the newly cached result retains its four-minute-old source time")
    }
    fail = true; now += 60_001
    for (const read of [mtr, lrt]) {
      const response = await read()
      const body = await response.json() as MtrResponse | LrtResponse
      assert.equal(response.status, 502, "a one-minute-old cache entry cannot revive its expired five-minute-old source")
      assert.equal(body.ok, false)
      assert.deepEqual(body.boards, [])
      assert.deepEqual(body.trains, [])
    }
  } finally { globalThis.fetch = originalFetch }
})

test("snapshot fallback counts elapsed loader time, rejects bad clocks and keeps valid observations", async (t) => {
  let now = Date.parse("2026-10-10T05:00:00Z")
  t.mock.method(Date, "now", () => now)
  const observedAt = new Date(now - 179_000).toISOString()
  const cached = { at: now, body: { observedAt, useful: true } }
  assert.equal(snapshotFallback(cached), cached.body)
  await setImmediate()
  now += 1_001
  assert.equal(snapshotFallback(cached), null, "time spent awaiting the loader can expire the source even when insertion is recent")
  for (const source of [null, "invalid", new Date(now + 30_001).toISOString()]) {
    assert.equal(snapshotFallback({ at: now, body: { observedAt: source } }), null)
  }
  const current = { observedAt: new Date(now).toISOString() }
  assert.equal(snapshotFallback({ at: now - 180_001, body: current }), null, "source freshness cannot extend insertion retention")
  assert.equal(snapshotFallback({ at: now + 30_001, body: current }), null)
  assert.equal(snapshotFallback({ at: now, body: current }), current)
})
