import { validBusSelection } from './bus-selection.ts'
import type { BusRouteSelection, BusRouteStop } from './bus-route.ts'
import type { IntelTab } from './intel.ts'
import { kinds, type Camera } from './traffic.ts'
import type { TransportMode, RouteVisibility, SavedBusRoute } from './transport-routes.ts'

export type MapSession = {
  version: 1
  view: { lng: number; lat: number; zoom: number } | null
  mapMode: '2d' | '3d'
  camera3D: { pitch: number; bearing: number }
  busSelection: BusRouteSelection | null
  selectedPlace: Camera | null
  openControl: 'search' | 'layers' | 'rail' | 'nearby' | null
  dockGroup: 'roads' | 'conditions' | 'rail' | 'bus' | 'ferry'
  showDetectors: boolean
  showBusStops: boolean
  routeLabels: boolean
  transportMode: TransportMode
  routeVisibility: RouteVisibility
  routeQuery: string
  chosenBusRoutes: SavedBusRoute[]
  revealedRoute: string | null
  nearbyRadius: number
  showNearbyOnMap: boolean
  followLocation: boolean
  routeStop: { key: string; stop: BusRouteStop } | null
  intelOpen: boolean
  intelTab: IntelTab
  statusExpanded: boolean
  searchQuery: string
  searchScope: 'roads' | 'locations'
  searchPage: number
}
export const sessionStorageKey = 'hk-traffic-session-v1'
export const defaultSession: MapSession = { version: 1, view: null, mapMode: '2d', camera3D: { pitch: 55, bearing: -20 }, busSelection: null, selectedPlace: null, openControl: null, dockGroup: 'roads', showDetectors: false, showBusStops: true, routeLabels: true, transportMode: 'bus', routeVisibility: {}, routeQuery: '', chosenBusRoutes: [], revealedRoute: null, nearbyRadius: 1000, showNearbyOnMap: false, followLocation: true, routeStop: null, intelOpen: false, intelTab: 'ranked', statusExpanded: false, searchQuery: '', searchScope: 'roads', searchPage: 0 }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const numberBetween = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const string = (value: unknown, limit = 200): value is string => typeof value === 'string' && value.length <= limit

