import { layers, type Camera, type CameraData, type LayerKind, type MapPath } from './traffic.ts'
import { linesThrough, mtrLineList, mtrTrackCollection } from './mtr-network.ts'
import { lrtRoutes, lrtRoutesThrough, lrtStation } from './lrt-network.ts'
import { railSegment } from './rail-geometry.ts'
import { ferryPaths } from './ferry-fairway.ts'
import { ferryPiers } from './ferry-network.ts'
import trams from '../data/tram-network.json' with { type: 'json' }
import { tramTrackPaths } from './tram-track-geometry.ts'
import { mtrBusStops } from './commuter-catalogue.ts'
import { mtrBusDirections } from './mtr-bus-geometry.ts'
import type { BusRouteData, BusRouteSelection } from './bus-route.ts'
import { hasBusRoadDisplay } from './bus-route-display.ts'
import type { FerryResponse, FerryVessel, LrtResponse, MtrResponse } from './types.ts'

export const transportModes = ['bus', 'rail', 'ferry', 'tram'] as const
export type TransportMode = typeof transportModes[number]
export const transportKinds: Record<TransportMode, LayerKind[]> = {
  bus: ['kmb', 'citybus', 'gmb', 'nlb', 'mtr-bus'], rail: ['mtr', 'lrt'], ferry: ['ferry'], tram: ['tram'],
}
export type RouteVisibility = Record<string, boolean>
export type BusPathRequest = { operator: BusRouteSelection['operator']; route: string; stopId: string; tracking?: BusRouteSelection }
export type SavedBusRoute = Omit<BusPathRequest, 'tracking'> & { name: string; nameEn: string }
export type TransportRoute = {
  id: string; mode: TransportMode; kind: LayerKind; code: string; name: string; nameEn: string
  paths: MapPath[]; stopIds: string[]; bus?: BusPathRequest; roadCoverage?: 'complete' | 'partial' | 'unavailable'
}
export type RouteFocus = { points: [number, number][] } // [lat, lng], as with MapPath
export const routeVisible = (route: Pick<TransportRoute, 'id' | 'mode'>, visibility: RouteVisibility) => visibility[route.id] ?? (route.id.startsWith('rail:lrt:') ? visibility['rail:lrt'] : undefined) ?? visibility[`all:${route.mode}`] ?? true
export function setAllRoutes(visibility: RouteVisibility, mode: TransportMode, on: boolean): RouteVisibility {
  return { ...Object.fromEntries(Object.entries(visibility).filter(([key]) => !key.startsWith(`${mode}:`))), [`all:${mode}`]: on }
}

