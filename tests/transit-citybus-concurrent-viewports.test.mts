import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { loadCitybusNear } from "../lib/citybus-feed.ts"

test("concurrent disjoint Citybus viewports each refresh their own arrivals", async (t) => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  t.mock.method(console, "error", () => {})
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    await held
    return Response.json({ data: [] })
  }

  try {
    const now = Date.now()
    const first = loadCitybusNear(114.17, 22.32, now, 15)
    await setImmediate()
    assert.ok(requests.length > 0, "the first viewport must still be loading when the second arrives")
    const second = loadCitybusNear(114.22, 22.28, now, 15)
    await setImmediate()
    release()
    const [left, right] = await Promise.all([first, second])

    assert.ok(left.stops.length > 0 && right.stops.length > 0)
    const leftIds = new Set(left.stops.map((stop) => stop.id))
    assert.ok(right.stops.every((stop) => !leftIds.has(stop.id)), "fixture viewports must have disjoint stops")
    const requestedStops = new Set(requests.map((url) => decodeURIComponent(new URL(url).pathname.split("/").at(-2)!)))
    for (const response of [left, right]) {
      assert.equal(response.ok, true)
      assert.equal(response.stale, false)
      assert.ok(response.observedAt, "successful arrivals carry the viewport's own observation time")
      assert.ok(response.stops.every((stop) => requestedStops.has(stop.id)), "a successful viewport must have requested each of its stop arrival boards")
    }
  } finally {
    release()
    globalThis.fetch = originalFetch
  }
})