/** Save context only. Arrival observations, images and vehicle estimates are reloaded. */
export function savedPlace(camera: Camera | null): Camera | null {
  return camera ? { id: camera.id, sourceId: camera.sourceId, kind: camera.kind, name: camera.name, nameEn: camera.nameEn, lat: camera.lat, lng: camera.lng, ...(['station', 'vehicle', 'pier'].includes(camera.positionType ?? '') ? { positionType: camera.positionType } : {}) } : null
}
export function parseSession(value: unknown): MapSession {
  if (!record(value) || value.version !== 1) return defaultSession
  const session: MapSession = { ...defaultSession }
  if (record(value.view) && numberBetween(value.view.lng, -180, 180) && numberBetween(value.view.lat, -85, 85) && numberBetween(value.view.zoom, 10, 19)) session.view = { lng: value.view.lng, lat: value.view.lat, zoom: value.view.zoom }
  if (value.mapMode === '2d' || value.mapMode === '3d') session.mapMode = value.mapMode
  if (record(value.camera3D) && numberBetween(value.camera3D.pitch, 0, 75) && numberBetween(value.camera3D.bearing, -360, 360)) session.camera3D = { pitch: value.camera3D.pitch, bearing: value.camera3D.bearing }
  if (record(value.busSelection)) {
    const route = value.busSelection
    // Validate before the one boundary cast, then construct only published selection fields.
    if (['kmb', 'citybus', 'gmb', 'nlb'].includes(String(route.operator)) && string(route.route, 12) && string(route.stopId, 20)) {
      const selection = { operator: route.operator, route: route.route, stopId: route.stopId, company: route.company, bound: route.bound, serviceType: route.serviceType, routeId: route.routeId, routeSeq: route.routeSeq, stopSeq: route.stopSeq } as BusRouteSelection
      if (validBusSelection(selection) && [selection.company, selection.bound, selection.serviceType, selection.routeId].every(value => value === undefined || typeof value === 'string')) session.busSelection = selection
    }
  }
  const place = value.selectedPlace
  if (record(place) && kinds.some(kind => kind === place.kind) && string(place.id) && string(place.sourceId) && string(place.name) && (place.nameEn === undefined || string(place.nameEn)) && numberBetween(place.lat, 22, 22.7) && numberBetween(place.lng, 113.7, 114.6)) session.selectedPlace = savedPlace(place as Camera)
  if (value.openControl === 'search' || value.openControl === 'layers' || value.openControl === 'nearby') session.openControl = value.openControl
  if (value.openControl === 'rail') session.openControl = 'layers'
  if (value.transportMode === 'bus' || value.transportMode === 'rail' || value.transportMode === 'ferry' || value.transportMode === 'tram') session.transportMode = value.transportMode
  if (string(value.routeQuery, 200)) session.routeQuery = value.routeQuery
  if (Array.isArray(value.chosenBusRoutes)) session.chosenBusRoutes = value.chosenBusRoutes.slice(0, 200).flatMap((route: unknown): SavedBusRoute[] => {
    if (!record(route) || route.operator !== 'kmb' && route.operator !== 'citybus' && route.operator !== 'gmb' && route.operator !== 'nlb' || !string(route.route, 12) || !/^[A-Za-z0-9-]+$/.test(route.route) || !string(route.stopId, 20) || !/^[A-Za-z0-9]+$/.test(route.stopId) || !string(route.name) || !string(route.nameEn)) return []
    return [{ operator: route.operator, route: route.route, stopId: route.stopId, name: route.name, nameEn: route.nameEn }]
  })
  if (record(value.routeVisibility)) session.routeVisibility = Object.fromEntries(Object.entries(value.routeVisibility).flatMap(([key, on]) => /^(all:)?(bus|rail|ferry|tram)(:|$)/.test(key) && key.length <= 200 && typeof on === 'boolean' ? [[key, on] as const] : []).slice(0, 5000))
  if (value.dockGroup === 'roads' || value.dockGroup === 'conditions' || value.dockGroup === 'rail' || value.dockGroup === 'bus' || value.dockGroup === 'ferry') session.dockGroup = value.dockGroup
  for (const key of ['showDetectors', 'showBusStops', 'routeLabels', 'showNearbyOnMap', 'followLocation', 'intelOpen', 'statusExpanded'] as const) if (typeof value[key] === 'boolean') session[key] = value[key]
  if (value.intelTab === 'ranked' || value.intelTab === 'roads' || value.intelTab === 'boundary' || value.intelTab === 'weather' || value.intelTab === 'systems' || value.intelTab === 'notes') session.intelTab = value.intelTab
  if (string(value.searchQuery, 1000)) session.searchQuery = value.searchQuery
  if (value.searchScope === 'roads' || value.searchScope === 'locations') session.searchScope = value.searchScope
  if (numberBetween(value.searchPage, 0, 10000) && Number.isInteger(value.searchPage)) session.searchPage = value.searchPage
  if (record(value.routeStop) && string(value.routeStop.key, 4000) && record(value.routeStop.stop)) {
    const stop = value.routeStop.stop
    if (string(stop.id) && string(stop.nameTc) && string(stop.nameEn) && numberBetween(stop.lng, -180, 180) && numberBetween(stop.lat, -85, 85) && numberBetween(stop.seq, 1, 200) && Number.isInteger(stop.seq) && numberBetween(stop.distance, 0, 1_000_000)) {
      session.routeStop = { key: value.routeStop.key, stop: { id: stop.id, nameTc: stop.nameTc, nameEn: stop.nameEn, lat: stop.lat, lng: stop.lng, seq: stop.seq, distance: stop.distance } }
    }
  }
  if (string(value.revealedRoute, 4000)) session.revealedRoute = value.revealedRoute
  if ([500, 1000, 2000].includes(Number(value.nearbyRadius))) session.nearbyRadius = Number(value.nearbyRadius)
  return session
}

let snapshot = defaultSession
let previousRaw: string | null | undefined
let memoryOnly = false
const listeners = new Set<() => void>()
export const sessionStore = {
  getServerSnapshot: () => defaultSession,
  getSnapshot(): MapSession {
    if (typeof window === 'undefined' || memoryOnly) return snapshot
    try {
      const raw = window.localStorage.getItem(sessionStorageKey)
      if (raw !== previousRaw) {
        previousRaw = raw
        try { snapshot = raw ? parseSession(JSON.parse(raw)) : defaultSession } catch { snapshot = defaultSession }
      }
    } catch { memoryOnly = true }
    return snapshot
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    const storage = (event: StorageEvent) => { if (event.key === sessionStorageKey || event.key === null) { memoryOnly = false; listener() } }
    window.addEventListener('storage', storage)
    return () => { listeners.delete(listener); window.removeEventListener('storage', storage) }
  },
  update(change: Partial<MapSession>) {
    const current = sessionStore.getSnapshot()
    if (Object.entries(change).every(([key, value]) => current[key as keyof MapSession] === value)) return
    snapshot = { ...current, ...change }
    try {
      previousRaw = JSON.stringify(snapshot)
      window.localStorage.setItem(sessionStorageKey, previousRaw)
    } catch { memoryOnly = true }
    listeners.forEach(listener => listener())
  },
}
