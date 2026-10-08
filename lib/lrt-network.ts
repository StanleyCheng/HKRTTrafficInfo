import routesFile from "../data/light-rail-routes.json" with { type: "json" }
import stationsFile from "../data/light-rail-stations.json" with { type: "json" }
import { projectTrain, type EstimateRoute, type GeoPoint, type TrainSpot } from "./mtr-estimate.ts"
import { railPoint, railSegment } from "./rail-geometry.ts"
import type { MtrTrain } from "./types.ts"

type StationRecord = { id: string; tc: string; en: string; lng: number; lat: number; aliases?: string[] }
type RoutesFile = { color: string; routes: EstimateRoute[] }

const stations = (stationsFile as { stations: StationRecord[] }).stations
const routes = routesFile as RoutesFile
let trackCollection: GeoJSON.FeatureCollection | undefined

const byId = new Map(stations.map((station) => [station.id, station]))
const byName = new Map<string, string>()
for (const station of stations) {
  byName.set(station.tc.replace(/\s/g, ""), station.id)
  byName.set(station.en.toLowerCase(), station.id)
  for (const alias of station.aliases ?? []) byName.set(alias.replace(/\s/g, ""), station.id)
}

export function lrtRoutes(): EstimateRoute[] {
  return routes.routes
}

export function lrtColor(): string {
  return routes.color
}

export function lrtStation(id: string): StationRecord | null {
  return byId.get(id) ?? null
}

export function lrtStationId(name: string): string | null {
  const key = name.replace(/\s/g, "")
  return byName.get(key) ?? byName.get(name.toLowerCase()) ?? null
}

export function lrtPoint(id: string): GeoPoint | null {
  const station = byId.get(id)
  if (!station) return null
  return { lng: station.lng, lat: station.lat }
}

export function projectLrtTrain(train: MtrTrain, atMs: number): TrainSpot | null {
  const observedAt = Date.parse(train.observedAt)
  if (!Number.isFinite(observedAt)) return null
  return projectTrain({ ...train, observedAt }, lrtPoint, atMs, (line, from, to, progress) => railPoint("lrt", line, from, to, progress))
}

export function lrtTrackCollection(): GeoJSON.FeatureCollection {
  if (trackCollection) return trackCollection
  const edges = new Map<string, [number, number][]>()
  const addEdge = (line: string, fromId: string, toId: string) => {
    const coordinates = railSegment("lrt", line, fromId, toId)
    if (!coordinates) return
    const key = JSON.stringify(fromId < toId ? coordinates : coordinates.slice().reverse())
    if (!edges.has(key)) edges.set(key, coordinates)
  }
  for (const route of routes.routes) {
    for (let index = 1; index < route.stations.length; index += 1) {
      const fromId = route.stations[index - 1]
      const toId = route.stations[index]
      if (!fromId || !toId) continue
      addEdge(route.line, fromId, toId)
    }
  }
  // Circular ETA paths end at Tin Shui Wai; also draw their departure from it.
  addEdge("705", "430", "435")
  addEdge("706", "430", "445")
  return trackCollection = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { color: routes.color },
      geometry: { type: "MultiLineString", coordinates: [...edges.values()] },
    }],
  }
}

export function lrtStationCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => ({
      type: "Feature",
      properties: { code: station.id, name: station.en, nameTc: station.tc },
      geometry: { type: "Point", coordinates: [station.lng, station.lat] },
    })),
  }
}

export function lrtRoutesThrough(stationId: string): string[] {
  const found: string[] = []
  for (const route of routes.routes) {
    if (route.stations.includes(stationId) && !found.includes(route.line)) found.push(route.line)
  }
  return found
}
