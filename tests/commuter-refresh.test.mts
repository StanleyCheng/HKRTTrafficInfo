import assert from 'node:assert/strict'
import test from 'node:test'
import { currentArrivals } from '../lib/arrival-display.ts'
import { arrivalRows } from '../lib/place-arrivals.ts'
import { parseWarnsum } from '../lib/warnings.ts'
import { commuterCatalogue, mtrBusDestination, tramPaths } from '../lib/commuter-catalogue.ts'
import { parseMtrBusSchedule } from '../lib/mtr-bus-feed.ts'
import { parsePedestrian } from '../lib/pedestrian.ts'
import { nearbyCategory, nearbyCategoryKinds } from '../lib/nearby.ts'
import { defaultSession, parseSession, savedPlace } from '../lib/session-state.ts'
import { viewCachedGet, selectionCachedGet } from '../lib/view-cache.ts'
import type { Camera } from '../lib/traffic.ts'

const now = Date.parse('2026-10-23T04:00:00Z')
test('warning error envelopes cannot clear active warnings; explicit empty object remains an all-clear', () => {
  for (const payload of [{ error: 'Unavailable' }, { error: { message: 'Unavailable' } }, { WRAIN: {} }]) assert.throws(() => parseWarnsum(payload))
  assert.deepEqual(parseWarnsum({}), [])
  assert.equal(parseWarnsum({ WRAIN: { code: 'WRAINB' } })[0]?.urgent, true)
})
test('operator rows validate identities and nested arrays before replacing last-good arrivals', () => {
  assert.equal(arrivalRows([{}], 'bus'), null)
  assert.equal(arrivalRows([{ route: '1', dir: 'O', eta: {} }], 'bus'), null)
  assert.equal(arrivalRows([{ route_id: 1, route_seq: 1, eta: { error: 'Unavailable' } }], 'gmb'), null)
  assert.equal(arrivalRows([{ route_id: 1, route_seq: 1, eta: [{}] }], 'gmb'), null)
  assert.deepEqual(arrivalRows([], 'bus'), [])
  assert.equal(arrivalRows([{ route: '1', dir: 'O', eta: null }], 'bus')?.length, 1)
})
test('live details expire independently while the place and its published facilities remain', () => {
  const camera: Camera = { id: 'kmb-1', sourceId: '1', kind: 'kmb', name: 'Stop', lat: 22.3, lng: 114.1, dataUpdated: new Date(now).toISOString(), arrivals: [{ route: '1', destination: 'End', destinationEn: 'End', minutes: 1, eta: new Date(now + 60_000).toISOString() }] }
  assert.equal(currentArrivals(camera, now).length, 1)
  assert.equal(currentArrivals(camera, now + 120_001).length, 0)
  assert.equal(camera.name, 'Stop')
  assert.equal(currentArrivals({ ...camera, dataUpdated: new Date(now - 180_001).toISOString() }, now).length, 0)
})
test('all four catalogues carry real coordinates and bilingual labels; tram fares retain currency scale', () => {
  for (const kind of ['mtr-bus', 'tram', 'access', 'taxi'] as const) {
    const places = commuterCatalogue(kind)
    assert.ok(places.length > 50, kind)
    assert.equal(new Set(places.map(place => place.id)).size, places.length, kind)
    assert.ok(places.every(p => p.name && p.nameEn && p.lng > 113.8 && p.lng < 114.5 && p.lat > 22.1 && p.lat < 22.6), kind)
  }
  assert.ok(tramPaths().length >= 6)
  assert.match(commuterCatalogue('tram')[0]!.rows![0]!.value, /HK\$\d\.\d/)
  assert.ok(mtrBusDestination('K12_TPMS')?.en)
})
test('MTR bus schedules reject alert-shaped errors and frozen clocks while preserving scheduled labels', () => {
  const payload = { status: '1', routeName: 'K12', routeStatusTime: '2026/10/23 12:00', busStop: [{ busStopId: 'K12-U010', bus: [{ lineRef: 'K12_TPMS', arrivalTimeInSecond: '108000', departureTimeInSecond: '120', isScheduled: '1' }] }] }
  const result = parseMtrBusSchedule(payload, 'K12', now)
  assert.equal(result.alert, false)
  assert.equal(result.boards[0]!.arrivals[0]!.minutes, 2)
  assert.equal(result.boards[0]!.arrivals[0]!.scheduled, true)
  assert.equal(result.boards[0]!.arrivals[0]!.mtrLineRef, 'K12_TPMS')
  assert.equal(parseMtrBusSchedule({ ...payload, status: '0' }, 'K12', now).alert, true)
  assert.throws(() => parseMtrBusSchedule(payload, 'K12', now + 180_001))
  assert.throws(() => parseMtrBusSchedule({ status: '0', error: 'Down' }, 'K12', now))
})
test('pedestrian access and barrier flags are distinct; infrastructure does not claim live operation', () => {
  const features = [1, 2, 3].map((id) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[114.16, 22.28], [114.161, 22.281]] }, properties: { OBJECTID: id, Enabled: 1, FeatureType: 10, WheelchairAccess: id === 1 ? 1 : id === 2 ? 2 : null, WheelchairBarrier: 2 } }))
  const result = parsePedestrian({ type: 'FeatureCollection', features })
  assert.deepEqual(result.paths.map(path => path.color), ['#137f87', '#b76c28', '#8a9aa5'])
  assert.ok(result.cameras.every(camera => camera.information?.en.includes('without live operating status')))
  assert.throws(() => parsePedestrian({ error: 'Down' }))
})
test('stairs and other access facilities are separate nearby categories sharing a feed', () => {
  const features = [10, 12, 13, 20, 21].map((type, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[114.16, 22.28], [114.161, 22.281]] }, properties: { OBJECTID: i, Enabled: 1, FeatureType: type, WheelchairAccess: 1, WheelchairBarrier: 2 } }))
  const result = parsePedestrian({ type: 'FeatureCollection', features })
  assert.deepEqual(result.cameras.map(nearbyCategory), ['access', 'stairs', 'access', 'stairs', 'access'])
  assert.deepEqual(nearbyCategoryKinds(['access', 'stairs']), ['access'])
})
test('saved sessions validate old or corrupt values and strip all live data before restoration', () => {
  assert.equal(parseSession({ version: 99 }), defaultSession)
  const place: Camera = { id: 'kmb-1', sourceId: '1', kind: 'kmb', name: 'Stop', nameEn: 'Stop', lng: 114.1, lat: 22.3, arrivals: [], dataUpdated: new Date(now).toISOString() }
  const session = parseSession({ version: 1, view: { lng: 114.12, lat: 22.3, zoom: 15.5 }, mapMode: '3d', camera3D: { pitch: 35, bearing: 42 }, nearbyRadius: 2000, showNearbyOnMap: true, showBusStops: false, selectedPlace: place, busSelection: { operator: 'kmb', route: '1', stopId: 'ABC', bound: 'O', serviceType: '1' } })
  assert.equal(session.mapMode, '3d')
  assert.equal(session.view?.zoom, 15.5)
  assert.equal(session.busSelection?.route, '1')
  assert.equal(session.nearbyRadius, 2000)
  assert.equal(session.showNearbyOnMap, true)
  assert.equal(parseSession({ version: 1 }).showNearbyOnMap, false)
  assert.equal(parseSession({ version: 1, showNearbyOnMap: 'true' }).showNearbyOnMap, false)
  assert.deepEqual(parseSession({ version: 1 }).nearbyCategories, ['rail', 'bus', 'tram', 'ferry', 'access', 'stairs', 'taxi'])
  assert.deepEqual(parseSession({ version: 1, nearbyCategories: ['bus', 'access', 'invalid', 'bus'] }).nearbyCategories, ['bus', 'access', 'stairs'])
  assert.deepEqual(parseSession({ version: 1, nearbyCategories: ['bus'] }).nearbyCategories, ['bus'])
  assert.deepEqual(parseSession({ version: 1, nearbyCategoryVersion: 2, nearbyCategories: ['bus', 'access'] }).nearbyCategories, ['bus', 'access'])
  assert.deepEqual(parseSession({ version: 1, nearbyCategoryVersion: 2, nearbyCategories: ['stairs'] }).nearbyCategories, ['stairs'])
  assert.deepEqual(parseSession({ version: 1, nearbyCategories: [] }).nearbyCategories, [])
  assert.equal(session.showBusStops, false)
  assert.equal(parseSession({ version: 1 }).showFerryPiers, true)
  assert.equal(parseSession({ version: 1, showFerryPiers: false }).showFerryPiers, false)
  assert.equal(parseSession({ version: 1, showFerryPiers: 'false' }).showFerryPiers, true)
  assert.deepEqual(session.selectedPlace, savedPlace(place))
  assert.equal(session.selectedPlace?.arrivals, undefined)
  assert.equal(session.selectedPlace?.dataUpdated, undefined)
  assert.equal(savedPlace({ ...place, positionType: 'vehicle' })?.positionType, 'vehicle')
  const stop = { id: 'END', seq: 2, nameTc: '終點', nameEn: 'End', lng: 114.16, lat: 22.28, distance: 900 }
  assert.deepEqual(parseSession({ version: 1, routeStop: { key: 'route-key', stop }, intelOpen: true, intelTab: 'weather', searchQuery: 'Admiralty', searchScope: 'locations', searchPage: 2 }).routeStop, { key: 'route-key', stop })
  assert.equal(parseSession({ version: 1, camera3D: { pitch: 500, bearing: NaN }, view: { lng: Infinity, lat: 20, zoom: 16 } }).view, null)
})
test('both cache variants stop serving arrivals after the original retention age', async (t) => {
  let clock = now, fail = false
  t.mock.method(Date, 'now', () => clock)
  type Body = { ok: boolean; observedAt: string | null; stale?: boolean }
  const options = { freshMs: 0, keepMs: 180_000, load: async (): Promise<Body> => { if (fail) throw Error('offline'); return { ok: true, observedAt: new Date(now).toISOString() } }, failed: () => ({ ok: false, observedAt: null }) }
  const view = viewCachedGet<Body>({ ...options, missing: options.failed })
  const selection = selectionCachedGet<Body>({ ...options, cacheKey: () => 'route', invalid: options.failed })
  const request = new Request('https://local/api/kmb?lng=114.1&lat=22.3&zoom=15')
  await Promise.all([view(request), selection(request)])
  fail = true; clock += 60_000
  assert.equal((await (await view(request)).json() as Body).stale, true)
  clock += 180_001
  assert.equal((await (await view(request)).json() as Body).ok, false)
  assert.equal((await (await selection(request)).json() as Body).ok, false)
})
