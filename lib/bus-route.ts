import { validBusSelection } from './bus-selection.ts'
import { kmbStop } from './kmb-network.ts'
import { citybusStop } from './citybus-network.ts'
import { gmbStop } from './gmb-reach.ts'
import { nlbRouteIds, nlbStop } from './nlb-network.ts'
 import { nlbArrivalMs } from './nlb-clock.ts'
 import { fetchUpstream } from './upstream.ts'
 import { etaQueue, ETA_REFRESH_TIMEOUT_MS } from './polite-fetch.ts'
 import { arrivalRows, arrivalSnapshot, ETA_FRESH_MS, type ArrivalRowKind } from './place-arrivals.ts'
 import { pool } from './pool.ts'
import { waitForRequest } from './request-wait.ts'
import { routeDistances } from './bus-route-motion.ts'
import { busRoadGeometry } from './bus-route-geometry.ts'
import { busCompany } from './bus-company.ts'
import type { Arrival } from './traffic.ts'
import type { BusPathRequest } from './transport-routes.ts'

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
export type BusVehicle = { id: string; fromDistance: number; toDistance: number; departureAt: number; arrivalAt: number; validUntil: number; timeline?: { distance: number; at: number }[] }
export type BusRouteDirection = { route: BusRouteData; vehicles: BusVehicle[]; stale?: boolean }
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

function routeArrivalRows(value: unknown, kind: ArrivalRowKind): Row[] {
  const rows = arrivalRows<Row>(value, kind)
  if (!rows) throw new Error('Bus route arrival data unavailable')
  return rows
}

function routeObservedAt(fetched: number, published: unknown[]): number {
  const clock = arrivalSnapshot([], new Date(fetched).toISOString(), published)
  if (!clock) throw new Error('Bus route observation clock unavailable')
  return clock.at
}

export { validBusSelection } from './bus-selection.ts'

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

type RouteEtas = { etas: BusEta[]; failed: boolean }

async function routeEtas(selection: BusRouteSelection, stops: BusRouteStop[], signal: AbortSignal): Promise<RouteEtas> {
  const result: RouteEtas = { etas: [], failed: false }
  const add = (read: () => BusEta) => {
    try { result.etas.push(read()) } catch { result.failed = true }
  }
  if (selection.operator === 'kmb') {
    const { body, fetched } = await json(`${KMB}/route-eta/${selection.route}/${selection.serviceType}`, ETA_FRESH_MS, signal)
    routeObservedAt(fetched, [body.generated_timestamp])
    routeArrivalRows(body.data, 'bus').filter((row) => row.dir === selection.bound && String(row.service_type) === selection.serviceType && Number(row.eta_seq) >= 1 && Number(row.eta_seq) <= 3).forEach((row) => add(() => ({ seq: Number(row.seq), rank: Number(row.eta_seq), at: Date.parse(text(row.eta)), observed: routeObservedAt(fetched, [body.generated_timestamp, row.data_timestamp]), scheduled: scheduled(row) })))
    return result
  }
  // The whole-route fleet view back-projects every published bus, so every
  // stop is sampled at every published rank (KMB alone has a route-level
  // feed). The shared ETA cache bounds upstream traffic: the 30-second map
  // refresh re-reads a stop at most once per freshness window.
  await pool(stops, 6, async (stop) => {
    try {
      const url = selection.operator === 'citybus' ? `${CTB}/eta/CTB/${stop.id}/${selection.route}`
        : selection.operator === 'gmb' ? `${GMB}/eta/route-stop/${selection.routeId}/${selection.routeSeq}/${stop.seq}`
          : `${NLB}?action=estimatedArrivals&routeId=${selection.routeId}&stopId=${stop.id}&lang=en`
      const { body, fetched } = await json(url, ETA_FRESH_MS, signal)
      if (selection.operator === 'nlb') {
        routeObservedAt(fetched, [body.generateTime])
        routeArrivalRows(body.estimatedArrivals, 'nlb').forEach((row, index) => add(() => ({ seq: stop.seq, rank: index + 1, at: nlbArrivalMs(text(row.estimatedArrivalTime)), observed: routeObservedAt(fetched, [body.generateTime, row.generateTime]), scheduled: String(row.departed) !== '1' || String(row.noGPS) !== '0' })))
      } else if (selection.operator === 'gmb') {
        const data = record(body.data)
        if (data.enabled === false) return
        const observed = routeObservedAt(fetched, [body.generated_timestamp])
        routeArrivalRows(data.eta, 'gmb-eta').forEach((row, index) => {
          const at = Date.parse(text(row.timestamp))
          if (Number.isFinite(at)) add(() => ({ seq: stop.seq, rank: Number(row.eta_seq) || index + 1, at, observed, scheduled: scheduled(row) }))
        })
      } else {
        routeObservedAt(fetched, [body.generated_timestamp])
        routeArrivalRows(body.data, 'bus').filter((item) => item.dir === selection.bound && Number(item.seq) === stop.seq && Number(item.eta_seq) >= 1 && Number(item.eta_seq) <= 3).forEach((row) => {
          const at = Date.parse(text(row.eta))
          if (Number.isFinite(at)) add(() => ({ seq: stop.seq, rank: Number(row.eta_seq), at, observed: routeObservedAt(fetched, [body.generated_timestamp, row.data_timestamp]), scheduled: scheduled(row) }))
        })
      }
    } catch { result.failed = true }
  })
  return result
}

