import assert from "node:assert/strict"
import test from "node:test"
import { movingCameras, normalizeIntegration, railHoverText, viewportNote } from "../lib/integration-client.ts"
import { stationRecord } from "../lib/mtr-network.ts"
import { integrationMessages, messages } from "../lib/i18n.ts"
import { hkTime } from "../lib/traffic.ts"
import type { CitybusResponse, FerryResponse, LrtResponse, MtrResponse } from "../lib/types.ts"

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

test("rail sync completeness survives normalization and a missing station clock is not fabricated", () => {
  const mtr: MtrResponse = { ok: true, complete: false, observedAt: new Date(now).toISOString(), trains: [], boards: [{ line: "TWL", station: "CEN", message: "", trains: [] }] }
  const lrt: LrtResponse = { ok: true, complete: false, observedAt: new Date(now).toISOString(), trains: [], boards: [{ station: "1", calls: [] }] }
  for (const [kind, payload] of [["mtr", mtr], ["lrt", lrt]] as const) {
    assert.equal(normalizeIntegration(kind, payload).complete, false)
    assert.equal(normalizeIntegration(kind, { ...payload, complete: true }).complete, true)
    assert.equal(normalizeIntegration(kind, { ...payload, complete: true, stale: true }).complete, false)
    assert.ok(normalizeIntegration(kind, payload).cameras.every(camera => !camera.dataUpdated))
  }
})

test("rail hover gives bilingual station, earliest live ETA and the station source time", () => {
  const observedAt = new Date(now - 120000).toISOString()
  const data = normalizeIntegration("mtr", { ok: true, observedAt: new Date(now).toISOString(), trains: [], boards: [{ line: "TWL", station: "CEN", observedAt, message: "", trains: [{ dest: "TSW", plat: "1", ttnt: 3, delay: false, timeType: "A" }] }] } as MtrResponse)
  const station = data.cameras.find(camera => camera.sourceId === "CEN")!
  assert.equal(station.dataUpdated, observedAt)
  for (const language of ["en", "zh"] as const) {
    const copy = integrationMessages[language]
    const text = railHoverText(station, language, now)
    assert.equal(text, `${language === "en" ? station.nameEn : station.name}\n${copy.nextTrainEta}: ${hkTime(now + 60000, false, language)}\n${messages[language].recordUpdated}: ${hkTime(observedAt, true, language)}`)
    assert.match(railHoverText({ ...station, nextStation: { name: "金鐘", nameEn: "Admiralty" } }, language, now), language === "en" ? /^Admiralty\n/ : /^金鐘\n/)
    assert.ok(railHoverText(station, language, now + 60001).includes(`${copy.nextTrainEta}: ${copy.queue[4]}`))
    assert.ok(railHoverText({ ...station, dataUpdated: undefined }, language, now).endsWith(copy.noTimestamp))
  }
})

test("a clamped train pairs its ETA with the observed arrival station", () => {
  const observedAt = new Date(now).toISOString()
  const data = normalizeIntegration("mtr", { ok: true, observedAt, boards: [], trains: [{ id: "clamped", line: "TWL", dest: "TSW", plat: "1", ttnt: 20, observedAt, delay: false, timeType: "A", anchor: "ADM", path: ["CEN", "ADM", "TST"], hold: ["CEN", "ADM", "TST"] }] } as MtrResponse)
  const train = movingCameras("mtr", data, now)[0]!
  assert.equal(train.lng, stationRecord("CEN")?.lng)
  assert.equal(train.nextStation?.nameEn, stationRecord("ADM")?.en)
  assert.equal(train.arrivals?.[0]?.eta, new Date(now + 20 * 60000).toISOString())
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
