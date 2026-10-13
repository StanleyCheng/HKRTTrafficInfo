import { kmbStop } from './kmb-network.ts'
import { citybusStop } from './citybus-network.ts'
import { gmbStop } from './gmb-reach.ts'
import { nlbRouteIds, nlbStop } from './nlb-network.ts'
 import { nlbArrivalMs } from './nlb-clock.ts'
 import { fetchUpstream } from './upstream.ts'
 import { etaQueue, ETA_REFRESH_TIMEOUT_MS } from './polite-fetch.ts'
 import { arrivalRows, arrivalSnapshot, ETA_FRESH_MS } from './place-arrivals.ts'
 import { pool } from './pool.ts'
import { waitForRequest } from './request-wait.ts'
import { busVehicleDistanceAtTime, routeDistances } from './bus-route-motion.ts'
import { busRoadGeometry } from './bus-route-geometry.ts'
import { busCompany } from './bus-company.ts'
import type { Arrival } from './traffic.ts'

export type BusRouteSelection = {
  operator: 'kmb' | 'citybus' | 'gmb' | 'nlb'
  company?: 'KMB' | 'LWB'
  route: string
  stopId: string
  bound?: 'I' | 'O'
  serviceType?: string
  routeId?: string
  routeSeq?: number
  stopSeq?: number
}
export type BusRouteStop = { id: string; seq: number; nameTc: string; nameEn: string; lng: number; lat: number; distance: number }
export type BusRouteData = { key: string; operator: BusRouteSelection['operator']; company?: string; route: string; stops: BusRouteStop[]; coordinates: [number, number][]; geometry: 'road' | 'stops' }
export type BusVehicle = { id: string; fromDistance: number; toDistance: number; departureAt: number; arrivalAt: number; validUntil: number }
export type BusRouteDirection = { route: BusRouteData; vehicles: BusVehicle[] }
export type BusRouteResponse = {
  ok: boolean
  error?: string
  route?: BusRouteData
  vehicles: BusVehicle[]
  reverse: BusRouteDirection[]
  observedAt: string | null
  stale: boolean
}
export type BusStopArrivalsResponse = { ok: boolean; arrivals: Arrival[]; observedAt: string | null; stale: boolean; error?: string }
export type BusEta = { seq: number; rank: number; at: number; observed: number; scheduled: boolean }
type Row = Record<string, unknown>
const DAY = 86_400_000
const FRESH = 180_000
const KMB = 'https://data.etabus.gov.hk/v1/transport/kmb'
const CTB = 'https://rt.data.gov.hk/v2/transport/citybus'
const GMB = 'https://data.etagmb.gov.hk'
const NLB = 'https://rt.data.gov.hk/v2/transport/nlb/stop.php'
const array = (value: unknown): Row[] => Array.isArray(value) ? value.filter((row): row is Row => !!row && typeof row === 'object') : []
const record = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {}
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const scheduled = (row: Row) => /scheduled|未開出|原定班次/i.test(`${row.rmk_en ?? ''} ${row.rmk_tc ?? ''} ${row.remarks_en ?? ''} ${row.remarks_tc ?? ''}`)
// The KMB stop list embeds the pole code in every stop name, e.g. "書院道 (KC550)".
// Route labels show the station name only; parenthetical place notes such as
// "(落客站)" or "(西翼)" never match the code shape and are kept.
const kmbStopName = (name: string) => name.replace(/\s*\([A-Z]{2}\d{3,4}[A-Za-z]?\)$/, '').trim() || name

function routeArrivalRows(value: unknown): Row[] {
  const rows = arrivalRows<Row>(value)
  if (!rows) throw new Error('Bus route arrival data unavailable')
  return rows
}

function routeObservedAt(fetched: number, published: unknown[]): number {
  const clock = arrivalSnapshot([], new Date(fetched).toISOString(), published)
  if (!clock) throw new Error('Bus route observation clock unavailable')
  return clock.at
}

