import assert from "node:assert/strict"
import test from "node:test"
import { routeDistances, routePointAtDistance } from "../lib/bus-route-motion.ts"
import { movingCameras, normalizeIntegration } from "../lib/integration-client.ts"
import { lrtPoint, lrtRoutes, lrtTrackCollection, projectLrtTrain } from "../lib/lrt-network.ts"
import { metresBetween, segmentMinutes, viaRacecourse } from "../lib/mtr-estimate.ts"
import { mtrTrackCollection, networkRoutes, projectNetworkTrain, stationPoint } from "../lib/mtr-network.ts"
import { railPoint, railPosition, railSegment } from "../lib/rail-geometry.ts"
import type { LrtResponse, MtrResponse, MtrTrain } from "../lib/types.ts"

const now = Date.parse("2026-10-08T12:00:00+08:00")
const signature = (points: number[][]) => JSON.stringify(points)

test("every published rail direction and Racecourse branch has sourced geometry on the map", () => {
  for (const [kind, routes, collection] of [["mtr", networkRoutes(), mtrTrackCollection()], ["lrt", lrtRoutes(), lrtTrackCollection()]] as const) {
    const drawn = new Set(collection.features.flatMap(feature => feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates.flatMap(points => [signature(points), signature(points.slice().reverse())]) : []))
    const paths = kind === "mtr" ? [...routes, ...routes.filter(route => route.line === "EAL").map(route => ({ ...route, id: `${route.id}-RAC`, stations: viaRacecourse(route.stations) }))] : [...routes, { id: "705-DEPART", line: "705", stations: ["430", "435"] }, { id: "706-DEPART", line: "706", stations: ["430", "445"] }]
    const locate = kind === "mtr" ? stationPoint : lrtPoint
    for (const route of paths) {
      for (let index = 1; index < route.stations.length; index++) {
        const segment = railSegment(kind, route.line, route.stations[index - 1], route.stations[index])
        assert.ok(segment && segment.length >= 2, `${kind} ${route.id} ${route.stations[index - 1]} → ${route.stations[index]} must have sourced tracks`)
        assert.ok(segment.every(point => point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] > 113 && point[0] < 115 && point[1] > 22 && point[1] < 23), "Geometry is WGS84 in Hong Kong")
        const point = ([lng, lat]: number[]) => ({ lng, lat })
        assert.ok(metresBetween(locate(route.stations[index - 1])!, point(segment[0])) < 200 && metresBetween(locate(route.stations[index])!, point(segment.at(-1)!)) < 200, "Track endpoints match their named station")
        assert.ok(segment.slice(1).every((coordinate, index) => metresBetween(point(segment[index]), point(coordinate)) < 3000), "Mapped vertices retain tunnel spans without long geographic jumps")
        assert.ok(drawn.has(signature(segment)), "Each direction's train geometry is drawn, including parallel tracks")
      }
      const position = railPosition(kind, route.line, route.stations, route.stations[0], route.stations[0], 0)
      assert.ok(position, `${kind} ${route.id} must have a continuous track through its stops`)
      assert.equal(position.coordinates.length, position.distances.length)
    }
  }
  assert.equal(mtrTrackCollection().features.length, 10)
  assert.equal(mtrTrackCollection(), mtrTrackCollection(), "Static linework is cached across ETA polls")
  assert.equal(lrtTrackCollection(), lrtTrackCollection())
})

test("rail interpolation follows curved tracks by distance and preserves source coordinates", () => {
  const coordinates = railSegment("mtr", "AEL", "KOW", "TSY")!
  assert.ok(coordinates.length > 10, "The Airport Express follows its mapped curves rather than a station chord")
  const saved = signature(coordinates)
  const distances = routeDistances(coordinates)
  const halfway = railPoint("mtr", "AEL", "KOW", "TSY", .5)!
  assert.deepEqual([halfway.lng, halfway.lat], routePointAtDistance(coordinates, distances, distances.at(-1)! / 2))
  assert.ok(distances.at(-1)! > metresBetween(stationPoint("KOW")!, stationPoint("TSY")!) * 1.03, "The route retains its coastal bends")
  assert.equal(signature(coordinates), saved, "Direction lookups and interpolation never mutate the bundled source")
  assert.equal(railPoint("mtr", "UNKNOWN", "KOW", "TSY", .5), null, "Missing geometry never creates a fabricated chord")
  assert.equal(railSegment("lrt", "705", "435", "430"), null, "A circular service never fabricates its absent reverse direction")
})

test("production train estimates, dwell and refresh distance use the same drawn rail geometry", () => {
  for (const kind of ["mtr", "lrt"] as const) {
    const line = kind === "mtr" ? "TWL" : "507"
    const path = kind === "mtr" ? ["CEN", "ADM", "TST"] : ["1", "240", "250"]
    const from = path[0], to = path[1]
    const train: MtrTrain = { id: kind, line, dest: path.at(-1)!, plat: "1", ttnt: .3, observedAt: new Date(now).toISOString(), delay: false, timeType: "A", anchor: to, path, hold: path }
    const project = kind === "mtr" ? projectNetworkTrain : projectLrtTrain
    const spot = project(train, now)!
    const expected = railPoint(kind, line, spot.from, spot.to, spot.progress)!
    assert.deepEqual({ lng: spot.lng, lat: spot.lat }, expected)
    const dwell = project({ ...train, timeType: "D", ttnt: 1 }, now)!
    assert.deepEqual({ lng: dwell.lng, lat: dwell.lat }, railPoint(kind, line, to, path[2], 0), "Waiting trains stay on their line's track position")
    const payload = { ok: true, observedAt: train.observedAt, boards: [], trains: [train] }
    const data = kind === "mtr" ? normalizeIntegration(kind, payload as MtrResponse) : normalizeIntegration(kind, payload as LrtResponse)
    const camera = movingCameras(kind, data, now)[0]
    assert.equal(camera.estimated, true)
    const position = camera.routePosition!
    assert.ok(position)
    assert.deepEqual([camera.lng, camera.lat], routePointAtDistance(position.coordinates, position.distances, position.distance), "Refresh smoothing stays on the route")
    assert.equal(normalizeIntegration(kind, payload).paths, data.paths, "Arrival polling reuses static linework")
    if (kind === "lrt") assert.equal(camera.color, "#F5C400")
    if (kind === "mtr") {
      const hopMinutes = segmentMinutes(metresBetween(stationPoint(from)!, stationPoint(to)!))
      assert.ok(Math.abs(spot.progress - (1 - train.ttnt / hopMinutes)) < 1e-12, "Geographic corrections preserve the existing ETA timing model")
    }
  }
})
