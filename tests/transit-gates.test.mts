import assert from "node:assert/strict"
import test from "node:test"
import { loadDirectTransit } from "../lib/transit-direct.ts"
import { viewportAllowed } from "../lib/view-cache.ts"
import { loadCitybusPlaces } from "../lib/citybus-feed.ts"

test("direct transit makes no upstream calls outside zoom and Lantau gates", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected upstream request") }
  try {
    for (const kind of ["kmb", "citybus", "gmb", "nlb"] as const) {
      const data = await loadDirectTransit(kind, 114.18, 22.3, Date.now(), 12)
      assert.deepEqual(data.stops, [])
    }
    assert.deepEqual((await loadDirectTransit("gmb", 114.18, 22.3, Date.now(), 16)).stops, [])
    assert.deepEqual((await loadDirectTransit("nlb", 114.18, 22.3, Date.now(), 18)).stops, [])
    assert.equal(calls, 0)
    assert.equal(viewportAllowed("gmb", 114.18, 22.3, 17), true)
    assert.equal(viewportAllowed("nlb", 113.95, 22.28, 13), true)
  } finally { globalThis.fetch = originalFetch }
})

test("direct transit shares a five-second budget across pans and retries failed refreshes", async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = Date.now()
  let calls = 0
  let fail = false
  Date.now = () => now
  globalThis.fetch = async () => { calls += 1; return fail ? new Response("Unavailable", { status: 503 }) : Response.json({ data: [] }) }
  try {
    const first = await loadDirectTransit("citybus", 114.18, 22.3, now, 16)
    assert.ok(calls > 0 && calls <= 24)
    const spent = calls
    const second = await loadDirectTransit("citybus", 114.2, 22.38, now + 1000, 16)
    assert.equal(calls, spent)
    assert.equal(second.observedAt, first.observedAt)
    assert.deepEqual(second.stops.map((stop) => stop.id), loadCitybusPlaces(114.2, 22.38, now, 16).stops.map((stop) => stop.id))
    assert.notDeepEqual(second.stops.map((stop) => stop.id), first.stops.map((stop) => stop.id))
    now += 5_000
    const refreshed = await loadDirectTransit("citybus", 114.18, 22.3, now, 16)
    assert.ok(calls > spent, "Both retained arrivals and upstream cache must expire at five seconds")
    assert.notEqual(refreshed.observedAt, first.observedAt)
    fail = true
    now += 5_000
    const failed = await loadDirectTransit("citybus", 114.18, 22.3, now, 16)
    assert.equal(failed.stale, true)
    const spentFailed = calls
    fail = false
    now += 1
    const recovered = await loadDirectTransit("citybus", 114.18, 22.3, now, 16)
    assert.ok(calls > spentFailed, "A failed result must not occupy the refresh budget")
    assert.equal(recovered.stale, false)
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow }
})