export function validBusSelection(value: BusRouteSelection, requireStopSeq = false): boolean {
  if (!value || !['kmb', 'citybus', 'gmb', 'nlb'].includes(value.operator) || !/^[A-Za-z0-9-]{1,12}$/.test(value.route) || !/^[A-Za-z0-9]{1,20}$/.test(value.stopId)) return false
  if (requireStopSeq && value.stopSeq == null) return false
  if (value.stopSeq != null && (!Number.isInteger(value.stopSeq) || value.stopSeq < 1 || value.stopSeq > 200)) return false
  if (value.operator === 'kmb') return (value.bound === 'I' || value.bound === 'O') && /^\d{1,3}$/.test(value.serviceType ?? '') && (!value.company || ['KMB', 'LWB'].includes(value.company))
  if (value.operator === 'citybus') return value.bound === 'I' || value.bound === 'O'
  return /^\d{1,10}$/.test(value.routeId ?? '') && (value.operator !== 'gmb' || value.routeSeq === 1 || value.routeSeq === 2)
}

async function json(url: string, ttl = DAY, signal = AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS)): Promise<{ body: Row; fetched: number }> {
  const response = await etaQueue(() => fetchUpstream(url, ttl, { timeoutMs: 8_000, signal, headers: { Accept: 'application/json' } }), signal)
  if (response.status !== 200) throw new Error('Bus route feed unavailable')
  return { body: record(JSON.parse(new TextDecoder().decode(response.body))), fetched: Date.parse(response.fetchedAt) }
}

export async function loadBusStopArrivals(selection: BusRouteSelection, now = Date.now()): Promise<BusStopArrivalsResponse> {
  if (!validBusSelection(selection, selection?.operator === 'gmb')) return { ok: false, error: 'Invalid bus stop selection', arrivals: [], observedAt: null, stale: false }
  try {
    const { operator, stopId, route, routeId, routeSeq, stopSeq } = selection
    const url = operator === 'kmb' ? `${KMB}/stop-eta/${stopId}`
      : operator === 'citybus' ? `${CTB}/eta/CTB/${stopId}/${route}`
        : operator === 'gmb' ? `${GMB}/eta/route-stop/${routeId}/${routeSeq}/${stopSeq}`
          : `${NLB}?action=estimatedArrivals&routeId=${routeId}&stopId=${stopId}&lang=en`
    const { body, fetched } = await json(url, ETA_FRESH_MS, AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS))
    const data = operator === 'gmb' ? record(body.data) : body
    const published = operator === 'nlb' ? data.estimatedArrivals : operator === 'gmb' ? data.eta : body.data
    if (!Array.isArray(published) || published.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Stop arrival data unavailable')
    if ((operator === 'kmb' || operator === 'citybus') && array(published).some((row) => !text(row.route) || !['I', 'O'].includes(text(row.dir)) || (operator === 'kmb' && !/^\d{1,3}$/.test(text(row.service_type))))) throw new Error('Stop arrival data unavailable')
    if (operator === 'gmb' && ((data.route_id != null && String(data.route_id) !== routeId) || (data.route_seq != null && Number(data.route_seq) !== routeSeq) || (data.stop_seq != null && Number(data.stop_seq) !== stopSeq))) throw new Error('Stop arrival data does not match selection')
    const rows = array(published).filter((row) => {
      if (operator === 'gmb') return data.enabled !== false
      if (operator === 'nlb') return true
      return text(row.route) === route && row.dir === selection.bound && (stopSeq == null || Number(row.seq) === stopSeq)
        && (operator !== 'kmb' || String(row.service_type) === selection.serviceType && (!selection.company || busCompany(route, text(row.co)) === selection.company))
    })
    const clocks: number[] = []
    const arrivals = rows.map((row): Arrival => {
      const eta = operator === 'nlb' ? nlbArrivalMs(text(row.estimatedArrivalTime)) : Date.parse(text(operator === 'gmb' ? row.timestamp : row.eta))
      const sourceTime = operator === 'nlb' ? row.generateTime ?? body.generateTime : row.data_timestamp ?? body.generated_timestamp
      const observed = sourceTime == null || sourceTime === '' ? fetched : operator === 'nlb' ? nlbArrivalMs(text(sourceTime)) : Date.parse(text(sourceTime))
      clocks.push(observed)
      return {
        route, tracking: selection,
        destination: text(row.dest_tc ?? data.dest_tc), destinationEn: text(row.dest_en ?? data.dest_en),
        eta: Number.isFinite(eta) ? new Date(eta).toISOString() : undefined,
        minutes: Number.isFinite(eta) ? Math.max(0, Math.ceil((eta - now) / 60_000)) : operator === 'gmb' && typeof row.diff === 'number' && Number.isFinite(row.diff) ? Math.max(0, row.diff) : null,
        observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : undefined,
        scheduled: operator === 'nlb' ? String(row.departed) !== '1' || String(row.noGPS) !== '0' : scheduled(row),
        remark: text(row.rmk_tc ?? row.remarks_tc), remarkEn: text(row.rmk_en ?? row.remarks_en),
      }
    }).sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))
    if (!clocks.length) {
      const sourceTime = operator === 'nlb' ? body.generateTime : body.generated_timestamp
      clocks.push(sourceTime == null || sourceTime === '' ? fetched : operator === 'nlb' ? nlbArrivalMs(text(sourceTime)) : Date.parse(text(sourceTime)))
    }
    const observed = Math.min(...clocks)
    return { ok: true, arrivals, observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : null, stale: clocks.some((clock) => !Number.isFinite(clock) || now - clock >= FRESH || clock > now + 30_000) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Stop arrivals unavailable', arrivals: [], observedAt: null, stale: true }
  }
}

