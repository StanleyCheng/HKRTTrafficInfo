import assert from 'node:assert/strict'
import test from 'node:test'
import { matchBusGeometry, matchCitybusOfficialGeometry } from '../lib/bus-route-geometry.ts'
import { routeDistances, routePointAtDistance } from '../lib/bus-route-motion.ts'
import { metresBetween } from '../lib/nearest.ts'
import route11Stops from './fixtures/citybus-11-outbound-stops.json' with { type: 'json' }
import route11Geometry from './fixtures/citybus-11-official-td.json' with { type: 'json' }
import type { BusRouteStop } from '../lib/bus-route.ts'

const stops: BusRouteStop[] = [114.1, 114.101, 114.102].map((lng, index) => ({ id: String(index), seq: index + 1, lng, lat: 22.3, nameTc: '', nameEn: '', distance: 0 }))

test('Citybus official shapes can extend past terminals but must match the ordered route', () => {
  const route = [[[114.099, 22.3], [114.1, 22.3], [114.101, 22.3], [114.102, 22.3], [114.103, 22.3]]]
  assert.equal(matchBusGeometry(route, stops, { endpoint: 65, intermediate: 65, gap: 2 }), null, 'the whole source shape extends beyond both terminals')
  const match = matchCitybusOfficialGeometry(route, stops)
  assert.ok(match)
  assert.deepEqual(match.coordinates[0], [114.1, 22.3])
  assert.deepEqual(match.coordinates.at(-1), [114.102, 22.3])
  assert.equal(match.stopDistances[0], 0)
  assert.ok(match.stopDistances[1] > 0 && match.stopDistances[2] > match.stopDistances[1])
  assert.equal(matchCitybusOfficialGeometry([route[0].slice().reverse()], stops), null, 'reverse direction is rejected')
  assert.equal(matchCitybusOfficialGeometry([route[0].slice(0, 2), route[0].slice(2)], stops), null, 'disconnected fragments are rejected')
  assert.equal(matchCitybusOfficialGeometry(route, [stops[0], { ...stops[1], lat: 22.31 }, stops[2]]), null, 'every stop must be close to the path')
})

test('Citybus 11 official road shape matches the published outbound stops after clipping', () => {
  assert.equal(matchBusGeometry(route11Geometry.paths, route11Stops, { endpoint: 65, intermediate: 65, gap: 2 }), null)
  const match = matchCitybusOfficialGeometry(route11Geometry.paths, route11Stops)
  assert.ok(match)
  assert.ok(match.coordinates.length > route11Stops.length * 2)
  const cumulative = routeDistances(match.coordinates)
  route11Stops.forEach((stop, index) => {
    const point = routePointAtDistance(match.coordinates, cumulative, match.stopDistances[index])!
    assert.ok(metresBetween({ lng: point[0], lat: point[1] }, stop) <= 65, stop.id)
  })
})
