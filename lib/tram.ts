import network from '../data/tram-network.json' with { type: 'json' }
import stations from '../data/tram-eta-stations.json' with { type: 'json' }
import { tramTrack } from './tram-track-geometry.ts'
import { inferBusVehicles } from './bus-estimate.ts'
import { busVehicleDistanceAtTime, routeDistances, routePointAtDistance } from './bus-route-motion.ts'
import type { Arrival, Camera, CameraData } from './traffic.ts'
import type { BusEta, BusRouteStop } from './bus-route.ts'

export type TramDirection = 'eastbound' | 'westbound'
export const TRAM_REFRESH_MS = 30_000
export const TRAM_KEEP_MS = 180_000
export const tramRoutes = network.routes.filter(route => route.id.endsWith('-1'))
export const tramStation = (id: string) => stations.stops.find(stop => stop.stopId === id)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const pairs: Record<string, string> = { SKT_WMT: '4001', SKT_HVT: '4002', HVT_KTT: '4003', CBT_WST: '4004', NPT_WST: '4005', KTT_SKT: '4007' }

function routeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^R\d+_([A-Z]+)_to_([A-Z]+)$/.exec(value)
  if (!match) return null
  // The operator currently calls Shau Kei Wan "WKT" and Western Market "WM"
  // in the R1 debug key. Keep these aliases explicit rather than guessing routes.
  const alias = (code: string) => code === 'WKT' ? 'SKT' : code === 'WM' ? 'WMT' : code
  return pairs[`${alias(match[1])}_${alias(match[2])}`] ?? pairs[`${alias(match[2])}_${alias(match[1])}`] ?? null
}
export class TramServiceError extends Error {}
function localTime(value: unknown): number {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? Date.parse(`${value.replace(' ', 'T')}+08:00`) : NaN
}

// The mobile backend is an operator endpoint without a published API contract.
// Reject changed/error envelopes instead of calling them an empty arrival board.
export function parseTramEta(payload: unknown, code: string, direction: TramDirection, observedAt: string): Arrival[] {
  if (record(payload) && payload.success === false && typeof payload.message === 'string') throw new TramServiceError(payload.message.slice(0, 1000))
  if (!record(payload) || payload.success !== true || !record(payload.data)
    || payload.data.current_station !== code || payload.data.direction !== direction || !Array.isArray(payload.data.etas)) throw new Error('Tram ETA response unavailable')
  return payload.data.etas.map((row): Arrival => {
    if (!record(row) || typeof row.destination_code !== 'string' || typeof row.destination !== 'string'
      || row.eta_type !== 'ACTUAL' && row.eta_type !== 'SCHEDULED'
      || !Array.isArray(row.route_stations) || row.route_stations.some(item => typeof item !== 'string')) throw new Error('Invalid tram arrival')
    const minutes = row.arriving_in === 'ARRIVED' ? 0 : typeof row.arriving_in === 'number' || typeof row.arriving_in === 'string' && /^\d+$/.test(row.arriving_in) ? Number(row.arriving_in) : NaN
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 180) throw new Error('Invalid tram arrival time')
    const published = row.eta_type === 'SCHEDULED' ? localTime(row.estimated_dep_time) : localTime(row.estimated_arrival_time)
    const at = Number.isFinite(published) ? published : Date.parse(observedAt) + minutes * 60_000
    if (!Number.isFinite(at)) throw new Error('Invalid tram clock')
    const id = routeId(record(row.debug) ? row.debug.route_code : null)
    const destination = stations.destinations.find(item => item.code === row.destination_code)
    return { route: id ?? row.destination_code, destination: destination?.tc ?? row.destination, destinationEn: destination?.en ?? row.destination,
      minutes, eta: new Date(at).toISOString(), observedAt, scheduled: row.eta_type === 'SCHEDULED',
      tram: { routeId: id, direction: tramTravelDirection(id, row.destination_code, direction), vehicleId: typeof row.tram_no === 'number' && Number.isInteger(row.tram_no) ? String(row.tram_no) : null },
    }
  })
}

function tramTravelDirection(id: string | null, destination: string, fallback: TramDirection): TramDirection {
  if (['KTT', 'WMT', 'WM', 'WST', 'WD'].includes(destination)) return 'westbound'
  if (['SKT', 'NPT', 'CBT', 'ED'].includes(destination)) return 'eastbound'
  if (destination.startsWith('HVT')) return id === '4003' ? 'eastbound' : id === '4002' ? 'westbound' : fallback
  return fallback
}

