import assert from "node:assert/strict"
import test from "node:test"
import piersFile from "../data/ferry-piers.json" with { type: "json" }
import { ferryFairway, ferryPaths } from "../lib/ferry-fairway.ts"
import { estimateFerryVessels, pathMetres, pointAlong } from "../lib/ferry-run.ts"
import { movingCameras, normalizeIntegration } from "../lib/integration-client.ts"
import { metresBetween, type GeoPoint } from "../lib/mtr-estimate.ts"
import type { FerryResponse, FerryVessel } from "../lib/types.ts"
import { inSea, landSamples } from "./ferry-geography.mts"

const headingOf = (from: GeoPoint, to: GeoPoint): number => Math.atan2((to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180), to.lat - from.lat)

const pairs = [
  ["hkkf-central", "hkkf-yung-shue-wan"],
  ["hkkf-central", "hkkf-sok-kwu-wan"],
  ["hkkf-central-6", "hkkf-peng-chau"],
  ["hkkf-peng-chau", "hkkf-hei-ling-chau"],
  ["sun-central", "sun-cheung-chau"],
  ["hkkf-central-6", "sun-mui-wo"],
  ["sun-north-point", "sun-hung-hom"],
  ["sun-north-point", "sun-kowloon-city"],
  ["hkkf-peng-chau", "sun-mui-wo"],
  ["sun-mui-wo", "sun-chi-ma-wan"],
  ["sun-chi-ma-wan", "sun-cheung-chau"],
  ["sun-cheung-chau", "sun-mui-wo"],
  ["star-central", "star-tst"],
  ["star-wanchai", "star-tst"],
  ["fortune-north-point", "fortune-kwun-tong"],
  ["fortune-kwun-tong", "fortune-kai-tak"],
] as const
const piers = new Map(piersFile.piers.map(pier => [pier.id, pier]))
const now = Date.parse("2026-10-10T12:00:00+08:00")
const empty: FerryResponse = { ok: true, observedAt: new Date(now).toISOString(), piers: [], vessels: [] }

test("official coast fixture distinguishes islands, urban land and harbour water", () => {
  for (const [lng, lat] of [[114.03, 22.208], [114.127, 22.219], [114.043, 22.282], [114.033, 22.256], [114.16, 22.275], [114.18, 22.31]]) {
    assert.equal(inSea({ lng: lng!, lat: lat! }), false, `${lng},${lat} must be land`)
  }
  for (const [lng, lat] of [[114.17, 22.29], [114.024, 22.222], [114.15, 22.218]]) {
    assert.equal(inSea({ lng: lng!, lat: lat! }), true, `${lng},${lat} must be water`)
  }
  assert.equal(inSea({ lng: 114.25, lat: 22.29 }), false, "trimmed fixture must not claim water outside its validity bounds")
})

test("coastline intersections catch the Mui Wo pier sliver between five-metre samples", () => {
  const crossing = landSamples([{ lng: 114.01, lat: 22.264 }, { lng: 114.002157, lat: 22.265059 }])
  assert.ok(crossing.length > 0, "a narrow land interval outside the terminal allowance must not be skipped")
})

test("all 16 supported ferry pairs remain drawn without active vessels", () => {
  const expected = pairs.map(([from, to]) => `ferry-${from}-${to}`).sort()
  const routes = ferryPaths()
  assert.equal(new Set(routes.map(route => route.id)).size, pairs.length)
  assert.deepEqual(routes.map(route => route.id).sort(), expected)
  const data = normalizeIntegration("ferry", empty)
  assert.deepEqual(data.paths?.map(route => route.id).sort(), expected)
  for (const route of routes) {
    assert.deepEqual(data.paths?.find(path => path.id === route.id)?.points, route.pathLng.map((lng, index) => [route.pathLat[index], lng]))
  }
  assert.deepEqual(movingCameras("ferry", data, now), [])
})

