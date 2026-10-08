import { kmbStop } from './kmb-network.ts'
import { citybusStop } from './citybus-network.ts'
import { gmbStop } from './gmb-reach.ts'
import { nlbStop } from './nlb-network.ts'
import { nlbArrivalMs } from './nlb-clock.ts'
import { fetchUpstream } from './upstream.ts'
import { etaQueue } from './polite-fetch.ts'
import { ETA_FRESH_MS } from './place-arrivals.ts'
import { pool } from './pool.ts'
import { routeDistances } from './bus-route-motion.ts'
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
export type BusRouteResponse = {
  ok: boolean
  error?: string
  route?: { key: string; operator: BusRouteSelection['operator']; company?: string; route: string; stops: BusRouteStop[]; coordinates: [number, number][]; geometry: 'road' | 'stops' }
  vehicle: { id: string; fromDistance: number; toDistance: number; departureAt: number; arrivalAt: number; validUntil: number } | null
  observedAt: string | null
  stale: boolean
}
export type BusStopArrivalsResponse = { ok: boolean; arrivals: Arrival[]; observedAt: string | null; stale: boolean; error?: string }
export type BusEta = { seq: number; at: number; observed: number; scheduled: boolean }
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

export function validBusSelection(value: BusRouteSelection, requireStopSeq = false): boolean {
  if (!value || !['kmb', 'citybus', 'gmb', 'nlb'].includes(value.operator) || !/^[A-Za-z0-9-]{1,12}$/.test(value.route) || !/^[A-Za-z0-9]{1,20}$/.test(value.stopId)) return false
  if (requireStopSeq && value.stopSeq == null) return false
  if (value.stopSeq != null && (!Number.isInteger(value.stopSeq) || value.stopSeq < 1 || value.stopSeq > 200)) return false
  if (value.operator === 'kmb') return (value.bound === 'I' || value.bound === 'O') && /^\d{1,3}$/.test(value.serviceType ?? '') && (!value.company || ['KMB', 'LWB'].includes(value.company))
  if (value.operator === 'citybus') return value.bound === 'I' || value.bound === 'O'
  return /^\d{1,10}$/.test(value.routeId ?? '') && (value.operator !== 'gmb' || value.routeSeq === 1 || value.routeSeq === 2)
}

