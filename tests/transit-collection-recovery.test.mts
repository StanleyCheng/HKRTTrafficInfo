import assert from "node:assert/strict"
import test from "node:test"
import { loadMtrSnapshot } from "../lib/mtr-feed.ts"
import { loadLrtSnapshot } from "../lib/lrt-feed.ts"
import { loadCitybusNear } from "../lib/citybus-feed.ts"
import { loadKmbNear } from "../lib/kmb-feed.ts"
import { loadGmbNear } from "../lib/gmb-feed.ts"
import { loadNlbNear } from "../lib/nlb-feed.ts"

test("failed rail stations cannot monopolize every refresh slice, and concurrent readers join", async (t) => {
  const originalFetch = globalThis.fetch
  let now = Date.parse("2026-10-03T04:00:00Z")
  t.mock.method(Date, "now", () => now)
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    return new Response("Unavailable", { status: 403 })
  }
  try {
    await Promise.all([loadMtrSnapshot(now), loadMtrSnapshot(now)])
    assert.equal(requests.length, 16, "concurrent MTR snapshots share one station slice")
    const mtrFirst = new Set(requests)
    requests.length = 0
    now += 5_000
    await loadMtrSnapshot(now)
    assert.equal(requests.length, 16)
    assert.ok(requests.some(url => !mtrFirst.has(url)), "unread MTR stations get a turn after other stations fail")

    requests.length = 0
    await Promise.all([loadLrtSnapshot(now), loadLrtSnapshot(now)])
    assert.equal(requests.length, 12, "concurrent Light Rail snapshots share one station slice")
    const lrtFirst = new Set(requests)
    requests.length = 0
    now += 5_000
    await loadLrtSnapshot(now)
    assert.equal(requests.length, 12)
    assert.ok(requests.every(url => !lrtFirst.has(url)), "failed Light Rail stations yield to never-attempted stations")
  } finally { globalThis.fetch = originalFetch }
})

test("Light Rail alert payloads retain station boards, and frozen source clocks expire", async (t) => {
  const originalFetch = globalThis.fetch
  let now = Date.parse("2026-10-04T04:00:00Z")
  const source = now
  let alerted = false
  t.mock.method(Date, "now", () => now)
  globalThis.fetch = async () => Response.json(alerted ? { status: 0 } : {
    status: 1,
    system_time: "2026-10-04 12:00:00",
    platform_list: [{ platform_id: 1, route_list: [{ route_no: "610", dest_ch: "屯門碼頭", time_en: "3 mins" }] }],
  })
  try {
    const fresh = await loadLrtSnapshot(now)
    assert.ok(fresh.boards.length > 0)
    assert.ok(fresh.boards.every(board => board.observedAt === new Date(source).toISOString()))
    alerted = true
    now += 5_000
    const held = await loadLrtSnapshot(now)
    assert.equal(held.stale, true)
    assert.deepEqual(held.boards, fresh.boards, "an API alert must not masquerade as no trains")
    alerted = false
    now += 300_001
    const expired = await loadLrtSnapshot(now)
    assert.equal(expired.ok, false)
    assert.deepEqual(expired.boards, [], "a repeatedly returned old system clock cannot renew train positions")
  } finally { globalThis.fetch = originalFetch }
})

test("malformed successful bus responses surface failure for every operator", async (t) => {
  const originalFetch = globalThis.fetch
  t.mock.method(console, "error", () => {})
  const now = Date.parse("2026-10-05T04:00:00Z")
  t.mock.method(Date, "now", () => now)
  globalThis.fetch = async () => Response.json({ error: "Upstream payload changed" })
  try {
    for (const load of [
      () => loadKmbNear(114.17, 22.32, now, 15),
      () => loadCitybusNear(114.18, 22.3, now, 15),
      () => loadGmbNear(114.18, 22.3, now, 18),
      () => loadNlbNear(113.94, 22.28, now, 15),
    ]) {
      const body = await load()
      assert.ok(body.stops.length > 0, "the catalogue still identifies poles")
      assert.equal(body.ok, false)
      assert.equal(body.stale, true)
      assert.equal(body.observedAt, null)
      assert.ok(body.stops.every(stop => stop.observedAt === null))
    }
  } finally { globalThis.fetch = originalFetch }
})

test("a repeatedly returned old provider generation clock cannot renew bus observations", async (t) => {
  const originalFetch = globalThis.fetch
  const now = Date.parse("2026-10-07T04:00:00Z")
  t.mock.method(Date, "now", () => now)
  t.mock.method(console, "error", () => {})
  globalThis.fetch = async () => Response.json({ generated_timestamp: new Date(now - 180_001).toISOString(), data: [] })
  try {
    const stale = await loadCitybusNear(114.18, 22.3, now, 15)
    assert.equal(stale.ok, false)
    assert.equal(stale.stale, true)
    assert.equal(stale.observedAt, null)
    assert.ok(stale.stops.every(stop => stop.observedAt === null))
  } finally { globalThis.fetch = originalFetch }
})

test("partial Citybus failures keep each stop's clock and expire passed arrivals", async (t) => {
  const originalFetch = globalThis.fetch
  let now = Date.parse("2026-10-08T04:00:00Z")
  const source = now
  let brokenStop = ""
  t.mock.method(Date, "now", () => now)
  t.mock.method(console, "error", () => {})
  globalThis.fetch = async (input) => {
    const parts = new URL(String(input)).pathname.split("/")
    const stop = parts.at(-2)!, route = parts.at(-1)!
    return Response.json(stop === brokenStop ? { error: "Payload changed" } : { data: [{
      route, dir: "O", eta_seq: 1, eta: new Date(source + 60_000).toISOString(), dest_tc: "測試",
    }] })
  }
  try {
    const fresh = await loadCitybusNear(114.18, 22.3, now, 15)
    brokenStop = fresh.stops.find(stop => stop.calls.length > 0)!.id
    now += 5_000
    const partial = await loadCitybusNear(114.18, 22.3, now, 15)
    assert.equal(partial.ok, true)
    assert.equal(partial.cacheable, false)
    assert.match(partial.error ?? "", /Some Citybus/)
    assert.equal(partial.stops.find(stop => stop.id === brokenStop)?.observedAt, new Date(source).toISOString())
    assert.ok(partial.stops.some(stop => stop.id !== brokenStop && stop.observedAt === new Date(now).toISOString()))
    now = source + 120_001
    const aged = await loadCitybusNear(114.18, 22.3, now, 15)
    assert.deepEqual(aged.stops.find(stop => stop.id === brokenStop)?.calls, [], "retained arrivals stop claiming zero minutes after the grace window")
    now = source + 180_001
    const expired = await loadCitybusNear(114.18, 22.3, now, 15)
    assert.equal(expired.stops.find(stop => stop.id === brokenStop)?.observedAt, null)
  } finally { globalThis.fetch = originalFetch }
})
