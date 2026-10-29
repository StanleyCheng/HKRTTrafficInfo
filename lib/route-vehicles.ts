import type { BusRouteData, BusRouteResponse, BusRouteStop, BusVehicle, BusEta } from './bus-route.ts'
import type { Camera, CameraData } from './traffic.ts'
import { layers } from './traffic.ts'
import { inferBusVehicles } from './bus-estimate.ts'
import { busVehicleDistanceAtTime, routeDistances, routePointAtDistance } from './bus-route-motion.ts'
import { mtrBusDirections } from './mtr-bus-geometry.ts'
import { mtrBusLineRef } from './commuter-catalogue.ts'
import { busCompany } from './bus-company.ts'
import { hasBusRoadDisplay } from './bus-route-display.ts'

export type RouteVehicleSnapshot = { kind: 'bus'; data: BusRouteResponse } | { kind: 'mtr-bus'; data: CameraData }
export type RouteVehicleState = { status: 'loading' | 'error'; data?: RouteVehicleSnapshot } | { status: 'ready'; data: RouteVehicleSnapshot }
export type RouteVehicleFeeds = Record<string, RouteVehicleSnapshot>
const geometryDistances = new WeakMap<BusRouteData, number[]>()

function camerasOnRoute(route: Pick<BusRouteData, 'key' | 'route' | 'stops' | 'coordinates' | 'company'>, kind: Camera['kind'], vehicles: BusVehicle[], observedAt: string | null, prefix: string, now: number, distances: number[]): Camera[] {
  const terminus = route.stops.at(-1)
  return vehicles.flatMap(bus => {
    const distance = busVehicleDistanceAtTime(bus, now)
    if (distance === null) return []
    const point = routePointAtDistance(route.coordinates, distances, distance)
    if (!point) return []
    const anchor = bus.timeline?.find(point => point.at >= now)
    const next = route.stops.find(stop => stop.distance >= (anchor?.distance ?? bus.toDistance) - .01) ?? terminus
    const arrivalAt = anchor?.at ?? bus.arrivalAt
    return [{ id: `selected-vehicle:${prefix}:${bus.id}`, sourceId: bus.id, kind, company: route.company === 'KMB' || route.company === 'LWB' ? route.company : undefined,
      name: `${route.route} → ${terminus?.nameTc ?? ''}`, nameEn: `${route.route} → ${terminus?.nameEn ?? ''}`,
      lng: point[0], lat: point[1], estimated: true, positionType: 'vehicle', dataUpdated: observedAt ?? undefined,
      ...(next ? { nextStation: { name: next.nameTc, nameEn: next.nameEn } } : {}),
      arrivals: [{ route: route.route, destination: next?.nameTc ?? '', destinationEn: next?.nameEn ?? '', minutes: Math.max(0, Math.ceil((arrivalAt - now) / 60000)), eta: new Date(arrivalAt).toISOString(), scheduled: bus.scheduled }],
      routePosition: { key: route.key, distance, coordinates: route.coordinates, distances },
    } satisfies Camera]
  })
}

export function selectedVehicleCameras(feeds: RouteVehicleFeeds, now: number): Camera[] {
  return Object.entries(feeds).flatMap(([id, snapshot]) => {
    if (snapshot.kind === 'mtr-bus') return mtrBusVehicleCameras(snapshot.data, id.split(':').at(-1) ?? '', now)
    const { data } = snapshot
    return (data.route ? [{ route: data.route, vehicles: data.vehicles }, ...data.reverse] : []).flatMap(direction => {
      if (!hasBusRoadDisplay(direction.route)) return []
      let distances = geometryDistances.get(direction.route)
      if (!distances) { distances = routeDistances(direction.route.coordinates); geometryDistances.set(direction.route, distances) }
      return camerasOnRoute(direction.route, direction.route.operator, direction.vehicles, data.observedAt, id, now, distances)
    })
  })
}