let network: TransportRoute[] | undefined
function networkRoutes(): TransportRoute[] {
  if (network) return network
  const routes: TransportRoute[] = []
  for (const line of mtrLineList()) {
    const paths: MapPath[] = mtrTrackCollection().features.flatMap((feature, index) => {
      if (feature.properties?.line !== line.code) return []
      const lines = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : []
      return lines.map((points, i) => ({ id: `mtr-${index}-${i}`, line: line.code, color: line.color, points: points.map(point => [point[1], point[0]] as [number, number]) }))
    })
    routes.push({ id: `rail:mtr:${line.code}`, mode: 'rail', kind: 'mtr', code: line.code, name: line.tc, nameEn: line.en, paths, stopIds: [] })
  }
  for (const code of new Set(lrtRoutes().map(route => route.line))) {
    const stops = new Set<string>(), paths: MapPath[] = []
    for (const route of lrtRoutes().filter(route => route.line === code)) {
      route.stations.forEach(id => stops.add(id))
      for (let i = 1; i < route.stations.length; i++) {
        const coordinates = railSegment('lrt', code, route.stations[i - 1], route.stations[i])
        if (coordinates) paths.push({ id: `lrt-${route.id}-${i}`, line: code, color: layers.lrt.color, points: coordinates.map(([lng, lat]) => [lat, lng]) })
      }
    }
    const loop = code === '705' ? ['430', '435'] : code === '706' ? ['430', '445'] : null
    const closing = loop && railSegment('lrt', code, loop[0], loop[1])
    if (closing) paths.push({ id: `lrt-${code}-loop`, line: code, color: layers.lrt.color, points: closing.map(([lng, lat]) => [lat, lng]) })
    const first = lrtRoutes().find(route => route.line === code)
    const from = first && lrtStation(first.stations[0]), to = first && lrtStation(first.stations.at(-1) ?? '')
    routes.push({ id: `rail:lrt:${code}`, mode: 'rail', kind: 'lrt', code, name: `${from?.tc ?? ''} ↔ ${to?.tc ?? ''}`, nameEn: `${from?.en ?? ''} ↔ ${to?.en ?? ''}`, paths, stopIds: [...stops] })
  }
  const piers = ferryPiers()
  for (const path of ferryPaths()) {
    const from = piers.find(pier => pier.id === path.fromId), to = piers.find(pier => pier.id === path.toId)
    routes.push({ id: `ferry:${path.id}`, mode: 'ferry', kind: 'ferry', code: '', name: `${from?.nameTc} ↔ ${to?.nameTc}`, nameEn: `${from?.nameEn} ↔ ${to?.nameEn}`, stopIds: [path.fromId, path.toId], paths: [{ id: path.id, color: layers.ferry.color, points: path.pathLat.map((lat, i) => [lat, path.pathLng[i]]) }] })
  }
  for (const code of new Set(trams.routes.map(route => route.routeId))) {
    const directions = trams.routes.filter(route => route.routeId === code), first = directions[0]
    const paths = tramTrackPaths(code)
    const roadCoverage = !paths.length ? 'unavailable' : paths.length === directions.length ? 'complete' : 'partial'
    routes.push({ id: `tram:${code}`, mode: 'tram', kind: 'tram', code: '', name: first.tc, nameEn: first.en, stopIds: trams.stops.filter(stop => stop.routes.includes(code)).map(stop => stop.id), paths, roadCoverage })
  }
  for (const code of new Set(mtrBusStops.map(stop => stop.route))) {
    const stops = mtrBusStops.filter(stop => stop.route === code)
    const directions = mtrBusDirections().filter(direction => direction.code === code)
    const matched = directions.filter(direction => direction.road)
    const paths: MapPath[] = matched.map(direction => ({ id: `bus-mtr-${direction.key}`, color: layers['mtr-bus'].color, points: direction.road!.coordinates.map(([lng, lat]) => [lat, lng]) }))
    const roadCoverage = matched.length === 0 ? 'unavailable' : matched.length === directions.length ? 'complete' : 'partial'
    routes.push({ id: `bus:mtr-bus:${code}`, mode: 'bus', kind: 'mtr-bus', code, name: '港鐵巴士', nameEn: 'MTR Bus', stopIds: stops.map(stop => stop.id), paths, roadCoverage })
  }
  return network = routes
}

export function transportRoutes(feeds: Partial<Record<LayerKind, CameraData>>, saved: SavedBusRoute[] = []): TransportRoute[] {
  const routes = new Map(networkRoutes().map(route => [route.id, route]))
  for (const route of saved) routes.set(`bus:${route.operator}:${route.route}`, { id: `bus:${route.operator}:${route.route}`, kind: route.operator, mode: 'bus', code: route.route, name: route.name, nameEn: route.nameEn, paths: [], stopIds: [route.stopId], bus: route })
  for (const kind of ['kmb', 'citybus', 'gmb', 'nlb'] as const) {
    for (const camera of feeds[kind]?.cameras ?? []) {
      for (const code of new Set([...(camera.routes ?? []), ...(camera.arrivals ?? []).map(call => call.route)])) {
        const tracking = camera.arrivals?.find(call => call.route === code && call.tracking)?.tracking
        const id = `bus:${kind}:${code}`
        const previous = routes.get(id)
        const bus = previous?.bus?.tracking ? previous.bus : { operator: kind, route: code, stopId: camera.sourceId, tracking }
        const call = camera.arrivals?.find(call => call.route === code)
        routes.set(id, { id, kind, code, mode: 'bus', name: call?.destination || previous?.name || layers[kind].name, nameEn: call?.destinationEn || previous?.nameEn || layers[kind].nameEn, paths: [], stopIds: [...(previous?.stopIds ?? []), camera.sourceId], bus })
      }
    }
  }
  return [...routes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code, 'en', { numeric: true }) || a.nameEn.localeCompare(b.nameEn))
}

export function busPaths(routes: (Pick<BusRouteData, 'key' | 'operator' | 'coordinates'> & Partial<Pick<BusRouteData, 'geometry'>>)[]): MapPath[] {
  return routes.filter(hasBusRoadDisplay).map(route => ({ id: `catalogue:${route.key}`, color: layers[route.operator].color, points: route.coordinates.map(([lng, lat]) => [lat, lng]) }))
}