async function json(url: string, ttl = DAY): Promise<{ body: Row; fetched: number }> {
  const response = await etaQueue(() => fetchUpstream(url, ttl, { timeoutMs: 8_000, headers: { Accept: 'application/json' } }))
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
    const { body, fetched } = await json(url, ETA_FRESH_MS)
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

async function routeStops(selection: BusRouteSelection): Promise<BusRouteStop[]> {
  const { operator, route, bound, routeId, routeSeq, serviceType } = selection
  const direction = bound === 'I' ? 'inbound' : 'outbound'
  const url = operator === 'kmb' ? `${KMB}/route-stop/${route}/${direction}/${serviceType}`
    : operator === 'citybus' ? `${CTB}/route-stop/CTB/${route}/${direction}`
      : operator === 'gmb' ? `${GMB}/route-stop/${routeId}/${routeSeq}`
        : `${NLB}?action=list&routeId=${routeId}`
  const { body } = await json(url)
  const rows = array(operator === 'gmb' ? record(body.data).route_stops : operator === 'nlb' ? body.stops : body.data)
  if (rows.length < 2 || rows.length > 200) throw new Error('Complete bus route unavailable')
  const stops: BusRouteStop[] = []
  await pool(rows, 4, async (row) => {
    const id = text(operator === 'gmb' ? row.stop_id : operator === 'nlb' ? row.stopId : row.stop)
    const seq = Number(operator === 'gmb' ? row.stop_seq : operator === 'nlb' ? rows.indexOf(row) + 1 : row.seq)
    let place = { kmb: kmbStop, citybus: citybusStop, gmb: gmbStop, nlb: nlbStop }[operator](id)
    if (!place && operator !== 'nlb') {
      const stopUrl = operator === 'kmb' ? `${KMB}/stop/${id}` : operator === 'citybus' ? `${CTB}/stop/${id}` : `${GMB}/stop/${id}`
      const data = record((await json(stopUrl)).body.data)
      const point = operator === 'gmb' ? record(record(data.coordinates).wgs84) : data
      place = { tc: text(data.name_tc ?? row.name_tc), en: text(data.name_en ?? row.name_en), lng: Number(point.long ?? point.longitude), lat: Number(point.lat ?? point.latitude) }
    }
    const lng = operator === 'nlb' ? Number(row.longitude) : place?.lng
    const lat = operator === 'nlb' ? Number(row.latitude) : place?.lat
    if (!Number.isInteger(seq) || !Number.isFinite(lng) || !Number.isFinite(lat) || lng! < 113 || lng! > 115 || lat! < 22 || lat! > 23) throw new Error('Bus route contains incomplete stops')
    stops.push({ id, seq, lng: lng!, lat: lat!, nameTc: text(row.stopName_c ?? row.name_tc ?? place?.tc), nameEn: text(row.stopName_e ?? row.name_en ?? place?.en), distance: 0 })
  })
  stops.sort((a, b) => a.seq - b.seq)
  if (stops.some((stop, index) => stop.seq !== index + 1) || !stops.some((stop) => stop.id === selection.stopId && (selection.stopSeq == null || stop.seq === selection.stopSeq))) throw new Error('Selected stop does not match this route')
  return stops
}

async function routeEtas(selection: BusRouteSelection, stops: BusRouteStop[]): Promise<BusEta[]> {
  if (selection.operator === 'kmb') {
    const { body, fetched } = await json(`${KMB}/route-eta/${selection.route}/${selection.serviceType}`, ETA_FRESH_MS)
    return array(body.data).filter((row) => row.dir === selection.bound && String(row.service_type) === selection.serviceType && row.eta_seq === 1).map((row) => ({ seq: Number(row.seq), at: Date.parse(text(row.eta)), observed: Date.parse(text(row.data_timestamp)) || fetched, scheduled: scheduled(row) }))
  }
  const selectedIndex = stops.findIndex((stop) => stop.id === selection.stopId && (selection.stopSeq == null || selection.stopSeq === stop.seq))
  // ponytail: twelve upstream samples bound ETA traffic; denser sampling needs a route-level feed.
  const indexes = new Set(Array.from({ length: Math.min(12, selectedIndex + 1) }, (_, index) => Math.round(index * selectedIndex / Math.max(1, Math.min(12, selectedIndex + 1) - 1))))
  if (selectedIndex + 1 < stops.length) indexes.add(selectedIndex + 1)
  const etas: BusEta[] = []
  await pool([...indexes], 4, async (index) => {
    const stop = stops[index]
    const url = selection.operator === 'citybus' ? `${CTB}/eta/CTB/${stop.id}/${selection.route}`
      : selection.operator === 'gmb' ? `${GMB}/eta/route-stop/${selection.routeId}/${selection.routeSeq}/${stop.seq}`
        : `${NLB}?action=estimatedArrivals&routeId=${selection.routeId}&stopId=${stop.id}&lang=en`
    const { body, fetched } = await json(url, ETA_FRESH_MS)
    if (selection.operator === 'nlb') {
      const row = array(body.estimatedArrivals)[0]
      if (row) etas.push({ seq: stop.seq, at: nlbArrivalMs(text(row.estimatedArrivalTime)), observed: nlbArrivalMs(text(row.generateTime)), scheduled: String(row.departed) !== '1' || String(row.noGPS) !== '0' })
    } else if (selection.operator === 'gmb') {
      const data = record(body.data)
      const row = array(data.eta).find((item) => item.eta_seq === 1)
      if (data.enabled !== false && row) etas.push({ seq: stop.seq, at: Date.parse(text(row.timestamp)), observed: Date.parse(text(body.generated_timestamp)) || fetched, scheduled: scheduled(row) })
    } else {
      const row = array(body.data).find((item) => item.dir === selection.bound && Number(item.seq) === stop.seq && item.eta_seq === 1)
      if (row) etas.push({ seq: stop.seq, at: Date.parse(text(row.eta)), observed: Date.parse(text(row.data_timestamp)) || fetched, scheduled: scheduled(row) })
    }
  })
  return etas
}

export function inferBusVehicle(stops: BusRouteStop[], etas: BusEta[], selectedSeq: number, now: number, id: string): BusRouteResponse['vehicle'] {
  const live = etas.filter((eta) => !eta.scheduled && Number.isFinite(eta.at) && Number.isFinite(eta.observed) && now - eta.observed < FRESH && eta.observed <= now + 30_000)
  const next = live.filter((eta) => eta.seq > 1 && eta.seq <= selectedSeq && eta.at > now).sort((a, b) => a.at - b.at)[0]
  if (!next) return null
  const to = stops.find((stop) => stop.seq === next.seq)
  const from = stops.find((stop) => stop.seq === next.seq - 1)
  if (!to || !from || to.distance <= from.distance) return null
  const after = live.find((eta) => eta.seq === next.seq + 1 && eta.at > next.at)
  const afterStop = after && stops.find((stop) => stop.seq === after.seq)
  // ponytail: ETAs have no vehicle IDs. Infer one approach at constant speed, capped to
  // the preceding stop and three-minute observation lifetime; GPS would replace this heuristic.
  const speed = after && afterStop && afterStop.distance > to.distance ? (afterStop.distance - to.distance) / ((after.at - next.at) / 1000) : 6
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 25) return null
  const duration = Math.min(600_000, Math.max(15_000, (to.distance - from.distance) / speed * 1000))
  const departureAt = next.at - duration
  if (departureAt > now || next.at - now > FRESH) return null
  return { id, fromDistance: from.distance, toDistance: to.distance, departureAt, arrivalAt: next.at, validUntil: Math.min(next.at + 15_000, next.observed + FRESH) }
}