// Use already loaded observations while the complete route request is pending.
// Match the operator's direction/variant before inferring any position.
export function seedBusRoute(routes: BusRouteData[], data: CameraData | undefined, now: number): BusRouteResponse | undefined {
  if (!data) return
  const clocks: number[] = []
  const directions = routes.map(route => {
    if (!hasBusRoadDisplay(route)) return { route, vehicles: [] }
    const etas: BusEta[] = []
    if (route.selection) for (const stop of route.stops) {
      const camera = data.cameras.find(camera => camera.sourceId === stop.id)
      const calls = camera?.arrivals?.filter(call => {
        const selection = route.selection!, tracking = call.tracking
        return tracking && call.route === route.route && tracking.operator === route.operator
          && (selection.bound === undefined || tracking.bound === selection.bound)
          && (selection.serviceType === undefined || tracking.serviceType === selection.serviceType)
          && (selection.routeId === undefined || tracking.routeId === selection.routeId)
          && (selection.routeSeq === undefined || tracking.routeSeq === selection.routeSeq)
          && (selection.company === undefined || (tracking.company ?? busCompany(call.route, '')) === selection.company)
      }) ?? []
      calls.forEach((call, index) => {
        const observed = Date.parse(call.observedAt ?? camera?.dataUpdated ?? data.observedAt ?? '')
        const at = Date.parse(call.eta ?? '')
        if (Number.isFinite(observed) && Number.isFinite(at)) { clocks.push(observed); etas.push({ seq: stop.seq, rank: index + 1, at, observed, scheduled: Boolean(call.scheduled) }) }
      })
    }
    return { route, vehicles: inferBusVehicles(route.stops, etas, now, route.key) }
  })
  const [first, ...reverse] = directions
  if (!first || !directions.some(direction => direction.vehicles.length)) return
  return { ok: true, route: first.route, vehicles: first.vehicles, reverse, observedAt: new Date(Math.min(...clocks)).toISOString(), stale: false }
}

type MtrEstimate = { route: Pick<BusRouteData, 'key' | 'route' | 'stops' | 'coordinates'>; vehicles: BusVehicle[]; distances: number[] }
const mtrEstimates = new WeakMap<CameraData, Map<string, MtrEstimate[]>>()
export function mtrBusVehicleCameras(data: CameraData, code: string, now: number): Camera[] {
  let codes = mtrEstimates.get(data)
  if (!codes) { codes = new Map(); mtrEstimates.set(data, codes) }
  let estimates = codes.get(code)
  if (!estimates) {
    estimates = mtrBusDirections().filter(direction => direction.code === code && direction.road).map(({ key, stops: rows, road }) => {
      const coordinates = road!.coordinates, distances = routeDistances(coordinates)
      const lineRef = mtrBusLineRef(rows[0].reference, rows[0].direction)
      const stops: BusRouteStop[] = rows.map((stop, i) => ({ id: stop.id, seq: i + 1, nameTc: stop.tc, nameEn: stop.en, lat: stop.lat, lng: stop.lng, distance: road!.stopDistances[i] }))
      const etas = stops.flatMap(stop => {
        const camera = data.cameras.find(camera => camera.sourceId === stop.id)
        return (camera?.arrivals ?? []).filter(call => call.route === code && lineRef && call.mtrLineRef === lineRef).map((call, i) => ({ seq: stop.seq, rank: i + 1, at: Date.parse(call.eta ?? ''), observed: Date.parse(call.observedAt ?? camera?.dataUpdated ?? data.observedAt ?? ''), scheduled: Boolean(call.scheduled) }))
      })
      return { route: { key: `mtr-bus:${key}`, route: code, stops, coordinates }, distances, vehicles: inferBusVehicles(stops, etas, now, `mtr-bus:${key}`) }
    })
    codes.set(code, estimates)
  }
  return estimates.flatMap(estimate => camerasOnRoute(estimate.route, 'mtr-bus', estimate.vehicles, data.observedAt ?? null, `bus:mtr-bus:${code}`, now, estimate.distances)).map(camera => ({ ...camera, color: layers['mtr-bus'].color,
    information: { en: 'ETA-based position estimate on a matched OpenStreetMap route. This is not vehicle GPS. The icon is representative.', zh: '按到站時間及配對的 OpenStreetMap 路線估算位置，並非車輛 GPS。圖示僅代表車種。' } }))
}
