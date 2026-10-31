import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCitybusNear } from '../lib/citybus-feed.ts'
import { loadMtrBusNear, loadMtrBusRoute } from '../lib/mtr-bus-feed.ts'
import { mtrBusStops } from '../lib/commuter-catalogue.ts'
import { integrationRequestKey } from '../lib/integration-client.ts'
import { kmbCacheKey } from '../lib/kmb-reach.ts'

test('bus viewport keys follow server cache cells rather than tiny GPS and zoom movements', () => {
  const view = { lng: 114.17, lat: 22.32, zoom: 16 }
  for (const kind of ['kmb', 'citybus', 'gmb', 'nlb', 'mtr-bus'] as const) {
    assert.equal(integrationRequestKey(kind, view, 'en'), integrationRequestKey(kind, { lng: 114.170001, lat: 22.320001, zoom: 16.00001 }, 'zh'))
    assert.notEqual(integrationRequestKey(kind, view, 'en'), integrationRequestKey(kind, { ...view, lng: 114.18 }, 'en'))
  }
  assert.equal(integrationRequestKey('kmb', view, 'en'), kmbCacheKey(view.lng, view.lat, view.zoom))
  assert.equal(integrationRequestKey('gmb', { ...view, zoom: 17 }, 'en'), kmbCacheKey(view.lng, view.lat, 17))
  assert.notEqual(integrationRequestKey('kmb', { ...view, zoom: 12.99 }, 'en'), integrationRequestKey('kmb', { ...view, zoom: 13 }, 'en'), 'zooming into coverage invalidates the gated empty result')
  assert.notEqual(integrationRequestKey('nlb', { ...view, lng: 114.0501, lat: 22.3 }, 'en'), integrationRequestKey('nlb', { ...view, lng: 114.05, lat: 22.3 }, 'en'), 'entering Lantau coverage invalidates the gated empty result')
})

test('a failed Citybus stop/route cools down while healthy arrival boards continue refreshing', async t => {
  let now = Date.now(), failedUrl = '', failing = true
  const calls = new Map<string, number>()
  t.mock.method(Date, 'now', () => now)
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)
    if (!failedUrl) failedUrl = url
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url === failedUrl && failing) return Response.json({ error: 'Gone' }, { status: 404 })
    return Response.json({ data: [], generated_timestamp: new Date(now).toISOString() })
  })
  const first = await loadCitybusNear(114.17, 22.32, now, 15)
  assert.equal(first.ok, true)
  assert.equal(first.stale, false)
  assert.equal(first.cacheable, false)
  assert.match(first.error ?? '', /Some Citybus arrivals/)
  assert.equal(calls.get(failedUrl), 1)
  const healthyUrl = [...calls.keys()].find(url => url !== failedUrl)!
  const healthyReads = calls.get(healthyUrl)!
  now += 5_001
  await loadCitybusNear(114.17, 22.32, now, 15)
  assert.equal(calls.get(failedUrl), 1)
  assert.ok(calls.get(healthyUrl)! > healthyReads)
  now += 25_000
  await loadCitybusNear(114.17, 22.32, now, 15)
  assert.equal(calls.get(failedUrl), 2)
  now += 30_001
  await loadCitybusNear(114.17, 22.32, now, 15)
  assert.equal(calls.get(failedUrl), 2, 'second failure waits 60 seconds')
  failing = false; now += 30_001
  const recovered = await loadCitybusNear(114.17, 22.32, now, 15)
  assert.equal(recovered.error, undefined)
  assert.equal(calls.get(failedUrl), 3)
  now += 5_001
  await loadCitybusNear(114.17, 22.32, now, 15)
  assert.equal(calls.get(failedUrl), 4, 'recovery restores the healthy stop cadence')
})

test('failed MTR Bus schedules share a per-route cooldown across consumers and recover', async t => {
  let now = Date.now(), calls = 0, failing = true
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (failing) return Response.json({ error: 'Unavailable' }, { status: 503 })
    return Response.json({ status: '1', routeName: 'K12', routeStatusTime: new Date(now).toISOString(), busStop: [], appRefreshTimeInSecond: '30' })
  })
  await assert.rejects(loadMtrBusRoute('K12', now))
  assert.equal(calls, 1)
  now += 5_001
  await assert.rejects(loadMtrBusRoute('K12', now))
  assert.equal(calls, 1)
  now += 25_000
  await assert.rejects(loadMtrBusRoute('K12', now))
  assert.equal(calls, 2)
  failing = false; now += 60_001
  const recovered = await loadMtrBusRoute('K12', now)
  assert.equal(recovered.stale, false)
  assert.equal(calls, 3)
})

test('a failed MTR Bus route does not classify healthy nearby routes as a total outage', async t => {
  const now = Date.now(), stop = mtrBusStops.find(stop => stop.route === 'K51')!
  let failedRoute = '', failedCalls = 0
  t.mock.method(globalThis, 'fetch', async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const { routeName } = JSON.parse(String(init?.body))
    if (!failedRoute) failedRoute = routeName
    if (routeName === failedRoute) { failedCalls++; return Response.json({ error: 'Unavailable' }, { status: 503 }) }
    return Response.json({ status: '1', routeName, routeStatusTime: new Date(now).toISOString(), busStop: [] })
  })
  const data = await loadMtrBusNear(stop.lng, stop.lat, now, 16)
  assert.equal(data.stale, false)
  assert.equal(data.complete, false)
  assert.equal(data.cacheable, false)
  assert.match(data.error ?? '', /\(1 of [2-8]\)/)
  await loadMtrBusNear(stop.lng, stop.lat, now + 5_000, 16)
  assert.equal(failedCalls, 1)
})