export async function loadBusRoute(selection: BusRouteSelection, now = Date.now()): Promise<BusRouteResponse> {
  if (!validBusSelection(selection)) return { ok: false, error: 'Invalid bus route selection', vehicle: null, observedAt: null, stale: false }
  try {
    const stops = await routeStops(selection)
    const key = [selection.operator, selection.route, selection.bound, selection.serviceType, selection.routeId, selection.routeSeq].join(':')
    const [road, etaResult] = await Promise.all([busRoadGeometry(selection, stops).catch(() => null), routeEtas(selection, stops).then((etas) => ({ etas, failed: false })).catch(() => ({ etas: [] as BusEta[], failed: true }))])
    const coordinates: [number, number][] = road?.coordinates ?? stops.map((stop) => [stop.lng, stop.lat])
    const distances = road?.stopDistances ?? routeDistances(coordinates)
    stops.forEach((stop, index) => { stop.distance = distances[index] })
    const route: NonNullable<BusRouteResponse['route']> = { key, operator: selection.operator, company: selection.company, route: selection.route, stops, coordinates, geometry: road ? 'road' : 'stops' }
    const selected = stops.find((stop) => stop.id === selection.stopId && (selection.stopSeq == null || stop.seq === selection.stopSeq))!
    const observed = Math.max(0, ...etaResult.etas.map((eta) => Number.isFinite(eta.observed) ? eta.observed : 0))
    const stale = etaResult.failed || (observed > 0 && now - observed >= FRESH)
    return { ok: true, route, vehicle: stale ? null : inferBusVehicle(stops, etaResult.etas, selected.seq, now, key), observedAt: observed ? new Date(observed).toISOString() : null, stale, ...(etaResult.failed ? { error: 'Arrival estimates could not refresh' } : {}) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Bus route unavailable', vehicle: null, observedAt: null, stale: false }
  }
}