for (const pair of pairs) {
  test(`${pair.join(" → ")} avoids land in both directions, including moving boats`, () => {
    const origin = piers.get(pair[0])!, destination = piers.get(pair[1])!
    assert.ok(origin && destination, "both pier endpoints must exist")
    const forward = ferryFairway(origin.id, destination.id, origin, destination)
    const reverse = ferryFairway(destination.id, origin.id, destination, origin)
    assert.deepEqual(reverse, [...forward].reverse(), "returning vessels must follow the route in reverse")
    const overlay = ferryPaths().find(route => route.id === `ferry-${origin.id}-${destination.id}`)!
    assert.deepEqual(overlay.pathLng, forward.map(point => point.lng))
    assert.deepEqual(overlay.pathLat, forward.map(point => point.lat))
    for (const [from, to, path] of [[origin, destination, forward], [destination, origin, reverse]] as const) {
      assert.deepEqual(path[0], from)
      assert.deepEqual(path.at(-1), to)
      assert.ok(pathMetres(path) <= metresBetween(from, to) * 2.7, "route must be a reasonable crossing")
      const land = landSamples(path)
      assert.equal(land.length, 0, `${from.id} → ${to.id}: ${land.length} land samples, first ${JSON.stringify(land[0])}`)
      // A ferry cannot turn on the spot: heading changes must be spread along
      // the corridor. Short legs only occur at pier approaches, where real
      // boats manoeuvre hardest; longer legs must change heading gradually.
      for (let vertex = 1; vertex + 1 < path.length; vertex += 1) {
        const previous = path[vertex - 1]!, point = path[vertex]!, next = path[vertex + 1]!
        let turn = Math.abs(headingOf(previous, point) - headingOf(point, next)) * 180 / Math.PI
        if (turn > 180) turn = 360 - turn
        const leg = Math.min(metresBetween(previous, point), metresBetween(point, next))
        assert.ok(turn <= (leg > 60 ? 10 : 35), `${from.id} → ${to.id}: ${turn.toFixed(1)}° turn on ${leg.toFixed(0)} m legs at vertex ${vertex} must be spread along the corridor`)
      }
      const track = { route: "fixture", fromId: from.id, toId: to.id, fromTc: from.nameTc, fromEn: from.nameEn, toTc: to.nameTc, toEn: to.nameEn, destTc: to.nameTc }
      const vessel = estimateFerryVessels([track], [
        { route: "fixture", pierId: from.id, arriving: false, eta: new Date(now).toISOString(), destTc: to.nameTc },
        { route: "fixture", pierId: to.id, arriving: true, eta: new Date(now + 120000).toISOString(), destTc: to.nameTc },
      ], new Set(), id => piers.get(id) ?? null, now + 60000)[0]!
      assert.ok(vessel)
      assert.deepEqual(vessel.pathLng, path.map(point => point.lng))
      assert.deepEqual(vessel.pathLat, path.map(point => point.lat))
      for (const fix of ["clock", "gps"] as const) {
        const boat: FerryVessel = { ...vessel, fix, observedAt: new Date(now).toISOString(), lng: path[0]!.lng, lat: path[0]!.lat }
        const snapshot: FerryResponse = { ...empty, vessels: [boat] }
        const data = normalizeIntegration("ferry", snapshot)
        assert.equal(data.paths?.length, pairs.length, "vessels must not duplicate or hide route overlays")
        const first = movingCameras("ferry", data, now + 30000)[0]!
        const midpoint = movingCameras("ferry", data, now + 60000)[0]!
        const later = movingCameras("ferry", data, now + 90000)[0]!
        assert.ok(first && midpoint && later)
        for (const [point, fraction] of [[first, 0.25], [midpoint, 0.5], [later, 0.75]] as const) {
          assert.ok(metresBetween(point, pointAlong(path, fraction)) < 0.01, `${fix} boat must follow its displayed line`)
          assert.equal(inSea(point), true, `${fix} animated position must remain in water`)
        }
        assert.ok(metresBetween(first, later) > 10, `${fix} boat must advance toward its destination`)
      }
    }
  })
}
