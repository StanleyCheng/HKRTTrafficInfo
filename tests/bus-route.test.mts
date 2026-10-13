import assert from 'node:assert/strict'
import test from 'node:test'
import { inferBusVehicles, loadBusRoute, validBusSelection, type BusRouteStop } from '../lib/bus-route.ts'
import { busVehicleDistanceAtTime } from '../lib/bus-route-motion.ts'
import { matchBusGeometry } from '../lib/bus-route-geometry.ts'
import { GET } from '../app/api/bus-route/route.ts'

const now = Date.parse('2026-10-06T10:00:00Z')
const stops: BusRouteStop[] = [0, 1, 2].map((index) => ({ id: String(index + 1), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * 0.001, lat: 22.3, distance: index * 100 }))

test('fleet inference is bounded and rejects stale, past and missing observations', () => {
  const eta = { seq: 2, rank: 1, at: now + 10_000, observed: now - 10_000, scheduled: false }
  const fleet = inferBusVehicles(stops, [eta], now, 'route')
  assert.equal(fleet.length, 1)
  assert.equal(fleet[0]!.fromDistance, 0)
  assert.equal(fleet[0]!.toDistance, 100)
  assert.ok(fleet[0]!.departureAt <= now && fleet[0]!.validUntil <= eta.observed + 180_000)
  // Timetable-only service still anchors the estimated bus.
  const timetable = inferBusVehicles(stops, [{ ...eta, scheduled: true }], now, 'route')
  assert.equal(timetable.length, 1, 'A scheduled (timetable) ETA still places the bus')
  for (const row of [{ ...eta, observed: now - 180_000 }, { ...eta, observed: now + 60_000 }, { ...eta, at: NaN }, { ...eta, at: now - 1000 }]) assert.deepEqual(inferBusVehicles(stops, [row], now, 'route'), [], 'Stale or already-arrived ETAs place no bus')
  assert.deepEqual(inferBusVehicles(stops, [{ ...eta, seq: 1 }], now, 'route'), [], 'A first-stop ETA is a departure bracket, not a vehicle')
  assert.deepEqual(inferBusVehicles(stops, [], now, 'route'), [])
  assert.deepEqual(inferBusVehicles(stops, [eta, { ...eta, seq: 3, at: eta.at + 100 }], now, 'route'), [], 'An impossible bracket speed rejects the chain')
  const distant = inferBusVehicles(stops, [{ ...eta, at: now + 600_000 }], now, 'route')[0]!
  assert.equal(distant.fromDistance, 0)
  assert.ok(distant.departureAt > now, 'The cruise has not started yet')
})

test('Long headways still move a bus back-projected from the next stop ETA', () => {
  const route: BusRouteStop[] = [0, 1, 2, 3].map((index) => ({ id: String(index), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * .02, lat: 22.3, distance: index * 1500 }))
  const eta = { seq: 3, rank: 1, at: now + 480_000, observed: now - 10_000, scheduled: false }
  const [vehicle] = inferBusVehicles(route, [eta], now, 'route')
  assert.equal(vehicle.fromDistance, 0)
  assert.equal(vehicle.toDistance, 3000)
  assert.ok(busVehicleDistanceAtTime(vehicle, now)! > 0, 'The bus is already mid-route')
  assert.ok(busVehicleDistanceAtTime(vehicle, now + 60_000)! > busVehicleDistanceAtTime(vehicle, now)!, 'It keeps moving toward its next stop')
})

