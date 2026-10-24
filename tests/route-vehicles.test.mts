import assert from 'node:assert/strict'
import test from 'node:test'
import { seedBusRoute, selectedVehicleCameras, mtrBusVehicleCameras } from '../lib/route-vehicles.ts'
import { readRouteVehicleSnapshot, isBusRouteData } from '../lib/route-vehicle-response.ts'
import { mtrBusStops } from '../lib/commuter-catalogue.ts'
import { GET } from '../app/api/route-vehicles/route.ts'
import type { BusRouteData, BusRouteResponse, BusRouteSelection } from '../lib/bus-route.ts'
import { loadBusRouteVehicles } from '../lib/bus-route.ts'
import type { CameraData } from '../lib/traffic.ts'

const now = Date.parse('2026-10-24T02:00:00Z')
const selection: BusRouteSelection = { operator: 'kmb', route: '1', stopId: 'B', company: 'KMB', bound: 'O', serviceType: '1' }
const route: BusRouteData = { key: 'kmb:1:O:1::', operator: 'kmb', route: '1', company: 'KMB', selection, geometry: 'road', coordinates: [[114.15, 22.3], [114.16, 22.3]], stops: [
  { id: 'A', seq: 1, nameTc: '起點', nameEn: 'Origin', lat: 22.3, lng: 114.15, distance: 0 },
  { id: 'B', seq: 2, nameTc: '終點', nameEn: 'Terminus', lat: 22.3, lng: 114.16, distance: 1000 },
] }
const feed: CameraData = { cameras: [{ id: 'kmb-B', sourceId: 'B', kind: 'kmb', name: '終點', nameEn: 'Terminus', lat: 22.3, lng: 114.16, dataUpdated: new Date(now).toISOString(), arrivals: [{ route: '1', destination: '終點', destinationEn: 'Terminus', minutes: 1, eta: new Date(now + 60000).toISOString(), tracking: selection }] }], fetchedAt: new Date(now).toISOString(), observedAt: new Date(now).toISOString(), source: '', sourceLastModified: null, complete: true, count: 1, expectedCount: 1 }

test('fresh viewport ETAs seed a selected bus immediately and move along its complete route before a full response', () => {
  const snapshot = seedBusRoute([route], feed, now)!
  assert.equal(snapshot.vehicles.length, 1)
  const feeds = { 'bus:kmb:1': { kind: 'bus' as const, data: snapshot } }
  const first = selectedVehicleCameras(feeds, now)[0], next = selectedVehicleCameras(feeds, now + 10000)[0]
  assert.ok(first.lng > 114.15 && first.lng < 114.16)
  assert.ok(next.lng > first.lng)
  assert.equal(first.estimated, true)
  assert.equal(first.company, 'KMB')
  assert.equal(first.arrivals?.[0].route, '1')
  assert.equal(first.positionSource, undefined)
  assert.equal(selectedVehicleCameras(feeds, now + 180000).length, 0)
})

test('seeding rejects the other bound, service variant, invalid clocks and missing exact direction metadata', () => {
  for (const tracking of [{ ...selection, bound: 'I' as const }, { ...selection, serviceType: '2' }]) {
    const other = { ...feed, cameras: feed.cameras.map(camera => ({ ...camera, arrivals: camera.arrivals!.map(call => ({ ...call, tracking })) })) }
    assert.equal(seedBusRoute([route], other, now), undefined)
  }
  assert.equal(seedBusRoute([{ ...route, selection: undefined }], feed, now), undefined)
  assert.equal(seedBusRoute([route], { ...feed, cameras: feed.cameras.map(camera => ({ ...camera, dataUpdated: new Date(now - 180000).toISOString() })) }, now), undefined)
})

test('several selected routes have independent identities and expiry without inventing movement for empty data', () => {
  const first = seedBusRoute([route], feed, now)!
  const second: BusRouteResponse = { ...first, route: { ...route, key: 'second', route: '2', operator: 'citybus' } }
  const markers = selectedVehicleCameras({ 'bus:kmb:1': { kind: 'bus', data: first }, 'bus:citybus:2': { kind: 'bus', data: second } }, now)
  assert.equal(markers.length, 2)
  assert.equal(new Set(markers.map(camera => camera.id)).size, 2)
  assert.deepEqual(selectedVehicleCameras({ empty: { kind: 'bus', data: { ...first, vehicles: [], reverse: [] } } }, now), [])
})