async function routeStops(selection: BusRouteSelection, requireSelectedStop: boolean, signal: AbortSignal): Promise<BusRouteStop[]> {
  const { operator, route, bound, routeId, routeSeq, serviceType } = selection
  const direction = bound === 'I' ? 'inbound' : 'outbound'
  const url = operator === 'kmb' ? `${KMB}/route-stop/${route}/${direction}/${serviceType}`
    : operator === 'citybus' ? `${CTB}/route-stop/CTB/${route}/${direction}`
      : operator === 'gmb' ? `${GMB}/route-stop/${routeId}/${routeSeq}`
        : `${NLB}?action=list&routeId=${routeId}`
  const { body } = await json(url, DAY, signal)
  const rows = array(operator === 'gmb' ? record(body.data).route_stops : operator === 'nlb' ? body.stops : body.data)
  if (rows.length < 2 || rows.length > 200) throw new Error('Complete bus route unavailable')
  const stops: BusRouteStop[] = []
  await pool(rows, 4, async (row) => {
    const id = text(operator === 'gmb' ? row.stop_id : operator === 'nlb' ? row.stopId : row.stop)
    const seq = Number(operator === 'gmb' ? row.stop_seq : operator === 'nlb' ? rows.indexOf(row) + 1 : row.seq)
    let place = { kmb: kmbStop, citybus: citybusStop, gmb: gmbStop, nlb: nlbStop }[operator](id)
    if (!place && operator !== 'nlb') {
      const stopUrl = operator === 'kmb' ? `${KMB}/stop/${id}` : operator === 'citybus' ? `${CTB}/stop/${id}` : `${GMB}/stop/${id}`
      const data = record((await json(stopUrl, DAY, signal)).body.data)
      const point = operator === 'gmb' ? record(record(data.coordinates).wgs84) : data
      place = { tc: text(data.name_tc ?? row.name_tc), en: text(data.name_en ?? row.name_en), lng: Number(point.long ?? point.longitude), lat: Number(point.lat ?? point.latitude) }
    }
    const lng = operator === 'nlb' ? Number(row.longitude) : place?.lng
    const lat = operator === 'nlb' ? Number(row.latitude) : place?.lat
    if (!Number.isInteger(seq) || !Number.isFinite(lng) || !Number.isFinite(lat) || lng! < 113 || lng! > 115 || lat! < 22 || lat! > 23) throw new Error('Bus route contains incomplete stops')
    const nameTc = text(row.stopName_c ?? row.name_tc ?? place?.tc)
    const nameEn = text(row.stopName_e ?? row.name_en ?? place?.en)
    stops.push({ id, seq, lng: lng!, lat: lat!, nameTc: operator === 'kmb' ? kmbStopName(nameTc) : nameTc, nameEn: operator === 'kmb' ? kmbStopName(nameEn) : nameEn, distance: 0 })
  })
  stops.sort((a, b) => a.seq - b.seq)
  if (stops.some((stop, index) => stop.seq !== index + 1)) throw new Error('Bus route stop sequence is incomplete')
  // Reverse-bound loads carry the forward selection's stop id; only the
  // rider's own bound must contain it.
  if (requireSelectedStop && !stops.some((stop) => stop.id === selection.stopId && (selection.stopSeq == null || stop.seq === selection.stopSeq))) throw new Error('Selected stop does not match this route')
  return stops
}

