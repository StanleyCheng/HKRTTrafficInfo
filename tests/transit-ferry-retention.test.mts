import assert from "node:assert/strict"
import test from "node:test"
import { loadFerrySnapshot } from "../lib/ferry-feed.ts"

test("partial Star and Fortune recovery preserves the previously working sibling", async (t) => {
  const originalFetch = globalThis.fetch
  let now = Date.parse("2026-10-03T04:00:00Z"), phase = 0
  t.mock.method(Date, "now", () => now)
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes("1823.gov.hk")) return Response.json({ vcalendar: [{ vevent: [{ dtstart: ["20261001"] }] }] })
    if (url.includes("fortuneferry")) {
      const bad = phase === 0 ? url.includes("destination=18") : url.includes("origin=16")
      return new Response(bad ? "<html>Layout changed</html>" : '<td class="time">12:15</td><td class="time">19:00</td>')
    }
    if (url.includes("starferry")) {
      const wanChai = url.includes("wanchai")
      if (phase === 0 ? wanChai : !wanChai) return new Response("Unavailable", { status: 503 })
      return new Response(`${wanChai ? "Wanchai" : "Central"} to Tsim Sha Tsui,Mon – Sun,7:00am-11:00pm,8`)
    }
    return Response.json({ data: [] })
  }
  try {
    const initial = await loadFerrySnapshot(now)
    assert.equal(initial.stale, true)
    assert.ok(initial.piers.find(pier => pier.id === "star-central")!.calls.length > 0)
    assert.ok(initial.piers.find(pier => pier.id === "fortune-north-point")!.calls.length > 0)
    phase = 1; now += 5_000
    const recovered = await loadFerrySnapshot(now)
    assert.equal(recovered.stale, true, "new failures remain visible")
    for (const id of ["star-central", "star-wanchai", "fortune-north-point", "fortune-kwun-tong"]) {
      assert.ok(recovered.piers.find(pier => pier.id === id)!.calls.length > 0, `${id} keeps its old usable timetable while siblings recover`)
    }
    assert.ok(recovered.piers.find(pier => pier.id === "fortune-kwun-tong")!.calls.some(call => call.destEn === "Kai Tak"))
  } finally { globalThis.fetch = originalFetch }
})
