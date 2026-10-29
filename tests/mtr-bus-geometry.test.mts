import assert from 'node:assert/strict'
import test from 'node:test'
import { mtrBusDirections } from '../lib/mtr-bus-geometry.ts'
import { mtrBusStops } from '../lib/commuter-catalogue.ts'
import { routeDistances, routePointAtDistance } from '../lib/bus-route-motion.ts'
import { metresBetween } from '../lib/nearest.ts'
import { transportRoutes } from '../lib/transport-routes.ts'

test('MTR Bus direction geometry matches official ordered stops and the displayed route catalogue', () => {
  const groups = new Set(mtrBusStops.map(stop => `${stop.reference}:${stop.direction}`))
  const directions = mtrBusDirections()
  assert.deepEqual(new Set(directions.map(direction => direction.key)), groups)
  assert.equal(directions.length, groups.size)
  const routes = transportRoutes({}).filter(route => route.kind === 'mtr-bus')
  let matched = 0
  for (const direction of directions) {
    const path = direction.road
    const route = routes.find(row => row.code === direction.code)!
    assert.ok(route, direction.key)
    if (!path) {
      assert.ok(!route.paths.some(row => row.id === `bus-mtr-${direction.key}`), `${direction.key} has no fabricated path`)
      continue
    }
    matched++
    assert.deepEqual(path.stopIds, direction.stops.map(stop => stop.id))
    assert.equal(path.stopDistances.length, direction.stops.length)
    const lengths = routeDistances(path.coordinates)
    assert.ok(path.coordinates.length > 2)
    for (const [index, stop] of direction.stops.entries()) {
      const distance = path.stopDistances[index]
      assert.ok(Number.isFinite(distance) && distance >= 0 && distance <= lengths.at(-1)! + .02, direction.key)
      if (index) assert.ok(distance >= path.stopDistances[index - 1], direction.key)
      const point = routePointAtDistance(path.coordinates, lengths, distance)!
      assert.ok(metresBetween({ lng: point[0], lat: point[1] }, stop) <= 60, `${direction.key} stop ${stop.id} is near its road path`)
    }
    const displayed = route.paths.find(row => row.id === `bus-mtr-${direction.key}`)
    assert.deepEqual(displayed?.points, path.coordinates.map(([lng, lat]) => [lat, lng]))
  }
  assert.ok(matched > 0, 'the catalogue includes matched road geometry')
  for (const route of routes) {
    const variants = directions.filter(direction => direction.code === route.code)
    const count = variants.filter(direction => direction.road).length
    assert.equal(route.roadCoverage, !count ? 'unavailable' : count === variants.length ? 'complete' : 'partial')
  }
})
