import assert from 'node:assert/strict'
import test from 'node:test'
import { inferBusVehicle, loadBusRoute, validBusSelection, type BusRouteResponse, type BusRouteStop } from '../lib/bus-route.ts'
import { busDistanceAtTime } from '../lib/bus-route-motion.ts'
import { matchBusGeometry } from '../lib/bus-route-geometry.ts'
import { GET } from '../app/api/bus-route/route.ts'

const now = Date.parse('2026-10-06T10:00:00Z')
const stops: BusRouteStop[] = [0, 1, 2].map((index) => ({ id: String(index + 1), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * 0.001, lat: 22.3, distance: index * 100 }))

test('ETA inference is bounded and rejects schedule, stale, impossible and missing observations', () => {
  const eta = { seq: 2, at: now + 10_000, observed: now - 10_000, scheduled: false }
  const vehicle = inferBusVehicle(stops, [eta], 2, now, 'route')!
  assert.equal(vehicle.fromDistance, 0)
  assert.equal(vehicle.toDistance, 100)
  assert.ok(vehicle.departureAt <= now && vehicle.validUntil <= eta.observed + 180_000)
  for (const row of [{ ...eta, scheduled: true }, { ...eta, observed: now - 180_000 }, { ...eta, observed: now + 60_000 }, { ...eta, at: NaN }]) assert.equal(inferBusVehicle(stops, [row], 2, now, 'route'), null)
  assert.equal(inferBusVehicle(stops, [eta], 1, now, 'route'), null)
  assert.equal(inferBusVehicle(stops, [eta, { ...eta, seq: 3, at: eta.at + 100 }], 2, now, 'route'), null)
  assert.equal(inferBusVehicle(stops, [], 2, now, 'route'), null)
  // A distant ETA is still a live bus: it holds at the origin until its cruise starts.
  const distant = inferBusVehicle(stops, [{ ...eta, at: now + 600_000 }], 2, now, 'route')!
  assert.equal(distant.fromDistance, 0)
  assert.ok(distant.departureAt > now, 'The cruise has not started yet')
})

test('Long headways still move a bus back-projected from the next stop ETA', () => {
  const route: BusRouteStop[] = [0, 1, 2, 3].map((index) => ({ id: String(index), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * .02, lat: 22.3, distance: index * 1500 }))
  const eta = { seq: 3, at: now + 480_000, observed: now - 10_000, scheduled: false }
  const vehicle = inferBusVehicle(route, [eta], 4, now, 'route')!
  assert.equal(vehicle.fromDistance, 0)
  assert.equal(vehicle.toDistance, 3000)
  const feed: BusRouteResponse = { ok: true, observedAt: null, stale: false, vehicle }
  assert.ok(busDistanceAtTime(feed, now)! > 0, 'The bus is already mid-route')
  assert.ok(busDistanceAtTime(feed, now + 60_000)! > busDistanceAtTime(feed, now)!, 'It keeps moving toward its next stop')
})

test('A live first-stop ETA anchors the departure and keeps the bus moving', () => {
  const route: BusRouteStop[] = [0, 1, 2, 3].map((index) => ({ id: String(index), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * .02, lat: 22.3, distance: index * 1500 }))
  const observed = now - 10_000
  // The bus is still at the origin: it departs at its first-stop ETA and reaches stop 3 on time.
  const waiting = inferBusVehicle(route, [{ seq: 1, at: now + 120_000, observed, scheduled: false }, { seq: 3, at: now + 480_000, observed, scheduled: false }], 4, now, 'route')!
  assert.equal(waiting.departureAt, now + 120_000, 'The bus waits for its real departure ETA')
  assert.equal(waiting.arrivalAt, now + 480_000)
  const feed: BusRouteResponse = { ok: true, observedAt: null, stale: false, vehicle: waiting }
  assert.equal(busDistanceAtTime(feed, now), 0, 'Before departure the bus holds at the origin')
  assert.ok(Math.abs(busDistanceAtTime(feed, now + 160_000)! - 1000 / 3) < 1e-6, 'Inside the freshness window the bus is under way')
  // Once the departure ETA is past, the same anchor places the bus mid-route.
  const running = inferBusVehicle(route, [{ seq: 1, at: now - 60_000, observed, scheduled: false }, { seq: 3, at: now + 480_000, observed, scheduled: false }], 4, now, 'route')!
  assert.equal(running.departureAt, now - 60_000)
  assert.ok(busDistanceAtTime({ ok: true, observedAt: null, stale: false, vehicle: running }, now)! > 0, 'A departed bus is already moving along the route')
  // A first-stop ETA after the next stop belongs to another bus: the cruise model applies.
  const other = inferBusVehicle(route, [{ seq: 1, at: now + 500_000, observed, scheduled: false }, { seq: 3, at: now + 480_000, observed, scheduled: false }], 4, now, 'route')!
  assert.ok(other.departureAt < now, 'Fallback cruise departs in the past')
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

test('KMB route stop names drop the pole code but keep parenthetical place notes', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/route-stop/')) return Response.json({ data: [{ stop: 'EE3EA981F3D6485D', seq: 1 }, { stop: '6C15579CA43DF72E', seq: 2 }] })
    if (url.includes('FeatureServer')) return Response.json({ features: [] })
    throw new Error('ETA outage')
  }
  try {
    const result = await loadBusRoute({ operator: 'kmb', company: 'KMB', route: '1A', stopId: 'EE3EA981F3D6485D', bound: 'O', serviceType: '1' }, now)
    assert.equal(result.ok, true)
    assert.deepEqual(result.route?.stops.map((stop) => stop.nameTc), ['書院道', '黃大仙總站 (落客站)'], 'Labels show the station name without the KMB pole code')
    assert.deepEqual(result.route?.stops.map((stop) => stop.nameEn), ['COLLEGE ROAD', 'WONG TAI SIN BUS TERMINUS (ALIGHTING STOP)'], 'English names lose only the code, never the place note')
  } finally { globalThis.fetch = original }
})
