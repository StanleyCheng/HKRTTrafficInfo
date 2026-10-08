import networkFile from "../data/mtr-network.json" with { type: "json" }
import { projectTrain, type EstimateRoute, type GeoPoint, type TrainSpot } from "./mtr-estimate.ts"
import type { MtrTrain } from "./types.ts"
import { railPoint, railSegment } from "./rail-geometry.ts"

type StationRecord = { en: string; tc: string; lng: number; lat: number }
type LineRecord = { en: string; tc: string; color: string }
type NetworkFile = {
  stations: Record<string, StationRecord>
  lines: Record<string, LineRecord>
  routes: { id: string; line: string; stations: string[] }[]
}

const network = networkFile as NetworkFile
let trackCollection: GeoJSON.FeatureCollection | undefined

const linesThroughStation = new Map<string, string[]>()
for (const route of network.routes) {
  for (const code of route.stations) {
    const lines = linesThroughStation.get(code) ?? []
    if (!lines.includes(route.line)) lines.push(route.line)
    linesThroughStation.set(code, lines)
  }
}
if (network.stations.RAC && !linesThroughStation.has("RAC")) linesThroughStation.set("RAC", ["EAL"])

export function networkRoutes(): EstimateRoute[] {
  return network.routes
}

export function mtrQueries(): { line: string; station: string }[] {
  const pairs = new Map<string, { line: string; station: string }>()
  for (const route of network.routes) {
    for (const station of route.stations) {
      pairs.set(`${route.line}-${station}`, { line: route.line, station })
    }
  }
  if (network.stations.RAC) pairs.set("EAL-RAC", { line: "EAL", station: "RAC" })
  return [...pairs.values()]
}

export function stationRecord(code: string): StationRecord | null {
  return network.stations[code] ?? null
}

export function lineRecord(code: string): LineRecord | null {
  return network.lines[code] ?? null
}

export function linesThrough(station: string): string[] {
  return linesThroughStation.get(station) ?? []
}

export function stationPoint(code: string): GeoPoint | null {
  const station = network.stations[code]
  if (!station) return null
  return { lng: station.lng, lat: station.lat }
}

export function projectNetworkTrain(train: MtrTrain, atMs: number): TrainSpot | null {
  const observedAt = Date.parse(train.observedAt)
  if (!Number.isFinite(observedAt)) return null
  return projectTrain({ ...train, observedAt }, stationPoint, atMs, (line, from, to, progress) => railPoint("mtr", line, from, to, progress))
}

export function mtrTrackCollection(): GeoJSON.FeatureCollection {
  if (trackCollection) return trackCollection
  const features: GeoJSON.Feature[] = []
  for (const [line, meta] of Object.entries(network.lines)) {
    const edges = new Map<string, [number, number][]>()
    const addEdge = (fromCode: string, toCode: string) => {
      const coordinates = railSegment("mtr", line, fromCode, toCode)
      if (!coordinates) return
      const key = JSON.stringify(fromCode < toCode ? coordinates : coordinates.slice().reverse())
      if (!edges.has(key)) edges.set(key, coordinates)
    }
    for (const route of network.routes) {
      if (route.line !== line) continue
      for (let index = 1; index < route.stations.length; index += 1) {
        const fromCode = route.stations[index - 1]
        const toCode = route.stations[index]
        if (fromCode && toCode) addEdge(fromCode, toCode)
      }
    }
    if (line === "EAL") {
      addEdge("SHT", "RAC")
      addEdge("RAC", "UNI")
      addEdge("UNI", "RAC")
      addEdge("RAC", "SHT")
    }
    if (edges.size === 0) continue
    features.push({
      type: "Feature",
      properties: { line, color: meta.color },
      geometry: { type: "MultiLineString", coordinates: [...edges.values()] },
    })
  }
  return trackCollection = { type: "FeatureCollection", features }
}

export function mtrStationCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: Object.entries(network.stations).map(([code, station]) => ({
      type: "Feature",
      properties: { code, name: station.en, nameTc: station.tc },
      geometry: { type: "Point", coordinates: [station.lng, station.lat] },
    })),
  }
}
