import assert from 'node:assert/strict'
import test from 'node:test'
import { transportRoutes, routeVisible, setAllRoutes, filterTransportFeed, busPaths } from '../lib/transport-routes.ts'
import { normalizeIntegration } from '../lib/integration-client.ts'
import { parseSession } from '../lib/session-state.ts'
import { GET } from '../app/api/bus-route-paths/route.ts'
import { loadBusRoutePaths } from '../lib/bus-route.ts'
import type { MtrResponse } from '../lib/types.ts'
import { kinds, layerCategoryKinds, layerCategories, type CameraData } from '../lib/traffic.ts'

test('route catalogue retains all rail lines, individual Light Rail services, ferry pairs and ordered tram/bus paths', () => {
  const routes = transportRoutes({})
  for (const [kind, count] of [['mtr', 10], ['lrt', 12], ['ferry', 16], ['tram', 6], ['mtr-bus', 26]] as const) {
    const options = routes.filter(route => route.kind === kind)
    assert.equal(options.length, count)
    assert.ok(options.every(route => route.name && route.nameEn && route.paths.some(path => path.points.length > 1)))
  }
  assert.equal(new Set(routes.map(route => route.id)).size, routes.length)
})

test('bulk route visibility also applies to future loaded routes and preserves the other transport modes', () => {
  let visibility = setAllRoutes({ 'bus:kmb:1': true, 'rail:mtr:TWL': false }, 'bus', false)
  assert.equal(routeVisible({ id: 'bus:citybus:NEW', mode: 'bus' }, visibility), false)
  assert.equal(routeVisible({ id: 'rail:mtr:TWL', mode: 'rail' }, visibility), false)
  visibility = { ...visibility, 'bus:kmb:1': true }
  assert.equal(routeVisible({ id: 'bus:kmb:1', mode: 'bus' }, visibility), true)
  assert.equal(routeVisible({ id: 'bus:kmb:2', mode: 'bus' }, visibility), false)
  visibility = setAllRoutes(visibility, 'bus', true)
  assert.equal(routeVisible({ id: 'bus:kmb:2', mode: 'bus' }, visibility), true)
})

test('rail filters keep shared interchanges and remove hidden paths, boards, arrivals and vehicles together', () => {
  const payload: MtrResponse = { ok: true, observedAt: new Date().toISOString(), boards: [], trains: [] }
  const data = normalizeIntegration('mtr', payload)
  const routes = transportRoutes({ mtr: data })
  const onlyTwl = { ...setAllRoutes({}, 'rail', false), 'rail:mtr:TWL': true }
  const filtered = filterTransportFeed('mtr', data, routes, onlyTwl)!
  assert.ok(filtered.cameras.some(camera => camera.sourceId === 'ADM'), 'Admiralty remains on the Tsuen Wan line')
  assert.ok(!filtered.cameras.some(camera => camera.sourceId === 'SHT'), 'East Rail-only station disappears')
  assert.ok(filtered.paths?.every(path => path.line === 'TWL'))
  assert.equal(filterTransportFeed('mtr', data, routes, setAllRoutes({}, 'rail', false))!.cameras.length, 0)
})

test('bus routes are scoped by operator, stops shared with selected routes remain, and geometry uses map coordinate order', () => {
  const data: CameraData = { cameras: [{ id: 'kmb-A', sourceId: 'A', kind: 'kmb', name: 'A', lat: 22.3, lng: 114.1, routes: ['1', '2'], arrivals: [{ route: '2', minutes: null, destination: 'B', destinationEn: 'B' }] }, { id: 'kmb-B', sourceId: 'B', kind: 'kmb', name: 'B', lat: 22.4, lng: 114.2, routes: ['2'] }], count: 2, expectedCount: 2, fetchedAt: '', sourceLastModified: null, source: '', complete: true }
  const routes = transportRoutes({ kmb: data })
  const filtered = filterTransportFeed('kmb', data, routes, { ...setAllRoutes({}, 'bus', false), 'bus:kmb:1': true })!
  assert.deepEqual(filtered.cameras.map(camera => camera.sourceId), ['A'])
  assert.deepEqual(filtered.cameras[0].arrivals, [])
  assert.deepEqual(filtered.cameras[0].routes, ['1'])
  assert.deepEqual(busPaths([{ key: 'one', operator: 'kmb', coordinates: [[114.1, 22.3], [114.2, 22.4]] }])[0].points, [[22.3, 114.1], [22.4, 114.2]])
})

