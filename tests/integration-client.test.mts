import assert from "node:assert/strict"
import test from "node:test"
import { movingCameras, normalizeIntegration, viewportNote } from "../lib/integration-client.ts"
import { stationRecord } from "../lib/mtr-network.ts"
import type { CitybusResponse, FerryResponse, MtrResponse } from "../lib/types.ts"

const now = Date.parse("2026-10-03T12:00:00+08:00")

test("rail adapter preserves bilingual station destinations and Leaflet coordinate order", () => {
  const payload: MtrResponse = {
    ok: true, observedAt: new Date(now).toISOString(), trains: [],
    boards: [{ line: "TWL", station: "CEN", message: "", trains: [{ dest: "TSW", plat: "1", ttnt: 3, delay: true, timeType: "A" }] }],
  }
  const data = normalizeIntegration("mtr", payload)
  const central = data.cameras.find((camera) => camera.sourceId === "CEN")
  assert.ok(central)
  assert.equal(central.name, stationRecord("CEN")?.tc)
  assert.equal(central.nameEn, stationRecord("CEN")?.en)
  assert.equal(central.lng, stationRecord("CEN")?.lng)
  assert.equal(central.lat, stationRecord("CEN")?.lat)
  assert.equal(central.arrivals?.[0]?.destination, stationRecord("TSW")?.tc)
  assert.equal(central.arrivals?.[0]?.destinationEn, stationRecord("TSW")?.en)
  assert.equal(central.arrivals?.[0]?.platform, "1")
  assert.equal(central.arrivals?.[0]?.minutes, 3)
  assert.ok(data.paths?.length)
  assert.ok(data.paths.every((path) => path.points.every(([lat, lng]) => lat > 22 && lat < 23 && lng > 113 && lng < 115)))
})

test("retained rail countdown uses its station clock instead of the refreshed global snapshot", () => {
  const payload: MtrResponse = {
    ok: true, observedAt: new Date(now).toISOString(), trains: [],
    boards: [{ line: "TWL", station: "CEN", observedAt: new Date(now - 120000).toISOString(), message: "", trains: [{ dest: "TSW", plat: "1", ttnt: 3, delay: false, timeType: "A" }] }],
  }
  const station = normalizeIntegration("mtr", payload).cameras.find((camera) => camera.sourceId === "CEN")
  const eta = station?.arrivals?.[0]?.eta
  assert.equal(eta, new Date(now + 60000).toISOString())
  assert.equal(Math.ceil((Date.parse(eta!) - now) / 60000), 1)
})

const ferry: FerryResponse = {
  ok: true, observedAt: new Date(now).toISOString(),
  piers: [{ id: "pier", nameTc: "碼頭", nameEn: "Pier", lng: 114, lat: 22.3, calls: [{ route: "F", destTc: "目的地", destEn: "Destination", originTc: "", originEn: "", arriving: false, eta: new Date(now + 600000).toISOString(), minutes: 10, remarkTc: "船期", remarkEn: "Timetable", scheduled: true }] }],
  vessels: [{ id: "vessel", nameTc: "船", nameEn: "Ferry", lng: 114, lat: 22.3, route: "F", eta: new Date(now + 600000).toISOString(), minutes: 10, fix: "clock", pathLng: [114, 114.1], pathLat: [22.3, 22.3], departAt: now - 600000, arriveAt: now + 600000 }],
}

test("ferry adapter retains scheduled pier calls and interpolates clock vessels", () => {
  const data = normalizeIntegration("ferry", ferry)
  assert.equal(data.cameras[0]?.positionType, "pier")
  assert.equal(data.cameras[0]?.arrivals?.[0]?.scheduled, true)
  assert.equal(data.cameras[0]?.arrivals?.[0]?.destinationEn, "Destination")
  const moving = movingCameras("ferry", data, now)
  assert.equal(moving.length, 1)
  assert.ok(Math.abs(moving[0].lng - 114.05) < 0.001)
  assert.equal(moving[0].estimated, true)
  assert.deepEqual(movingCameras("ferry", data, now + 180001), [])
  assert.deepEqual(movingCameras("ferry", normalizeIntegration("ferry", { ...ferry, observedAt: "invalid" }), now), [])
})

test("bus adapter preserves scheduled flags and partial failure metadata", () => {
  const payload: CitybusResponse = { ok: true, stale: true, error: "Some arrivals unavailable", observedAt: new Date(now).toISOString(), stops: [{ id: "stop", nameTc: "車站", nameEn: "Stop", lng: 114.18, lat: 22.3, routes: ["1"], calls: [{ route: "1", destTc: "目的地", destEn: "Destination", eta: new Date(now + 60000).toISOString(), minutes: 1, scheduled: true, remarkTc: "", remarkEn: "" }] }] }
  const data = normalizeIntegration("citybus", payload)
  assert.equal(data.cameras[0]?.arrivals?.[0]?.scheduled, true)
  assert.equal(data.stale, true)
  assert.equal(data.observedAt, payload.observedAt)
  assert.equal(data.feedError, payload.error)
})

test("bus viewport notes match the server thresholds and Lantau boundaries", () => {
  assert.equal(viewportNote("kmb", { lng: 114.18, lat: 22.3, zoom: 12 }), "viewportBus")
  assert.equal(viewportNote("citybus", { lng: 114.18, lat: 22.3, zoom: 13 }), undefined)
  assert.equal(viewportNote("gmb", { lng: 114.18, lat: 22.3, zoom: 16 }), "viewportGmb")
  assert.equal(viewportNote("gmb", { lng: 114.18, lat: 22.3, zoom: 17 }), undefined)
  assert.equal(viewportNote("nlb", { lng: 114.18, lat: 22.3, zoom: 18 }), "viewportNlb")
  assert.equal(viewportNote("nlb", { lng: 113.95, lat: 22.28, zoom: 12 }), undefined)
})
