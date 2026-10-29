import assert from 'node:assert/strict'
import test from 'node:test'
import { busRoadGeometry, matchBusGeometry } from '../lib/bus-route-geometry.ts'
import { busPaths } from '../lib/transport-routes.ts'
import { selectedVehicleCameras, seedBusRoute } from '../lib/route-vehicles.ts'
import { transportLines } from '../lib/map-scene.ts'
import type { BusRouteData, BusRouteResponse } from '../lib/bus-route.ts'
import type { CameraData } from '../lib/traffic.ts'

const now = Date.parse('2026-10-29T04:00:00Z')
const stops = [0, 1, 2].map((n) => ({ id: String(n), seq: n + 1, lng: 114 + n * .001, lat: 22.3, nameTc: '', nameEn: '', distance: n * 100 }))
const route: BusRouteData = { operator: 'citybus', route: '11', key: 'ctb-11', stops, geometry: 'stops', coordinates: stops.map(stop => [stop.lng, stop.lat]), selection: { operator: 'citybus', route: '11', stopId: '0', bound: 'O' } }
const vehicles = [{ id: 'one', fromDistance: 0, toDistance: 100, departureAt: now, arrivalAt: now + 60_000, validUntil: now + 180_000 }]
const result: BusRouteResponse = { ok: true, route, vehicles, reverse: [], observedAt: new Date(now).toISOString(), stale: false }

test('Citybus stop-only directions do not draw lines or ETA vehicles in either map data path', () => {
  assert.deepEqual(busPaths([route]), [])
  assert.deepEqual(transportLines([], result).features, [])
  assert.deepEqual(selectedVehicleCameras({ 'bus:citybus:11': { kind: 'bus', data: result } }, now + 1), [])
  const data: CameraData = { cameras: [{ id: 'citybus-1', sourceId: '1', kind: 'citybus', name: '', lng: stops[1].lng, lat: stops[1].lat, arrivals: [{ route: '11', destination: '', destinationEn: '', minutes: 1, eta: new Date(now + 60_000).toISOString(), observedAt: new Date(now).toISOString(), tracking: route.selection }] }], count: 1, expectedCount: 1, fetchedAt: new Date(now).toISOString(), sourceLastModified: null, source: '', complete: true }
  assert.equal(seedBusRoute([route], data, now), undefined)
  const road = { ...route, geometry: 'road' as const }
  assert.equal(busPaths([road]).length, 1)
  assert.equal(transportLines([], { ...result, route: road }).features.length, 1)
  assert.equal(selectedVehicleCameras({ 'bus:citybus:11': { kind: 'bus', data: { ...result, route: road } } }, now + 1).length, 1)
})

test('Citybus strict matching rejects near-but-unrelated stops and disconnected route fragments', () => {
  const limits = { endpoint: 65, intermediate: 65, gap: 2 }
  const displaced = stops.map((stop, i) => i === 1 ? { ...stop, lat: stop.lat + .0012 } : stop)
  assert.ok(matchBusGeometry([route.coordinates], stops, limits))
  assert.equal(matchBusGeometry([route.coordinates], displaced, limits), null)
  assert.equal(matchBusGeometry([[route.coordinates[0], route.coordinates[1]], [[114.0011, 22.3], route.coordinates[2]]], stops, limits), null)
})

test('Citybus official route candidates with the same stops but divergent streets are ambiguous', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [
    { geometry: { paths: [[[114, 22.3], [114.001, 22.3004], [114.002, 22.3]]] } },
    { geometry: { paths: [[[114, 22.3], [114.001, 22.2996], [114.002, 22.3]]] } },
  ] }))
  assert.equal(await busRoadGeometry({ operator: 'citybus', route: 'CTBAMB', stopId: '0', bound: 'O' }, stops), null)
})