test('A live first-stop ETA anchors the departure and keeps the bus moving', () => {
  const route: BusRouteStop[] = [0, 1, 2, 3].map((index) => ({ id: String(index), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * .02, lat: 22.3, distance: index * 1500 }))
  const observed = now - 10_000
  // The bus is still at the origin: it departs at its first-stop ETA and reaches stop 3 on time.
  const [waiting] = inferBusVehicles(route, [{ seq: 1, rank: 1, at: now + 120_000, observed, scheduled: false }, { seq: 3, rank: 1, at: now + 480_000, observed, scheduled: false }], now, 'route')
  assert.equal(waiting.departureAt, now + 120_000, 'The bus waits for its real departure ETA')
  assert.equal(waiting.arrivalAt, now + 480_000)
  assert.equal(busVehicleDistanceAtTime(waiting, now), 0, 'Before departure the bus holds at the origin')
  assert.ok(Math.abs(busVehicleDistanceAtTime(waiting, now + 160_000)! - 1000 / 3) < 1e-6, 'Inside the freshness window the bus is under way')
  // Once the departure ETA is past, the same anchor places the bus mid-route.
  const [running] = inferBusVehicles(route, [{ seq: 1, rank: 1, at: now - 60_000, observed, scheduled: false }, { seq: 3, rank: 1, at: now + 480_000, observed, scheduled: false }], now, 'route')
  assert.equal(running.departureAt, now - 60_000)
  assert.ok(busVehicleDistanceAtTime(running, now)! > 0, 'A departed bus is already moving along the route')
  // A first-stop ETA after the next stop belongs to another bus: the cruise model applies.
  const [other] = inferBusVehicles(route, [{ seq: 1, rank: 1, at: now + 500_000, observed, scheduled: false }, { seq: 3, rank: 1, at: now + 480_000, observed, scheduled: false }], now, 'route')
  assert.ok(other.departureAt < now, 'Fallback cruise departs in the past')
})

test('every published rank chains into its own bus across stops', () => {
  const route: BusRouteStop[] = [0, 1, 2, 3].map((index) => ({ id: String(index), seq: index + 1, nameTc: '', nameEn: '', lng: 114 + index * .02, lat: 22.3, distance: index * 1500 }))
  const observed = now - 10_000
  // Two ranks at one stop are two buses; the same rank seen from a downstream
  // stop chains onto one bus and must not double it.
  const fleet = inferBusVehicles(route, [
    { seq: 2, rank: 1, at: now + 240_000, observed, scheduled: false },
    { seq: 2, rank: 2, at: now + 600_000, observed, scheduled: false },
    { seq: 3, rank: 1, at: now + 360_000, observed, scheduled: false },
  ], now, 'route')
  assert.equal(fleet.length, 2, 'One bus per rank; the seq-3 sighting of rank 1 chains onto the same bus')
  assert.deepEqual(fleet.map(vehicle => vehicle.toDistance), [1500, 1500], 'Before the first observed arrival each bus cruises toward its first stop')
  assert.deepEqual(fleet.map(vehicle => vehicle.departureAt - now), [120_000, 350_000], 'The rank-1 pair paces its cruise; the lone rank-2 entry uses the network default')
  assert.deepEqual(fleet.map(vehicle => vehicle.id), ['route:1:2', 'route:2:2'])
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

test('full NLB route survives ETA failure and scheduled-only data has no vehicles', async () => {
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
    assert.equal(result.vehicles.length, 0)
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

test('whole-route arrivals distinguish malformed payloads, empty service and invalid source clocks', async (t) => {
  const original = globalThis.fetch
  let clock = now, phase = 'malformed'
  t.mock.method(Date, 'now', () => clock)
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('action=list')) return Response.json({ stops: stops.map(stop => ({ stopId: stop.id, longitude: stop.lng, latitude: stop.lat, stopName_e: 'Stop' })) })
    if (url.includes('FeatureServer')) return Response.json({ features: [] })
    if (phase === 'empty') return Response.json({ estimatedArrivals: [] })
    if (phase === 'bad-clock') return Response.json({ estimatedArrivals: [{ estimatedArrivalTime: new Date(clock + 60_000).toISOString(), generateTime: 'invalid', departed: '1', noGPS: '0' }] })
    return Response.json({ error: 'Provider layout changed' })
  }
  const selection = { operator: 'nlb' as const, route: 'TEST', stopId: '2', routeId: '999998' }
  try {
    const malformed = await loadBusRoute(selection, clock)
    assert.equal(malformed.ok, true, 'the known route geometry remains usable')
    assert.equal(malformed.stale, true)
    assert.match(malformed.error ?? '', /could not refresh/)
    phase = 'empty'; clock += 5_000
    const empty = await loadBusRoute(selection, clock)
    assert.equal(empty.stale, false, 'an explicit empty board is a successful no-service result')
    assert.deepEqual(empty.vehicles, [])
    phase = 'bad-clock'; clock += 5_000
    const invalid = await loadBusRoute(selection, clock)
    assert.equal(invalid.stale, true)
    assert.deepEqual(invalid.vehicles, [])
  } finally { globalThis.fetch = original }
})
