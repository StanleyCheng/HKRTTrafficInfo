import assert from 'node:assert/strict'
import test from 'node:test'
import network from '../data/tram-network.json' with { type: 'json' }
import { parseTramEta, tramStation, tramVehicleCameras, TramServiceError } from '../lib/tram.ts'
import { tramTrack } from '../lib/tram-track-geometry.ts'
import { commuterCatalogue } from '../lib/commuter-catalogue.ts'
import { getCommuterData } from '../lib/commuter-client.ts'
import { currentArrivals } from '../lib/arrival-display.ts'
import { defaultSession, parseSession } from '../lib/session-state.ts'
import { filterTransportFeed, transportRoutes } from '../lib/transport-routes.ts'
import { routePointAtDistance } from '../lib/bus-route-motion.ts'
import type { CameraData } from '../lib/traffic.ts'

const now = Date.parse('2026-10-30T10:00:00Z')
const observed = new Date(now).toISOString()
const row = { destination_code: 'HVT', destination: 'Happy Valley', arriving_in: '2', eta_type: 'ACTUAL', route_stations: ['105', '106', '107', '108', 'HVT'], estimated_arrival_time: '2026-10-30 18:02:00', estimated_dep_time: null, debug: { route_code: 'R5_HVT_to_KTT' } }
const envelope = (etas: unknown[], current_station = '105', direction = 'westbound') => ({ success: true, data: { current_station, direction, etas } })
test('all 117 published tram stations map to operator station codes; ambiguous terminals retain both queries', () => {
  for (const stop of network.stops) assert.ok(tramStation(stop.id), stop.id)
  assert.equal(tramStation('99101')?.code, '02W')
  assert.equal(tramStation('99201')?.code, 'KTT')
  assert.equal(tramStation('99304')?.directions.length, 2)
  assert.equal(tramStation('../../unknown'), undefined)
})
test('tram arrivals parse Hong Kong clocks, directions, route aliases and scheduled departures', () => {
  const actual = parseTramEta(envelope([row]), '105', 'westbound', observed)[0]!
  assert.equal(actual.eta, '2026-10-30T10:02:00.000Z')
  assert.equal(actual.destination, '跑馬地')
  assert.equal(actual.scheduled, false)
  assert.equal(actual.tram?.routeId, '4003')
  assert.equal(actual.tram?.direction, 'eastbound', 'Happy Valley bound route 4003 remains eastbound even on a shared platform')
  const scheduled = parseTramEta(envelope([{ ...row, eta_type: 'SCHEDULED', estimated_arrival_time: null, estimated_dep_time: '2026-10-30 18:04:00', arriving_in: 4 }]), '105', 'westbound', observed)[0]!
  assert.equal(scheduled.scheduled, true)
  assert.equal(scheduled.eta, '2026-10-30T10:04:00.000Z')
  const alias = parseTramEta(envelope([{ ...row, destination_code: 'WMT', debug: { route_code: 'R1_WKT_to_WM' } }]), '105', 'westbound', observed)[0]!
  assert.equal(alias.route, '4001')
  assert.equal(alias.tram?.direction, 'westbound')
  assert.equal(parseTramEta(envelope([{ ...row, arriving_in: 'ARRIVED', estimated_arrival_time: null }]), '105', 'westbound', observed)[0]?.minutes, 0)
})
test('changed/error payloads cannot impersonate empty tram boards; unknown routes remain visible without a guessed path', () => {
  assert.deepEqual(parseTramEta(envelope([]), '105', 'westbound', observed), [])
  for (const payload of [{ success: false }, envelope([{}]), envelope([row], 'wrong'), envelope([row], '105', 'eastbound'), envelope([{ ...row, arriving_in: '' }]), envelope([{ ...row, route_stations: [42] }])]) assert.throws(() => parseTramEta(payload, '105', 'westbound', observed))
  assert.throws(() => parseTramEta({ success: false, message: 'Service suspended. Use Hill Road.' }, '105', 'westbound', observed), TramServiceError)
  assert.equal(parseTramEta(envelope([{ ...row, debug: { route_code: 'unknown' } }]), '105', 'westbound', observed)[0]?.tram?.routeId, null)
})

