import assert from 'node:assert/strict'
import test from 'node:test'
import { loadBusStopArrivals, type BusRouteSelection, type BusStopArrivalsResponse } from '../lib/bus-route.ts'
import { getBusStopArrivals } from '../lib/bus-route-client.ts'
import { GET } from '../app/api/bus-route/route.ts'

test('exact selected-stop arrivals preserve identity, source clocks and explicit empty/failure states', async () => {
  const originalFetch = globalThis.fetch
  const now = Date.now()
  const observed = new Date(now).toISOString()
  const eta = new Date(now + 120_000).toISOString()
  const calls: string[] = []
  const payloads = new Map<string, unknown>()
  const kmb: BusRouteSelection = { operator: 'kmb', company: 'KMB', route: '1', bound: 'O', serviceType: '1', stopId: 'EXACTKMB', stopSeq: 9 }
  const kmbRow = { route: '1', co: 'KMB', dir: 'O', service_type: 1, seq: 9, eta_seq: 1, eta, data_timestamp: observed, dest_tc: '終點', dest_en: 'Terminus' }
  payloads.set('/stop-eta/EXACTKMB', { data: [kmbRow, { ...kmbRow, eta_seq: 2, eta: null, rmk_en: 'Scheduled Bus' }, ...[
    { dir: 'I' }, { service_type: 2 }, { seq: 8 }, { route: '2' }, { co: 'LWB' },
  ].map((wrong) => ({ ...kmbRow, ...wrong }))] })
  payloads.set('/stop-eta/EXACTLWB', { data: [{ ...kmbRow, route: 'A31' }] })
  payloads.set('/eta/CTB/EXACTCTB/11', { data: [{ ...kmbRow, route: '11', dir: 'I' }, { ...kmbRow, route: '11', dir: 'O' }, { ...kmbRow, route: '11', dir: 'I', seq: 8 }] })
  payloads.set('/eta/route-stop/200001/2/9', { generated_timestamp: observed, data: { enabled: true, route_id: 200001, route_seq: 2, stop_seq: 9, eta: [{ timestamp: eta, remarks_tc: '未開出', remarks_en: 'Scheduled' }, { timestamp: eta, diff: 2 }] } })
  payloads.set('/eta/route-stop/200002/2/9', { generated_timestamp: observed, data: { enabled: true, route_id: 200002, route_seq: 1, stop_seq: 9, eta: [{ timestamp: eta }] } })
  payloads.set('routeId=900001&stopId=EXACTNLB', { estimatedArrivals: [
    { estimatedArrivalTime: '2026-10-09 12:03:00', generateTime: '2026-10-09 12:00:00', departed: '1', noGPS: '0' },
    { estimatedArrivalTime: '2026-10-09 12:04:00', generateTime: '2026-10-09 12:00:00', departed: '0', noGPS: '0' },
    { estimatedArrivalTime: '2026-10-09 12:05:00', generateTime: '2026-10-09 12:00:00', departed: '1', noGPS: '1' },
  ] })
  for (const [id, data] of [
    ['EMPTY', { generated_timestamp: observed, data: [] }],
    ['MALFORMED', { data: {} }],
    ['BADROW', { data: [null] }],
    ['BADIDENTITY', { data: [{}] }],
    ['STALE', { data: [{ ...kmbRow, data_timestamp: new Date(now - 180_000).toISOString() }] }],
    ['BADCLOCK', { data: [{ ...kmbRow, data_timestamp: 'invalid' }] }],
    ['FUTURECLOCK', { data: [{ ...kmbRow, data_timestamp: new Date(now + 60_000).toISOString() }] }],
  ] as const) payloads.set(`/stop-eta/${id}`, data)
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    const payload = [...payloads].find(([part]) => url.includes(part))?.[1]
    return payload ? Response.json(payload) : new Response('Unavailable', { status: 503 })
  }
  try {
    const data = await loadBusStopArrivals(kmb, now)
    assert.equal(data.ok, true)
    assert.equal(data.stale, false)
    assert.equal(data.arrivals.length, 2, 'Only the exact route, bound, service, company and sequence match')
    assert.equal(data.arrivals[0].destinationEn, 'Terminus')
    assert.equal(data.arrivals[0].eta, eta)
    assert.equal(data.arrivals[0].minutes, 2)
    assert.equal(data.arrivals[0].scheduled, false)
    assert.equal(data.arrivals[1].scheduled, true)
    assert.equal(data.arrivals[1].minutes, null)
    assert.deepEqual(data.arrivals[0].tracking, kmb)
    assert.equal((await loadBusStopArrivals({ ...kmb, company: 'LWB', route: 'A31', stopId: 'EXACTLWB' }, now)).arrivals.length, 1, 'Long Win retains its identity when the shared feed says KMB')
    const citybus = await loadBusStopArrivals({ operator: 'citybus', route: '11', bound: 'I', stopId: 'EXACTCTB', stopSeq: 9 }, now)
    assert.equal(citybus.arrivals.length, 1)
    const gmb: BusRouteSelection = { operator: 'gmb', route: '1', routeId: '200001', routeSeq: 2, stopId: 'EXACTGMB', stopSeq: 9 }
    const minibus = await loadBusStopArrivals(gmb, now)
    assert.equal(minibus.arrivals.length, 2)
    assert.deepEqual(minibus.arrivals.map((call) => call.scheduled), [true, false])
    assert.equal(minibus.observedAt, observed)
    assert.equal((await loadBusStopArrivals({ ...gmb, routeId: '200002' }, now)).ok, false, 'Mismatched route direction metadata is rejected')
    const nlbNow = Date.parse('2026-10-09T04:00:00Z')
    const nlb = await loadBusStopArrivals({ operator: 'nlb', route: 'B2', routeId: '900001', stopId: 'EXACTNLB', stopSeq: 9 }, nlbNow)
    assert.equal(nlb.arrivals.length, 3)
    assert.equal(nlb.arrivals[0].eta, '2026-10-09T04:03:00.000Z')
    assert.equal(nlb.observedAt, '2026-10-09T04:00:00.000Z')
    assert.deepEqual(nlb.arrivals.map((call) => call.scheduled), [false, true, true])
    assert.equal(nlb.stale, false)
    const empty = await loadBusStopArrivals({ ...kmb, stopId: 'EMPTY' }, now)
    assert.deepEqual(empty, { ok: true, arrivals: [], observedAt: observed, stale: false })
    for (const stopId of ['MALFORMED', 'BADROW', 'BADIDENTITY', 'OUTAGE']) {
      const failure = await loadBusStopArrivals({ ...kmb, stopId }, now)
      assert.equal(failure.ok, false)
      assert.equal(failure.stale, true)
      assert.ok(failure.error)
    }
    for (const stopId of ['STALE', 'BADCLOCK', 'FUTURECLOCK']) {
      const stale = await loadBusStopArrivals({ ...kmb, stopId }, now)
      assert.equal(stale.stale, true, 'A fresh transport fetch cannot freshen an old/invalid source clock')
      assert.notEqual(stale.observedAt, observed)
    }
    const before = calls.length
    assert.equal((await loadBusStopArrivals({ ...gmb, stopSeq: undefined }, now)).ok, false)
    assert.equal((await loadBusStopArrivals({ ...kmb, stopId: '../invalid' }, now)).ok, false)
    assert.equal(calls.length, before, 'Invalid exact stop selections never request upstream data')
    assert.equal((await GET(new Request('https://test/api/bus-route?stopArrivals=1&operator=gmb&route=1&routeId=200001&routeSeq=2&stopId=EXACTGMB'))).status, 400)
    const query = new URLSearchParams(Object.entries(kmb).map(([key, value]) => [key, String(value)]))
    query.set('stopArrivals', '1')
    const hosted = await (await GET(new Request(`https://test/api/bus-route?${query}`))).json() as BusStopArrivalsResponse
    assert.equal(hosted.arrivals.length, 2)
    assert.equal('route' in hosted, false)
    const tracking = hosted.arrivals[0].tracking
    assert.ok(tracking)
    assert.equal('stopArrivals' in tracking, false)
    assert.ok(calls.every((url) => /\/stop-eta\/|\/eta\/CTB\/|\/eta\/route-stop\/|action=estimatedArrivals/.test(url)), 'Exact arrivals never request catalogues or route geometry')
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(getBusStopArrivals(kmb, controller.signal), { name: 'AbortError' })
    assert.equal(calls.length, before)
  } finally {
    globalThis.fetch = originalFetch
  }
})