async function routeEtas(selection: BusRouteSelection, stops: BusRouteStop[], signal: AbortSignal): Promise<BusEta[]> {
  if (selection.operator === 'kmb') {
    const { body, fetched } = await json(`${KMB}/route-eta/${selection.route}/${selection.serviceType}`, ETA_FRESH_MS, signal)
    routeObservedAt(fetched, [body.generated_timestamp])
    return routeArrivalRows(body.data).filter((row) => row.dir === selection.bound && String(row.service_type) === selection.serviceType && Number(row.eta_seq) >= 1 && Number(row.eta_seq) <= 3).map((row) => ({ seq: Number(row.seq), rank: Number(row.eta_seq), at: Date.parse(text(row.eta)), observed: routeObservedAt(fetched, [body.generated_timestamp, row.data_timestamp]), scheduled: scheduled(row) }))
  }
  // The whole-route fleet view back-projects every published bus, so every
  // stop is sampled at every published rank (KMB alone has a route-level
  // feed). The shared ETA cache bounds upstream traffic: the 30-second map
  // refresh re-reads a stop at most once per freshness window.
  const etas: BusEta[] = []
  await pool(stops, 6, async (stop) => {
    const url = selection.operator === 'citybus' ? `${CTB}/eta/CTB/${stop.id}/${selection.route}`
      : selection.operator === 'gmb' ? `${GMB}/eta/route-stop/${selection.routeId}/${selection.routeSeq}/${stop.seq}`
        : `${NLB}?action=estimatedArrivals&routeId=${selection.routeId}&stopId=${stop.id}&lang=en`
    const { body, fetched } = await json(url, ETA_FRESH_MS, signal)
    if (selection.operator === 'nlb') {
      routeObservedAt(fetched, [body.generateTime])
      const row = routeArrivalRows(body.estimatedArrivals)[0]
      if (row) etas.push({ seq: stop.seq, rank: 1, at: nlbArrivalMs(text(row.estimatedArrivalTime)), observed: routeObservedAt(fetched, [body.generateTime, row.generateTime]), scheduled: String(row.departed) !== '1' || String(row.noGPS) !== '0' })
    } else if (selection.operator === 'gmb') {
      const data = record(body.data)
      if (data.enabled === false) return
      const observed = routeObservedAt(fetched, [body.generated_timestamp])
      routeArrivalRows(data.eta).forEach((row, index) => {
        const at = Date.parse(text(row.timestamp))
        if (Number.isFinite(at)) etas.push({ seq: stop.seq, rank: Number(row.eta_seq) || index + 1, at, observed, scheduled: scheduled(row) })
      })
    } else {
      routeObservedAt(fetched, [body.generated_timestamp])
      routeArrivalRows(body.data).filter((item) => item.dir === selection.bound && Number(item.seq) === stop.seq && Number(item.eta_seq) >= 1 && Number(item.eta_seq) <= 3).forEach((row) => {
        const at = Date.parse(text(row.eta))
        if (Number.isFinite(at)) etas.push({ seq: stop.seq, rank: Number(row.eta_seq), at, observed: routeObservedAt(fetched, [body.generated_timestamp, row.data_timestamp]), scheduled: scheduled(row) })
      })
    }
  })
  return etas
}