// ETA rank is local to a stop, not a vehicle ID. Once a bus passes a stop,
// its following bus becomes rank 1 there while remaining rank 2 downstream.
// Match successive boards in arrival order, allowing ranks to shift. Keep
// timetable and live rows separate and reject physically impossible links.
// These chains remain estimates: the feeds publish neither bus GPS nor IDs.
export function inferBusVehicles(stops: BusRouteStop[], etas: BusEta[], now: number, idPrefix: string): BusVehicle[] {
  if (!Number.isFinite(now)) return [];
  const bySeq = new Map(stops.map((stop) => [stop.seq, stop]));
  const byEntry = new Map<string, BusEta>();
  for (const eta of etas) {
    if (!Number.isFinite(eta.at) || !Number.isFinite(eta.observed) || now - eta.observed >= FRESH || eta.observed > now + 30_000
      || !Number.isInteger(eta.rank) || eta.rank < 1 || !Number.isFinite(bySeq.get(eta.seq)?.distance) || bySeq.get(eta.seq)!.distance < 0) continue;
    const key = `${eta.seq}:${eta.rank}`;
    const existing = byEntry.get(key);
    if (!existing || eta.observed > existing.observed) byEntry.set(key, eta);
  }
  const boards = new Map<number, BusEta[]>();
  for (const eta of byEntry.values()) {
    const board = boards.get(eta.seq) ?? [];
    board.push(eta);
    boards.set(eta.seq, board);
  }
  type Chain = { rows: BusEta[]; startDistance: number };
  const chains: Chain[] = [];
  let previous: Chain[] = [];
  for (const [seq, board] of [...boards].sort(([a], [b]) => a - b)) {
    board.sort((a, b) => a.at - b.at || a.rank - b.rank);
    const current: Chain[] = [];
    let cursor = 0;
    for (const eta of board) {
      const stop = bySeq.get(seq)!;
      const index = previous.findIndex((chain, index) => {
        if (index < cursor) return false;
        const last = chain.rows.at(-1)!;
        const distance = stop.distance - bySeq.get(last.seq)!.distance;
        const seconds = (eta.at - last.at) / 1000;
        // Slow traffic is legitimate. A lower speed threshold used to remove
        // every bus in congestion; only non-forward/impossible links fail.
        return eta.scheduled === last.scheduled && distance > 0 && seconds > 0 && distance / seconds <= 25;
      });
      if (index !== -1) {
        const chain = previous[index];
        cursor = index + 1;
        chain.rows.push(eta);
        current.push(chain);
      } else {
        const inconsistent = previous.findIndex((chain, index) => {
          const last = chain.rows.at(-1)!;
          return index >= cursor && last.rank === eta.rank && last.scheduled === eta.scheduled && eta.at >= last.at;
        });
        if (inconsistent !== -1) {
          // Rounded/equal or impossibly close ETAs cannot establish another
          // bus. Skip this anchor and keep the preceding evidence available.
          current.push(previous[inconsistent]);
          cursor = inconsistent + 1;
          continue;
        }
        // A new earlier arrival at the immediately downstream stop indicates
        // a bus has passed the previous stop. Never project it back through
        // that stop (possibly kilometres toward the origin).
        const preceding = boards.get(seq - 1);
        const passed = preceding?.length && preceding.every(row => row.at > eta.at);
        const chain = { rows: [eta], startDistance: passed ? bySeq.get(seq - 1)!.distance : 0 };
        chains.push(chain);
        current.push(chain);
      }
    }
    previous = current;
  }
  // Each arrival is consumed once. Nearby buses may be bunched together, so
  // geographical proximity alone must not collapse separate services.
  return chains.flatMap(chain => {
    const first = chain.rows[0];
    const vehicle = vehicleFromChain(chain.rows, bySeq, chain.startDistance, now, `${idPrefix}:${first.rank}:${first.seq}`);
    return vehicle ? [vehicle] : [];
  });
}

