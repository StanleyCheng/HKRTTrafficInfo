import assert from 'node:assert/strict'
import test from 'node:test'
import fixture from './fixtures/kmb-288-official-td.json' with { type: 'json' }
import { busRoadGeometry, matchBusGeometry, matchCitybusOfficialGeometry } from '../lib/bus-route-geometry.ts'
import { loadBusRoutePaths, type BusRouteData, type BusRouteStop } from '../lib/bus-route.ts'
import { hasBusRoadDisplay } from '../lib/bus-route-display.ts'
import { routeDistances, routePointAtDistance } from '../lib/bus-route-motion.ts'
import { metresBetween } from '../lib/nearest.ts'
import { busPaths } from '../lib/transport-routes.ts'
import { transportLines } from '../lib/map-scene.ts'

const stops: BusRouteStop[] = fixture.stops

test('KMB 288 official circular road shape follows all published stops in order', () => {
  assert.equal(matchBusGeometry(fixture.paths, stops), null, 'the old greedy matcher jumps to the later lap')
  const matched = matchCitybusOfficialGeometry(fixture.paths, stops)
  assert.ok(matched)
  assert.ok(matched.coordinates.length > 700, 'the full road shape is retained')
  assert.ok(matched.stopDistances.every((distance, index) => index === 0 || distance > matched.stopDistances[index - 1]))
  const cumulative = routeDistances(matched.coordinates)
  stops.forEach((stop, index) => {
    const point = routePointAtDistance(matched.coordinates, cumulative, matched.stopDistances[index])!
    assert.ok(metresBetween({ lng: point[0], lat: point[1] }, stop) <= 65, `stop ${stop.seq} must remain on the road shape`)
  })
})

test('KMB 288 loads the Transport Department road shape instead of straight stop connections', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/route-stop/288/outbound/1')) return Response.json({ data: stops.map(stop => ({ stop: stop.id, seq: stop.seq })) })
    if (url.includes('/route-stop/288/inbound/1')) return Response.json({ data: [] })
    if (url.includes('FeatureServer')) return Response.json({ features: [{ geometry: { paths: fixture.paths } }] })
    throw new Error(`Unexpected request: ${url}`)
  })
  const selection = { operator: 'kmb' as const, route: '288', stopId: stops[0].id, bound: 'O' as const, serviceType: '1', company: 'KMB' as const }
  const direct = await busRoadGeometry(selection, stops)
  assert.ok(direct)
  const routes = await loadBusRoutePaths(selection)
  assert.equal(routes.length, 1, '288 is a circular outbound-only service')
  assert.equal(routes[0].geometry, 'road')
  assert.equal(routes[0].coordinates.length, direct.coordinates.length)
  assert.equal(busPaths(routes).length, 1)
})

test('KMB stop-only fallback does not draw a misleading road line', () => {
  const route: BusRouteData = { key: 'kmb-288-fallback', operator: 'kmb', route: '288', stops, coordinates: stops.map(stop => [stop.lng, stop.lat]), geometry: 'stops' }
  assert.equal(hasBusRoadDisplay(route), false)
  assert.equal(hasBusRoadDisplay({ operator: 'kmb' }), false, 'missing geometry cannot be treated as a road shape')
  assert.deepEqual(busPaths([route]), [])
  assert.deepEqual(transportLines([], { ok: true, route, vehicles: [], reverse: [], observedAt: null, stale: false }).features, [])
})
