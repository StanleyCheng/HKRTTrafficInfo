import coast from "./fixtures/ferry-coastline.json" with { type: "json" }
import { metresBetween, type GeoPoint } from "../lib/mtr-estimate.ts"

const edges = coast.polygons.flatMap(polygon => polygon.flatMap(ring => ring.slice(1).map((point, index) => [ring[index]!, point] as const)))

function inRing(point: GeoPoint, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!
    if ((a[1]! > point.lat) !== (b[1]! > point.lat)
      && point.lng < (b[0]! - a[0]!) * (point.lat - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside
  }
  return inside
}

export function inSea(point: GeoPoint): boolean {
  if (point.lng < coast.bounds[0]! || point.lng > coast.bounds[2]! || point.lat < coast.bounds[1]! || point.lat > coast.bounds[3]!) return false
  return coast.polygons.some(polygon => inRing(point, polygon[0]!) && !polygon.slice(1).some(ring => inRing(point, ring)))
}

export function landSamples(path: readonly GeoPoint[]): GeoPoint[] {
  const lengths = path.slice(1).map((point, index) => metresBetween(path[index]!, point))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const land: GeoPoint[] = []
  let walked = 0
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]!, to = path[index]!, length = lengths[index - 1]!
    const steps = Math.ceil(length / 5)
    for (let step = 0; step <= steps; step++) {
      const fraction = steps ? step / steps : 0
      const progress = walked + fraction * length
      // Pier decks can be classified as land; only the first/last 35 m are exempt.
      if (progress <= 35 || total - progress <= 35) continue
      const point = { lng: from.lng + (to.lng - from.lng) * fraction, lat: from.lat + (to.lat - from.lat) * fraction }
      if (!inSea(point)) land.push(point)
    }
    // Split at every coastline crossing: a narrow rock can fall between samples.
    const start = Math.max(0, (35 - walked) / length), end = Math.min(1, (total - 35 - walked) / length)
    if (length > 0 && start < end) {
      const cuts = [start, end]
      const dx = to.lng - from.lng, dy = to.lat - from.lat
      for (const [a, b] of edges) {
        if (Math.max(a[0]!, b[0]!) < Math.min(from.lng, to.lng) || Math.min(a[0]!, b[0]!) > Math.max(from.lng, to.lng)
          || Math.max(a[1]!, b[1]!) < Math.min(from.lat, to.lat) || Math.min(a[1]!, b[1]!) > Math.max(from.lat, to.lat)) continue
        const sx = b[0]! - a[0]!, sy = b[1]! - a[1]!, determinant = dx * sy - dy * sx
        if (Math.abs(determinant) < 1e-15) continue
        const ax = a[0]! - from.lng, ay = a[1]! - from.lat
        const fraction = (ax * sy - ay * sx) / determinant, edgeFraction = (ax * dy - ay * dx) / determinant
        if (fraction > start && fraction < end && edgeFraction >= 0 && edgeFraction <= 1) cuts.push(fraction)
      }
      cuts.sort((a, b) => a - b)
      for (let cut = 1; cut < cuts.length; cut++) {
        if (cuts[cut]! - cuts[cut - 1]! < 1e-12) continue
        const fraction = (cuts[cut]! + cuts[cut - 1]!) / 2
        const point = { lng: from.lng + dx * fraction, lat: from.lat + dy * fraction }
        if (!inSea(point)) land.push(point)
      }
    }
    walked += length
  }
  return land
}
