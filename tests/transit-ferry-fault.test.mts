import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { loadFerrySnapshot } from "../lib/ferry-feed.ts"

test("partial Fortune and Star failures preserve working directions and next departures", async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  let release!: () => void
  const livePending = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.includes("1823.gov.hk")) return Response.json({ vcalendar: [{ vevent: [{ dtstart: ["20261001"] }] }] })
    if (url.includes("fortuneferry")) return new Response(url.includes("destination=18") ? "<html>Timetable layout changed</html>" : '<td class="time">07:00</td><td class="time">12:10</td><td class="time">19:00</td>')
    if (url.includes("starferry")) return url.includes("wanchai") ? new Response("Unavailable", { status: 503 }) : new Response("Central to Tsim Sha Tsui,Mon – Sun,7:00am-11:00pm,8")
    if (url.includes("sunferry")) {
      if (url.includes("/eta/?")) await livePending
      return Response.json({ data: [{ lng: "114.12", lat: "22.3", vesselcode: "TEST", depart_time: "12:00", eta: "12:30" }] })
    }
    return Response.json({ data: [] })
  }
  try {
    const pending = loadFerrySnapshot(Date.parse("2026-10-03T12:00:00+08:00"))
    await setImmediate()
    assert.ok(requests.some(url => url.includes("fortuneferry")), "Independent timetables must start while live arrivals are pending")
    assert.equal(requests.filter(url => url.includes("starferry")).length, 2, "Both Star directions must start concurrently")
    assert.ok(requests.some(url => url.includes("/timetable/")), "Holiday-dependent timetables must start after the calendar, without waiting for live arrivals")
    release()
    const body = await pending
    assert.equal(body.ok, true)
    assert.equal(body.stale, true)
    assert.equal(body.cacheable, false)
    assert.match(body.error ?? "", /Fortune Ferry timetable contains no valid departure clocks/)
    assert.match(body.error ?? "", /Star Ferry timetable unavailable/)
    assert.ok(body.vessels.some((vessel) => vessel.fix === "gps" && vessel.lng === 114.12))
    assert.ok(body.vessels.some((vessel) => vessel.route === "天星" && vessel.fix === "clock"))
    assert.ok(body.vessels.find((vessel) => vessel.route === "CECC")?.pathLng?.length)
    assert.equal(body.piers.find((pier) => pier.id === "star-central")?.calls[0]?.firstFerry, "07:00")
    assert.equal(body.piers.find((pier) => pier.id === "star-central")?.calls[0]?.eta, "2026-10-03T04:04:00.000Z")
    assert.equal(body.piers.find((pier) => pier.id === "fortune-kwun-tong")?.calls[0]?.minutes, 10)
    assert.equal(body.piers.find((pier) => pier.id === "fortune-kwun-tong")?.calls[0]?.lastFerry, "19:00")
    assert.ok(body.piers.some((pier) => pier.calls.length > 0))
  } finally { release(); globalThis.fetch = originalFetch }
})