function vehicleFromChain(chain: BusEta[], bySeq: Map<number, BusRouteStop>, startDistance: number, now: number, id: string): BusVehicle | null {
  const first = chain[0]!, last = chain.at(-1)!;
  const firstStop = bySeq.get(first.seq)!;
  // A later observation elsewhere must not renew an older trajectory anchor.
  const validUntil = Math.min(...chain.map(eta => eta.observed)) + FRESH;
  if (now >= validUntil || chain.length === 1 && (firstStop.distance <= 0 || now >= last.at)) return null;
  const timeline = chain.map(eta => ({ distance: bySeq.get(eta.seq)!.distance, at: eta.at }));
  if (now < first.at && firstStop.distance > startDistance) {
    const second = timeline[1];
    const speed = second ? (second.distance - firstStop.distance) / ((second.at - first.at) / 1000) : 6;
    if (!(speed > 0) || speed > 25) return null;
    timeline.unshift({ distance: startDistance, at: first.at - (firstStop.distance - startDistance) / speed * 1000 });
  }
  if (timeline.length < 2) return null;
  const next = timeline.findIndex(point => point.at > now);
  const index = next < 0 ? timeline.length - 2 : Math.max(0, next - 1);
  const from = timeline[index], to = timeline[index + 1];
  return { id, fromDistance: from.distance, toDistance: to.distance, departureAt: from.at, arrivalAt: to.at, validUntil, timeline };
}

type DirectionLoad = { route: BusRouteData; vehicles: BusVehicle[]; observed: number; failed: boolean }

async function loadDirection(selection: BusRouteSelection, now: number, requireSelectedStop: boolean, signal: AbortSignal): Promise<DirectionLoad> {
  const stops = await routeStops(selection, requireSelectedStop, signal)
  const key = [selection.operator, selection.route, selection.bound, selection.serviceType, selection.routeId, selection.routeSeq].join(':')
  const [road, etaResult] = await Promise.all([waitForRequest(busRoadGeometry(selection, stops), signal).catch(() => null), routeEtas(selection, stops, signal).catch(() => ({ etas: [] as BusEta[], failed: true }))])
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
    const observed = forward.observed
    // Staleness follows the rider's own bound; a reverse bound that fails to
    // load simply drops out of the view.
    const stale = forward.failed || (forward.observed > 0 && now - forward.observed >= FRESH)
    const keep = (load: DirectionLoad): BusRouteDirection => ({ route: load.route, vehicles: load.vehicles, stale: load.failed || (load.observed > 0 && now - load.observed >= FRESH) })
    return {
      ok: true,
      route: forward.route,
      vehicles: forward.vehicles,
      reverse: reverseLoads.filter((load): load is DirectionLoad => Boolean(load)).map(keep),
      observedAt: observed ? new Date(observed).toISOString() : null,
      stale,
      ...(forward.failed ? { error: 'Arrival estimates could not refresh' } : {}),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Bus route unavailable', vehicles: [], reverse: [], observedAt: null, stale: false }
  }
}

// The layer picker needs geometry for several routes, without polling every stop's ETA.
export async function loadBusRoutePaths(request: BusPathRequest): Promise<BusRouteData[]> {
  const { operator, route, stopId } = request
  let selection = request.tracking
  if (!selection) {
    if (operator === 'kmb' || operator === 'citybus') selection = { operator, route, stopId, bound: 'O', ...(operator === 'kmb' ? { serviceType: '1', company: busCompany(route, '') } : {}) }
    if (operator === 'gmb') {
      const routeId = Object.entries(gmbStop(stopId)?.ids ?? {}).find(([, code]) => code === route)?.[0]
      if (routeId) selection = { operator, route, stopId, routeId, routeSeq: 1 }
    }
    if (operator === 'nlb') {
      const routeId = nlbStop(stopId)?.services.find(service => service.code === route)?.id
      if (routeId) selection = { operator, route, stopId, routeId }
    }
  }
  if (!selection || !validBusSelection(selection)) throw new Error('Bus route geometry unavailable')
  const signal = AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS)
  const directions = [selection, ...reverseSelections(selection)]
  const results = await Promise.all(directions.map(async direction => {
    try {
      const stops = await routeStops(direction, false, signal)
      const road = await waitForRequest(busRoadGeometry(direction, stops), signal).catch(() => null)
      const coordinates: [number, number][] = road?.coordinates ?? stops.map(stop => [stop.lng, stop.lat])
      const distances = road?.stopDistances ?? routeDistances(coordinates)
      stops.forEach((stop, index) => { stop.distance = distances[index] })
      return { key: [operator, route, direction.bound, direction.serviceType, direction.routeId, direction.routeSeq].join(':'), operator, route, stops, coordinates, geometry: road ? 'road' : 'stops' } satisfies BusRouteData
    } catch { return null }
  }))
  const paths = results.filter((result): result is NonNullable<typeof result> => result !== null)
  if (!paths.length) throw new Error('Bus route geometry unavailable')
  return paths
}