function buildEstimates(data: CameraData, id: string, now: number) {
  return network.routes.filter(route => `tram:${route.routeId}` === id).flatMap(route => {
    const track = tramTrack(route)
    if (!track) return []
    const direction: TramDirection = route.points[0][1] < route.points.at(-1)![1] ? 'eastbound' : 'westbound'
    const stops: BusRouteStop[] = route.points.flatMap(([lat, lng], index) => {
      const stop = network.stops.find(stop => stop.lat === lat && stop.lng === lng && stop.routes.includes(route.routeId))
      return stop ? [{ id: stop.id, seq: index + 1, nameTc: stop.tc, nameEn: stop.en, lat, lng, distance: track.stopDistances[index] }] : []
    })
    const groups = new Map<string, { destination: string; destinationEn: string; etas: BusEta[] }>()
    for (const stop of stops) {
      const camera = data.cameras.find(camera => camera.sourceId === stop.id)
      const ranks = new Map<string, number>()
      for (const call of (camera?.arrivals ?? []).filter(call => !call.scheduled && call.tram?.routeId === route.routeId && call.tram.direction === direction)
        .sort((a, b) => Date.parse(a.eta ?? '') - Date.parse(b.eta ?? ''))) {
        // Do not chain short workings to a different destination. Fleet numbers,
        // when supplied, also keep distinct physical trams in separate groups.
        const key = `${call.destinationEn}:${call.tram?.vehicleId ?? ''}`
        const rank = (ranks.get(key) ?? 0) + 1
        ranks.set(key, rank)
        const group = groups.get(key) ?? { destination: call.destination, destinationEn: call.destinationEn, etas: [] }
        group.etas.push({ seq: stop.seq, rank, at: Date.parse(call.eta ?? ''), observed: Date.parse(call.observedAt ?? ''), scheduled: false })
        groups.set(key, group)
      }
    }
    const distances = routeDistances(track.coordinates)
    return [...groups].map(([key, group]) => ({ ...group, route, stops, coordinates: track.coordinates, distances,
      vehicles: inferBusVehicles(stops, group.etas, now, `${route.id}:${key}`),
    }))
  })
}
const motionCache = new WeakMap<CameraData, Map<string, ReturnType<typeof buildEstimates>>>()
export function tramVehicleCameras(data: CameraData, id: string, now: number): Camera[] {
  let routes = motionCache.get(data)
  if (!routes) { routes = new Map(); motionCache.set(data, routes) }
  let estimates = routes.get(id)
  if (!estimates) { estimates = buildEstimates(data, id, now); routes.set(id, estimates) }
  return estimates.flatMap(estimate => estimate.vehicles.flatMap(vehicle => {
    // Never show a vehicle waiting at a made-up origin before its inferred trip.
    if (now < vehicle.departureAt) return []
    const distance = busVehicleDistanceAtTime(vehicle, now)
    if (distance === null) return []
    const point = routePointAtDistance(estimate.coordinates, estimate.distances, distance)
    if (!point) return []
    const nextAnchor = vehicle.timeline?.find(anchor => anchor.at >= now)
    const next = estimate.stops.find(stop => stop.distance >= (nextAnchor?.distance ?? distance)) ?? estimate.stops.at(-1)
    const call = estimate.etas.find(eta => eta.seq === next?.seq && eta.at >= now)
    return [{ id: `selected-vehicle:${id}:${vehicle.id}`, sourceId: vehicle.id, kind: 'tram', name: `電車 → ${estimate.destination}`, nameEn: `Tram → ${estimate.destinationEn}`,
      lat: point[1], lng: point[0], estimated: true, positionType: 'vehicle', color: '#278273', dataUpdated: new Date(vehicle.validUntil - TRAM_KEEP_MS).toISOString(),
      routePosition: { key: `tram:${estimate.route.id}`, distance, coordinates: estimate.coordinates, distances: estimate.distances },
      nextStation: next ? { name: next.nameTc, nameEn: next.nameEn } : undefined,
      arrivals: call && next ? [{ route: estimate.route.routeId, destination: next.nameTc, destinationEn: next.nameEn, minutes: Math.max(0, Math.ceil((call.at - now) / 60_000)), eta: new Date(call.at).toISOString(), observedAt: new Date(call.observed).toISOString() }] : [],
      information: { en: 'Position estimated from tram arrival times on matched OpenStreetMap tracks. Not GPS. The icon does not identify a physical tram.', zh: '按電車到站時間及配對的 OpenStreetMap 軌道估算位置，並非 GPS。圖示不代表個別電車。' },
    } satisfies Camera]
  }))
}
