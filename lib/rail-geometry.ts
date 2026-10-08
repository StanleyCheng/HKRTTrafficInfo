import geometryFile from "../data/rail-geometry.json" with { type: "json" }
import { routeDistances, routePointAtDistance } from "./bus-route-motion.ts"
import type { GeoPoint } from "./mtr-estimate.ts"

type Point = [number, number]
type RailKind = "mtr" | "lrt"
type RailGeometry = { mtr: Record<string, Point[]>; lrt: Record<string, Point[]> }
export type RailPosition = { key: string; distance: number; coordinates: Point[]; distances: number[] }
type RailPath = Omit<RailPosition, "distance"> & { stationDistances: number[] }

// The importer and geometry check validate the JSON's WGS84 coordinate pairs.
const geometry = geometryFile as unknown as RailGeometry
const segments = new Map<string, { coordinates: Point[]; distances: number[] }>()
const paths = new Map<string, RailPath | null>()

export function railSegment(kind: RailKind, line: string, from: string, to: string): Point[] | null {
  const key = `${line}:${from}>${to}`
  const cacheKey = `${kind}:${key}`
  const cached = segments.get(cacheKey)
  if (cached) return cached.coordinates
  const coordinates = geometry[kind][key]
  if (!coordinates || coordinates.length < 2) return null
  segments.set(cacheKey, { coordinates, distances: routeDistances(coordinates) })
  return coordinates
}

export function railPoint(kind: RailKind, line: string, from: string, to: string, progress: number): GeoPoint | null {
  const coordinates = railSegment(kind, line, from, to)
  if (!coordinates || !Number.isFinite(progress)) return null
  const key = `${line}:${from}>${to}`
  const distances = segments.get(`${kind}:${key}`)!.distances
  const point = routePointAtDistance(coordinates, distances, Math.max(0, Math.min(1, progress)) * distances.at(-1)!)
  return point ? { lng: point[0], lat: point[1] } : null
}

export function railPosition(kind: RailKind, line: string, stations: string[], from: string, to: string, progress: number): RailPosition | null {
  if (!Number.isFinite(progress)) return null
  const key = `${kind}:${line}:${stations.join(">")}`
  let path = paths.get(key)
  if (path === undefined) {
    const coordinates: Point[] = []
    const distances: number[] = []
    const stationDistances = [0]
    for (let index = 1; index < stations.length; index++) {
      const segment = railSegment(kind, line, stations[index - 1], stations[index])
      if (!segment) { paths.set(key, null); return null }
      const last = coordinates.at(-1)
      if (last && (last[0] !== segment[0][0] || last[1] !== segment[0][1])) { paths.set(key, null); return null }
      const segmentDistances = routeDistances(segment)
      const offset = distances.at(-1) ?? 0
      const skip = coordinates.length ? 1 : 0
      coordinates.push(...segment.slice(skip))
      distances.push(...segmentDistances.slice(skip).map(distance => offset + distance))
      stationDistances.push(distances.at(-1) ?? 0)
    }
    path = coordinates.length > 1 ? { key, coordinates, distances, stationDistances } : null
    paths.set(key, path)
  }
  if (!path) return null
  const index = stations.indexOf(from)
  if (index < 0 || (from !== to && stations[index + 1] !== to)) return null
  const start = path.stationDistances[index]
  const end = from === to ? start : path.stationDistances[index + 1]
  return { key, distance: start + (end - start) * Math.max(0, Math.min(1, progress)), coordinates: path.coordinates, distances: path.distances }
}