// Timetable (scheduled) rows anchor the estimate just like GPS ones: without
// vehicle IDs any fresh arrival estimate is the best position evidence there
// is. Buses do not overtake, so within one ETA rank the ordered stops chain
// into a single bus progressing along the route; the bracketing pair of
// arrivals pins its current segment, and before the first observed arrival the
// bus back-projects a cruise from the route origin. A rank chain that breaks
// in space or time means the feed's rank shifted (list truncation) and a new
// bus starts there.
// ponytail: ETAs carry no vehicle IDs; a rank shift can still describe one bus
// twice, so near-coincident positions collapse. A GPS vehicle feed would
// replace this heuristic.
export function inferBusVehicles(stops: BusRouteStop[], etas: BusEta[], now: number, idPrefix: string): BusVehicle[] {
  const bySeq = new Map(stops.map((stop) => [stop.seq, stop]));
  // Fresh observations only; arrival times may be past — a bus the feed still
  // lists has already reached that stop, which anchors the chain behind `now`.
  const byEntry = new Map<string, BusEta>();
  for (const eta of etas.filter((eta) => Number.isFinite(eta.at) && Number.isFinite(eta.observed) && now - eta.observed < FRESH && eta.observed <= now + 30_000)) {
    const key = `${eta.seq}:${eta.rank}`;
    const existing = byEntry.get(key);
    if (!existing || eta.at < existing.at) byEntry.set(key, eta);
  }
  const byRank = new Map<number, BusEta[]>();
  for (const eta of byEntry.values()) {
    const list = byRank.get(eta.rank) ?? [];
    list.push(eta);
    byRank.set(eta.rank, list);
  }
  const vehicles: BusVehicle[] = [];
  for (const [rank, entries] of byRank) {
    entries.sort((a, b) => a.seq - b.seq);
    let chain: BusEta[] = [];
    const flush = () => {
      if (!chain.length) return;
      const vehicle = vehicleFromChain(chain, bySeq, now, `${idPrefix}:${rank}:${chain[0]!.seq}`);
      if (vehicle) vehicles.push(vehicle);
      chain = [];
    };
    for (const eta of entries) {
      const stop = bySeq.get(eta.seq);
      if (!stop || !(stop.distance >= 0)) continue;
      const previous = chain.at(-1);
      const previousStop = previous ? bySeq.get(previous.seq) : undefined;
      if (previous && previousStop && (stop.distance <= previousStop.distance || eta.at <= previous.at)) flush();
      chain.push(eta);
    }
    flush();
  }
  const kept: { vehicle: BusVehicle; position: number }[] = [];
  for (const vehicle of vehicles.sort((a, b) => a.departureAt - b.departureAt)) {
    const position = busVehicleDistanceAtTime(vehicle, now) ?? 0;
    // Two buses still holding at the origin are distinct when their departures
    // differ; once underway, near-coincident positions collapse.
    const duplicate = kept.some((entry) => now < vehicle.departureAt && now < entry.vehicle.departureAt
      ? Math.abs(entry.vehicle.departureAt - vehicle.departureAt) < 120_000
      : Math.abs(entry.position - position) < 200);
    if (!duplicate) kept.push({ vehicle, position });
  }
  return kept.map((entry) => entry.vehicle);
}

function vehicleFromChain(chain: BusEta[], bySeq: Map<number, BusRouteStop>, now: number, id: string): BusVehicle | null {
  const first = chain[0]!, last = chain.at(-1)!;
  const firstStop = bySeq.get(first.seq)!, lastStop = bySeq.get(last.seq)!;
  const validUntil = chain.reduce((latest, eta) => Math.max(latest, eta.observed), 0) + FRESH;
  if (now >= last.at) {
    // The bus reached the last observed stop; it holds there until the feed
    // refreshes, carried by its final segment.
    if (chain.length < 2 || now >= validUntil) return null;
    const from = chain.at(-2)!, fromStop = bySeq.get(from.seq)!;
    const pace = (lastStop.distance - fromStop.distance) / ((last.at - from.at) / 1000);
    if (!Number.isFinite(pace) || pace < 0.5 || pace > 25) return null;
    return { id, fromDistance: fromStop.distance, toDistance: lastStop.distance, departureAt: from.at, arrivalAt: last.at, validUntil };
  }
  if (now < first.at) {
    if (firstStop.distance <= 0) {
      // The chain anchors at the origin: the first pair is the departure leg,
      // with the first-stop ETA as the real departure bracket.
      if (chain.length < 2) return null;
      const second = chain[1]!, secondStop = bySeq.get(second.seq)!;
      if (secondStop.distance <= 0 || second.at <= first.at) return null;
      const pace = secondStop.distance / ((second.at - first.at) / 1000);
      if (!Number.isFinite(pace) || pace < 0.5 || pace > 25) return null;
      return { id, fromDistance: 0, toDistance: secondStop.distance, departureAt: first.at, arrivalAt: second.at, validUntil };
    }
    // Back-project a cruise from the origin, paced by the chain's first pair
    // when there is one.
    const pair = chain.length > 1 ? bySeq.get(chain[1]!.seq) : undefined;
    const speed = pair && pair.distance > firstStop.distance && chain[1]!.at > first.at ? (pair.distance - firstStop.distance) / ((chain[1]!.at - first.at) / 1000) : 6;
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 25) return null;
    const cruiseMs = (firstStop.distance / speed) * 1000;
    return { id, fromDistance: 0, toDistance: firstStop.distance, departureAt: first.at - cruiseMs, arrivalAt: first.at, validUntil };
  }
  // Inside the chain: the bracketing pair of arrivals pins the current segment.
  for (let index = 0; index < chain.length - 1; index += 1) {
    const from = chain[index]!, to = chain[index + 1]!;
    if (from.at > now || now >= to.at) continue;
    const fromStop = bySeq.get(from.seq)!, toStop = bySeq.get(to.seq)!;
    const pace = (toStop.distance - fromStop.distance) / ((to.at - from.at) / 1000);
    if (!Number.isFinite(pace) || pace < 0.5 || pace > 25) return null;
    return { id, fromDistance: fromStop.distance, toDistance: toStop.distance, departureAt: from.at, arrivalAt: to.at, validUntil };
  }
  return null;
}