test('MTR Bus route schedules produce labelled estimates on ordered stop connections and expire at the source lifetime', () => {
  const rows = mtrBusStops.filter(stop => stop.route === 'K12' && stop.direction === 'O').sort((a, b) => a.seq - b.seq)
  const last = rows.at(-1)!
  const data: CameraData = { ...feed, cameras: [{ id: `mtr-bus-${last.id}`, sourceId: last.id, kind: 'mtr-bus', name: last.tc, nameEn: last.en, lat: last.lat, lng: last.lng, dataUpdated: new Date(now).toISOString(), arrivals: [{ route: 'K12', destination: last.tc, destinationEn: last.en, eta: new Date(now + 60000).toISOString(), minutes: 1, observedAt: new Date(now).toISOString(), scheduled: true }] }] }
  const markers = mtrBusVehicleCameras(data, 'K12', now)
  assert.ok(markers.length > 0)
  assert.ok(markers.every(camera => camera.kind === 'mtr-bus' && camera.estimated && camera.routePosition))
  assert.match(markers[0].information!.en, /not vehicle GPS/)
  assert.equal(markers[0].arrivals?.[0].scheduled, true)
  assert.equal(mtrBusVehicleCameras(data, 'K12', now + 180000).length, 0)
})

test('vehicle protocol validates nested geometry, ETAs and timelines before renderers use them', () => {
  const data = seedBusRoute([route], feed, now)!
  assert.ok(isBusRouteData(route))
  assert.equal(readRouteVehicleSnapshot({ ok: true, snapshot: { kind: 'bus', data } }).kind, 'bus')
  const retained = readRouteVehicleSnapshot({ ok: true, stale: true, error: 'Refresh unavailable', snapshot: { kind: 'bus', data } })
  assert.equal(retained.data.stale, true)
  assert.equal(retained.data.observedAt, data.observedAt)
  assert.equal(retained.kind === 'bus' && retained.data.vehicles[0].validUntil, data.vehicles[0].validUntil)
  for (const broken of [{ ...data, route: { ...route, coordinates: [[NaN, 22.3]] } }, { ...data, vehicles: [{ id: 'missing clocks' }] }, { ...data, reverse: [{}] }]) {
    assert.throws(() => readRouteVehicleSnapshot({ ok: true, snapshot: { kind: 'bus', data: broken } }), /unavailable/)
  }
  assert.throws(() => readRouteVehicleSnapshot({ ok: true, snapshot: { kind: 'mtr-bus', data: { cameras: [] } } }), /unavailable/)
})

test('route vehicle endpoint rejects invalid transport, code and selection before any upstream request', async () => {
  for (const query of ['operator=tram&route=4001', 'operator=mtr-bus&route=../../', 'operator=kmb&route=1&stopId=B&bound=BAD']) {
    assert.equal((await GET(new Request(`http://localhost/api/route-vehicles?${query}`))).status, 400)
  }
})

test('route-wide selection uses the available bound when its default bound has no route', async t => {
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/route-stop/') && url.includes('/outbound/')) throw new Error('No outbound service')
    if (url.includes('/route-stop/')) return Response.json({ data: [{ stop: 'EE3EA981F3D6485D', seq: 1 }, { stop: '6C15579CA43DF72E', seq: 2 }] })
    if (url.includes('FeatureServer')) return Response.json({ features: [] })
    return Response.json({ data: [] })
  })
  const data = await loadBusRouteVehicles({ operator: 'kmb', route: 'REVTEST', stopId: 'EE3EA981F3D6485D' }, now)
  assert.equal(data.ok, true)
  assert.equal(data.route?.selection?.bound, 'I')
  assert.equal(data.route?.stops.length, 2)
  assert.deepEqual(data.vehicles, [])
  assert.deepEqual(data.reverse, [])
})