test('saved route preferences survive reload and reject malformed records; old rail popovers migrate to Layers', () => {
  const state = parseSession({ version: 1, openControl: 'rail', transportMode: 'ferry', routeQuery: 'Central', routeVisibility: { 'all:bus': false, 'rail:mtr:TWL': true, unknown: true, 'bus:kmb:1': 'yes' } })
  assert.equal(state.openControl, 'layers')
  assert.equal(state.transportMode, 'ferry')
  assert.equal(state.layerCategory, 'ferry')
  assert.equal(state.routeQuery, 'Central')
  assert.deepEqual(state.routeVisibility, { 'all:bus': false, 'rail:mtr:TWL': true })
})

test('layer categories cover every map layer exactly once and restore validated browsing independently of routes', () => {
  const categorized = layerCategories.flatMap(category => layerCategoryKinds[category])
  assert.deepEqual([...categorized].sort(), [...kinds].sort())
  assert.equal(new Set(categorized).size, categorized.length)
  const visibility = { 'all:rail': false, 'rail:mtr:TWL': true }
  const restored = parseSession({ version: 1, layerCategory: 'roads', transportMode: 'rail', routeVisibility: visibility })
  assert.equal(restored.layerCategory, 'roads')
  assert.deepEqual(restored.routeVisibility, visibility)
  for (const category of layerCategories) assert.equal(parseSession({ version: 1, layerCategory: category }).layerCategory, category)
  for (const invalid of ['__proto__', 'unknown', {}, null]) assert.equal(parseSession({ version: 1, layerCategory: invalid }).layerCategory, 'roads')
  assert.equal(parseSession({ version: 1, transportMode: 'unknown' }).layerCategory, 'roads')
})

test('bus geometry endpoint rejects malformed route requests before any upstream call', async () => {
  for (const query of ['operator=rail&route=1&stopId=A', 'operator=kmb&route=../../&stopId=A', 'operator=kmb&route=1']) {
    assert.equal((await GET(new Request(`http://localhost/api/bus-route-paths?${query}`))).status, 400)
  }
})

test('explicit bus selections remain available after moving away and reloading, without saving live data', () => {
  const session = parseSession({ version: 1, chosenBusRoutes: [{ operator: 'kmb', route: '1', stopId: 'POLE1', name: '路線一', nameEn: 'Route one', arrivals: ['not saved'] }, { operator: 'rail', route: '1', stopId: 'X', name: '', nameEn: '' }] })
  assert.equal(session.chosenBusRoutes.length, 1)
  assert.ok(!('arrivals' in session.chosenBusRoutes[0]))
  const restored = transportRoutes({}, session.chosenBusRoutes).find(route => route.id === 'bus:kmb:1')!
  assert.equal(restored.bus?.stopId, 'POLE1')
  assert.equal(restored.nameEn, 'Route one')
})

test('geometry-only bus loading preserves directions, accepts an off-route viewport anchor and never requests ETAs', async t => {
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input); requests.push(url)
    if (url.includes('/route-stop/')) return Response.json({ data: [{ stop: 'EE3EA981F3D6485D', seq: 1 }, { stop: '6C15579CA43DF72E', seq: 2 }] })
    if (url.includes('FeatureServer')) return Response.json({ features: [] })
    throw new Error('Unexpected ETA or place request')
  })
  const routes = await loadBusRoutePaths({ operator: 'kmb', route: 'TEST99', stopId: 'OFFROUTE' })
  assert.equal(routes.length, 2)
  assert.ok(routes.every(route => route.geometry === 'stops' && route.stops.length === 2))
  assert.ok(requests.some(url => url.includes('outbound')) && requests.some(url => url.includes('inbound')))
  assert.ok(requests.every(url => url.includes('/route-stop/') || url.includes('FeatureServer')))
})
