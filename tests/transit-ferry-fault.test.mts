import assert from "node:assert/strict"
import test from "node:test"
import { loadFerrySnapshot } from "../lib/ferry-feed.ts"

test("broken Fortune HTML surfaces a fault while Sun Ferry GPS remains available", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes("fortuneferry")) return new Response("<html>Timetable layout changed</html>")
    if (url.includes("starferry")) return new Response("Central to Tsim Sha Tsui,Mon – Sun,7:00am-11:00pm,8")
    if (url.includes("sunferry")) return Response.json({ data: [{ lng: "114.12", lat: "22.3", vesselcode: "TEST", depart_time: "12:00", eta: "12:30" }] })
    return Response.json({ data: [] })
  }
  try {
    const body = await loadFerrySnapshot(Date.parse("2026-10-03T12:00:00+08:00"))
    assert.equal(body.ok, true)
    assert.equal(body.stale, true)
    assert.equal(body.cacheable, false)
    assert.match(body.error ?? "", /Fortune Ferry timetable contains no valid departure clocks/)
    assert.ok(body.vessels.some((vessel) => vessel.fix === "gps" && vessel.lng === 114.12))
    assert.ok(body.piers.some((pier) => pier.calls.length > 0))
  } finally { globalThis.fetch = originalFetch }
})