type DirectionLoad = { route: BusRouteData; vehicles: BusVehicle[]; observed: number; failed: boolean }

async function loadDirection(selection: BusRouteSelection, now: number, requireSelectedStop: boolean, signal: AbortSignal): Promise<DirectionLoad> {
  const stops = await routeStops(selection, requireSelectedStop, signal)
  const key = [selection.operator, selection.route, selection.bound, selection.serviceType, selection.routeId, selection.routeSeq].join(':')
  const [road, etaResult] = await Promise.all([waitForRequest(busRoadGeometry(selection, stops), signal).catch(() => null), routeEtas(selection, stops, signal).then((etas) => ({ etas, failed: false })).catch(() => ({ etas: [] as BusEta[], failed: true }))])
  const coordinates: [number, number][] = road?.coordinates ?? stops.map((stop) => [stop.lng, stop.lat])
  const distances = road?.stopDistances ?? routeDistances(coordinates)
  stops.forEach((stop, index) => { stop.distance = distances[index] })
  const route: BusRouteData = { key, operator: selection.operator, company: selection.company, route: selection.route, stops, coordinates, geometry: road ? 'road' : 'stops' }
  return {
    route,
    vehicles: inferBusVehicles(stops, etaResult.etas, now, key),
    observed: Math.max(0, ...etaResult.etas.map((eta) => Number.isFinite(eta.observed) ? eta.observed : 0)),
    failed: etaResult.failed,
  }
}

// The opposite bound of the same signed service. NLB signs one routeId per
// direction and variant, so every other id behind the same route code runs.
function reverseSelections(selection: BusRouteSelection): BusRouteSelection[] {
  if (selection.operator === 'kmb' || selection.operator === 'citybus') return [{ ...selection, bound: selection.bound === 'I' ? 'O' : 'I', stopSeq: undefined }]
  if (selection.operator === 'gmb') return [{ ...selection, routeSeq: selection.routeSeq === 1 ? 2 : 1, stopSeq: undefined }]
  return nlbRouteIds(selection.route).filter((routeId) => routeId !== selection.routeId).map((routeId) => ({ ...selection, routeId, stopSeq: undefined }))
}

export async function loadBusRoute(selection: BusRouteSelection, now = Date.now()): Promise<BusRouteResponse> {
  if (!validBusSelection(selection)) return { ok: false, error: 'Invalid bus route selection', vehicles: [], reverse: [], observedAt: null, stale: false }
  try {
    const signal = AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS)
    const [forward, ...reverseLoads] = await Promise.all([loadDirection(selection, now, true, signal), ...reverseSelections(selection).map((reverse) => loadDirection(reverse, now, false, signal).catch(() => null))])
    const observed = Math.max(0, forward.observed, ...reverseLoads.flatMap((load) => (load ? [load.observed] : [])))
    // Staleness follows the rider's own bound; a reverse bound that fails to
    // load simply drops out of the view.
    const stale = forward.failed || (forward.observed > 0 && now - forward.observed >= FRESH)
    const keep = (load: DirectionLoad): BusRouteDirection => ({ route: load.route, vehicles: stale ? [] : load.vehicles })
    return {
      ok: true,
      route: forward.route,
      vehicles: stale ? [] : forward.vehicles,
      reverse: reverseLoads.filter((load): load is DirectionLoad => Boolean(load)).map(keep),
      observedAt: observed ? new Date(observed).toISOString() : null,
      stale,
      ...(forward.failed ? { error: 'Arrival estimates could not refresh' } : {}),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Bus route unavailable', vehicles: [], reverse: [], observedAt: null, stale: false }
  }
}