function estimateFeed(): CameraData {
  const route = network.routes.find(route => route.id === '4003-1')!
  const track = tramTrack(route)!
  // Two observations bracket a bend and the current instant. Distances come
  // from matched track vertices, not straight lines between station locations.
  const cameras = [10, 11].map((index, i) => {
    const [lat, lng] = route.points[index]!
    const camera = commuterCatalogue('tram').find(stop => stop.lat === lat && stop.lng === lng)!
    const at = now + (i === 0 ? -30_000 : 90_000)
    return { ...camera, arrivals: [{ ...parseTramEta(envelope([row]), '105', 'westbound', observed)[0]!, eta: new Date(at).toISOString() }], dataUpdated: observed }
  })
  assert.ok(track.stopDistances[11]! > track.stopDistances[10]!)
  return { cameras, count: cameras.length, expectedCount: cameras.length, fetchedAt: observed, sourceLastModified: null, source: '', complete: true, observedAt: observed }
}
test('tram icons follow matched tracks, advance with time, preserve destination and expire from original observations', () => {
  const feed = estimateFeed()
  const start = tramVehicleCameras(feed, 'tram:4003', now)
  assert.equal(start.length, 1)
  assert.equal(start[0]?.nameEn, 'Tram → Happy Valley')
  assert.equal(start[0]?.positionType, 'vehicle')
  assert.equal(start[0]?.estimated, true)
  const position = start[0]!.routePosition!
  assert.deepEqual([start[0]!.lng, start[0]!.lat], routePointAtDistance(position.coordinates, position.distances, position.distance))
  assert.ok(tramVehicleCameras(feed, 'tram:4003', now + 30_000)[0]!.routePosition!.distance > position.distance)
  assert.deepEqual(tramVehicleCameras(feed, 'tram:4003', now + 180_000), [])
  assert.deepEqual(tramVehicleCameras(feed, 'tram:4007', now), [])
  assert.equal(currentArrivals(feed.cameras[1]!, now + 180_001).length, 0)
})
test('scheduled arrivals, unknown routes, incompatible destinations and future trips do not create invented trams', () => {
  const scheduled = estimateFeed()
  scheduled.cameras.forEach(camera => camera.arrivals!.forEach(call => { call.scheduled = true }))
  assert.deepEqual(tramVehicleCameras(scheduled, 'tram:4003', now), [])
  const unknown = estimateFeed()
  unknown.cameras.forEach(camera => camera.arrivals!.forEach(call => { call.tram!.routeId = null }))
  assert.deepEqual(tramVehicleCameras(unknown, 'tram:4003', now), [])
  const future = estimateFeed()
  future.cameras.forEach(camera => camera.arrivals!.forEach(call => { call.eta = new Date(now + 2 * 60 * 60_000).toISOString() }))
  assert.deepEqual(tramVehicleCameras(future, 'tram:4003', now), [])
  const distinct = estimateFeed()
  distinct.cameras[1]!.arrivals![0]!.destinationEn = 'Whitty Street Depot'
  assert.ok(tramVehicleCameras(distinct, 'tram:4003', now).every(camera => camera.nameEn !== 'Tram → Happy Valley'), 'a different destination must not extend the passed Happy Valley arrival')
})
test('tram station preferences default on, validate input and survive route filtering', () => {
  assert.equal(defaultSession.showTramStops, true)
  assert.equal(parseSession({ version: 1, showTramStops: false }).showTramStops, false)
  assert.equal(parseSession({ version: 1, showTramStops: 'false' }).showTramStops, true)
  const feed = estimateFeed(), routes = transportRoutes({ tram: feed })
  const filtered = filterTransportFeed('tram', feed, routes, { 'all:tram': false, 'tram:4003': true })!
  assert.equal(filtered.paths?.length, 2)
  assert.ok(filtered.cameras.some(camera => camera.arrivals?.length))
  assert.ok(filtered.cameras.every(camera => camera.routes?.includes('4003')))
  assert.ok(filtered.cameras.every(camera => camera.arrivals?.every(call => call.tram?.routeId === '4003')))
})