export function cameraRouteIds(camera: Camera, routes: TransportRoute[]): string[] {
  if (camera.kind === 'mtr') return linesThrough(camera.sourceId).map(code => `rail:mtr:${code}`)
  if (camera.kind === 'lrt') return lrtRoutesThrough(camera.sourceId).map(code => `rail:lrt:${code}`)
  return routes.filter(route => route.kind === camera.kind && route.stopIds.includes(camera.sourceId)).map(route => route.id)
}
export function filterTransportFeed(kind: LayerKind, data: CameraData | undefined, routes: TransportRoute[], visibility: RouteVisibility): CameraData | undefined {
  if (!data || !routes.some(route => route.kind === kind)) return data
  const choices = routes.filter(route => route.kind === kind)
  const visible = choices.filter(route => routeVisible(route, visibility)), ids = new Set(visible.map(route => route.id))
  if (visible.length === choices.length) return { ...data, paths: visible.flatMap(route => route.paths) }
  const cameras = data.cameras.flatMap(camera => {
    if (!cameraRouteIds(camera, choices).some(id => ids.has(id))) return []
    const arrivals = camera.arrivals?.filter(call => kind === 'ferry'
      ? visible.some(route => route.stopIds.includes(camera.sourceId) && Boolean(call.destinationEn && route.nameEn.includes(call.destinationEn) || call.destination && route.name.includes(call.destination)))
      : kind === 'tram' ? visible.some(route => route.id === `tram:${call.tram?.routeId}`)
        : visible.some(route => route.code === call.route))
    const codes = camera.routes?.filter(code => visible.some(route => kind === 'tram' ? route.id === `tram:${code}` : route.code === code))
    const lineColors = kind === 'mtr' ? mtrLineList().filter(line => linesThrough(camera.sourceId).includes(line.code) && visible.some(route => route.code === line.code)).map(line => line.color) : undefined
    return [{ ...camera, arrivals, ...(codes ? { routes: codes, badge: codes.slice(0, 3).join(' · ') } : {}), ...(lineColors ? { color: lineColors[0], lineColors } : {}) }]
  })
  let payload = data.payload
  if (kind === 'mtr') {
    const rail = data.payload as MtrResponse | undefined
    payload = rail && { ...rail, trains: rail.trains.filter(train => visible.some(route => route.code === train.line)), boards: rail.boards.filter(board => visible.some(route => route.code === board.line)) }
  } else if (kind === 'lrt') {
    const rail = data.payload as LrtResponse | undefined
    payload = rail && { ...rail, trains: rail.trains.filter(train => visible.some(route => route.code === train.line)), boards: rail.boards.map(board => ({ ...board, calls: board.calls.filter(call => visible.some(route => route.code === call.route)) })).filter(board => board.calls.length) }
  } else if (kind === 'ferry') {
    const ferry = data.payload as FerryResponse | undefined
    payload = ferry && { ...ferry, piers: ferry.piers.filter(pier => cameras.some(camera => camera.sourceId === pier.id)), vessels: ferry.vessels.filter(vessel => ferryVesselVisible(vessel, visible)) }
  }
  return { ...data, cameras, paths: visible.flatMap(route => route.paths), payload }
}

function ferryVesselVisible(vessel: FerryVessel, routes: TransportRoute[]): boolean {
  const start = [vessel.fromLat ?? vessel.pathLat?.[0], vessel.fromLng ?? vessel.pathLng?.[0]]
  const end = [vessel.toLat ?? vessel.pathLat?.at(-1), vessel.toLng ?? vessel.pathLng?.at(-1)]
  // GPS services without a published corridor can still be matched to their destination pier.
  return routes.some(route => {
    const points = route.paths[0]?.points, first = points?.[0], last = points?.at(-1)
    if (!first || !last) return false
    const near = (point: number[], target: (number | undefined)[]) => target.every((value, i) => value !== undefined && Math.abs(point[i] - value) < 0.003)
    return near(first, start) && near(last, end) || near(first, end) && near(last, start)
      || [start, end].every(point => point.some(value => value === undefined)) && (route.nameEn.includes(vessel.destEn ?? vessel.nameEn) || route.name.includes(vessel.destTc ?? vessel.nameTc))
  })
}
