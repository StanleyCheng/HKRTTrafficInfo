import assert from 'node:assert/strict'
import test from 'node:test'
import { inferBusVehicle, loadBusRoute, validBusSelection, type BusRouteStop } from '../lib/bus-route.ts'
import { matchBusGeometry } from '../lib/bus-route-geometry.ts'
import { GET } from '../app/api/bus-route/route.ts'

const now = Date.parse('2026-10-06T10:00:00Z')
const stops: BusRouteStop[] = [0, 1, 2].map((index) => ({ id: String(index + 1), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * 0.001, lat: 22.3, distance: index * 100 }))

test('ETA inference is bounded and rejects schedule, stale, distant, impossible and missing observations', () => {
  const eta = { seq: 2, at: now + 10_000, observed: now - 10_000, scheduled: false }
  const vehicle = inferBusVehicle(stops, [eta], 2, now, 'route')!
  assert.equal(vehicle.fromDistance, 0)
  assert.equal(vehicle.toDistance, 100)
  assert.ok(vehicle.departureAt <= now && vehicle.validUntil <= eta.observed + 180_000)
  for (const row of [{ ...eta, scheduled: true }, { ...eta, observed: now - 180_000 }, { ...eta, observed: now + 60_000 }, { ...eta, at: now + 600_000 }, { ...eta, at: NaN }]) assert.equal(inferBusVehicle(stops, [row], 2, now, 'route'), null)
  assert.equal(inferBusVehicle(stops, [eta], 1, now, 'route'), null)
  assert.equal(inferBusVehicle(stops, [eta, { ...eta, seq: 3, at: eta.at + 100 }], 2, now, 'route'), null)
  assert.equal(inferBusVehicle(stops, [], 2, now, 'route'), null)
})

test('road geometry matches whole ordered route and rejects reverse/disconnected/far-off shapes', () => {
  const paths = [[[114, 22.3], [114.001, 22.3]], [[114.001, 22.3], [114.002, 22.3]]]
  const shape = matchBusGeometry(paths, stops)!
  assert.ok(shape)
  assert.ok(shape.stopDistances[1] > 100 && shape.stopDistances[1] < 105)
  assert.equal(matchBusGeometry([[[114, 22.3], [114.001, 22.3]], [[114.02, 22.3], [114.002, 22.3]]], stops), null)
  assert.equal(matchBusGeometry([[[114, 22.3], [114.04, 22.3]]], stops), null)
  const longer = stops.map((stop, index) => ({ ...stop, lng: 114 + index * 0.01 }))
  assert.equal(matchBusGeometry([longer.map((stop) => [stop.lng, stop.lat]).reverse()], longer), null)
})

test('selection requires exact operator direction/variant and rejects unsafe or invalid API input', async () => {
  assert.equal(validBusSelection({ operator: 'kmb', route: '1A', stopId: 'ABC', bound: 'O', serviceType: '1' }), true)
  assert.equal(validBusSelection({ operator: 'kmb', route: '1A', stopId: 'ABC' }), false)
  assert.equal(validBusSelection({ operator: 'citybus', route: "1' OR 1=1", stopId: '001', bound: 'I' }), false)
  assert.equal(validBusSelection({ operator: 'gmb', route: '49S', stopId: '12', routeId: '2004033', routeSeq: 3 }), false)
  assert.equal((await GET(new Request('https://test/api/bus-route?operator=kmb&route=1A&stopId=ABC'))).status, 400)
})

test('full NLB route survives ETA failure and scheduled-only data has no vehicle', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('action=list')) return Response.json({ stops: stops.map((stop) => ({ stopId: stop.id, longitude: stop.lng, latitude: stop.lat, stopName_e: 'Stop' })) })
    if (url.includes('FeatureServer')) return Response.json({ features: [] })
    throw new Error('ETA outage')
  }
  try {
    const result = await loadBusRoute({ operator: 'nlb', route: 'TEST', stopId: '2', routeId: '999999' }, now)
    assert.equal(result.ok, true)
    assert.equal(result.route?.stops.length, 3)
    assert.equal(result.route?.geometry, 'stops')
    assert.equal(result.stale, true)
    assert.equal(result.vehicle, null)
  } finally { globalThis.fetch = original }
})