test('a tram ETA endpoint outage leaves the station catalogue and matched route paths available', async t => {
  let fail = true
  const live = estimateFeed()
  t.mock.method(globalThis, 'fetch', async () => fail ? Response.json({ ok: false }, { status: 503 }) : Response.json({ ok: true, cameras: live.cameras, observedAt: observed, complete: true, stale: false }))
  const data = await getCommuterData('tram', { lng: 114.18, lat: 22.28, zoom: 15 })
  assert.equal(data.cameras.length, 117)
  assert.equal(data.paths?.length, 12)
  assert.equal(data.stale, true)
  assert.equal(data.feedError, 'Tram arrivals unavailable')
  fail = false
  await getCommuterData('tram', { lng: 114.18, lat: 22.28, zoom: 15 })
  fail = true
  const retained = await getCommuterData('tram', { lng: 114.18, lat: 22.28, zoom: 15 })
  assert.equal(retained.observedAt, observed)
  assert.deepEqual(retained.cameras.map(camera => [camera.id, camera.arrivals, camera.dataUpdated]), live.cameras.map(camera => [camera.id, camera.arrivals, camera.dataUpdated]))
  assert.equal(currentArrivals(retained.cameras[1]!, now + 180_001).length, 0)
})

test('tram loader bounds nearby requests, coalesces stop reads and keeps failed directions until their original expiry', async t => {
  const { loadTramStop, loadTramNear } = await import('../lib/tram-feed.ts')
  const { GET } = await import('../app/api/tram/route.ts')
  let clock = now, calls = 0, fail = false, empty = false, failDirection: string | undefined, emptyDirection: string | undefined
  t.mock.method(Date, 'now', () => clock)
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls++
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const [code, direction] = url.pathname.split('/').slice(-2)
    if (fail || direction === failDirection) return Response.json({ success: false, message: 'Service suspended. Use Hill Road.' }, { status: 503 })
    return Response.json(envelope(empty || direction === emptyDirection ? [] : [{ ...row, ...(code === '112' ? { destination_code: direction === 'eastbound' ? 'SKT' : 'KTT', debug: { route_code: direction === 'eastbound' ? 'R2_SKT_to_HVT' : 'R5_HVT_to_KTT' } } : {}), estimated_arrival_time: new Date(clock + 120_000).toISOString().replace('T', ' ').slice(0, 19).replace('10:', '18:') }], code, direction))
  })
  const [first, duplicate] = await Promise.all([loadTramStop('99101', clock), loadTramStop('99101', clock)])
  assert.equal(calls, 1)
  assert.deepEqual(first, duplicate)
  assert.equal(first.arrivals?.length, 1)
  fail = true; clock += 31_000
  const retained = await loadTramStop('99101', clock)
  assert.equal(retained.tramEtaError, true)
  assert.equal(retained.arrivals?.[0]?.observedAt, first.arrivals?.[0]?.observedAt)
  assert.match(retained.tramEtaNotice ?? '', /Service suspended/)
  clock += 180_001
  assert.equal((await loadTramStop('99101', clock)).arrivals, undefined)
  fail = false; empty = true; clock += 31_000
  assert.deepEqual((await loadTramStop('99101', clock)).arrivals, [])
  empty = false
  const branch = await loadTramStop('99306', clock)
  assert.equal(branch.arrivals?.length, 2)
  failDirection = 'eastbound'; emptyDirection = 'westbound'; clock += 31_000
  const partial = await loadTramStop('99306', clock)
  assert.equal(partial.arrivals?.length, 1)
  assert.equal(partial.arrivals?.[0]?.tram?.direction, 'eastbound')
  assert.equal(partial.arrivals?.[0]?.observedAt, branch.arrivals?.find(call => call.tram?.direction === 'eastbound')?.observedAt)
  failDirection = undefined; emptyDirection = undefined; empty = true
  const overview = await loadTramNear(114.18, 22.28, clock, 12)
  assert.equal(overview.cameras.length, 117)
  const before = calls
  const near = await loadTramNear(114.18, 22.28, clock, 15)
  assert.equal(near.cameras.filter(camera => camera.arrivals).length, 12)
  assert.ok(calls - before <= 24)
  assert.equal((await GET(new Request('https://local/api/tram?stop=unknown'))).status, 400)
  assert.equal((await GET(new Request('https://local/api/tram'))).status, 400)
})
