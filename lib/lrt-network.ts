import routesFile from "../data/light-rail-routes.json" with { type: "json" }
import stationsFile from "../data/light-rail-stations.json" with { type: "json" }
import type { EstimateRoute, GeoPoint } from "./mtr-estimate.ts"

type StationRecord = { id: string; tc: string; en: string; lng: number; lat: number; aliases?: string[] }
type RoutesFile = { color: string; routes: EstimateRoute[] }

const stations = (stationsFile as { stations: StationRecord[] }).stations
const routes = routesFile as RoutesFile

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

export function lrtTrackCollection(): GeoJSON.FeatureCollection {
  const edges = new Map<string, [number, number][]>()
  for (const route of routes.routes) {
    for (let index = 1; index < route.stations.length; index += 1) {
      const fromId = route.stations[index - 1]
      const toId = route.stations[index]
      if (!fromId || !toId) continue
      const from = lrtPoint(fromId)
      const to = lrtPoint(toId)
      if (!from || !to) continue
      const key = [fromId, toId].sort().join(">")
      if (!edges.has(key)) edges.set(key, [[from.lng, from.lat], [to.lng, to.lat]])
    }
  }
  return {
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
