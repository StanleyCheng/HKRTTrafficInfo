import { routeDistances, routePointAtDistance } from './bus-route-motion.ts'
import type { BusRouteSelection, BusRouteStop } from './bus-route.ts'

type Point = [number, number]
type Candidate = { relation: number; version: number; paths: Point[][] }
type Match = { coordinates: Point[]; stopDistances: number[]; score: number; source: 'osm'; relation: number }
type Projection = { distance: number; error: number; index: number; point: Point; score: number; previous: Projection | null }

// The source relation is community-mapped, so accept only continuous, directed
// paths matching every published stop in order. A match is not an official route.
export function matchCitybusOsmPath(path: Point[], stops: BusRouteStop[]): Omit<Match, 'source' | 'relation'> | null {
  if (path.length < 2 || stops.length < 2 || path.length > 100_000 || path.some(point => !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 113 || point[0] > 115 || point[1] < 22 || point[1] > 23)) return null
  const distances = routeDistances(path)
  let states: Projection[] = []
  for (const [stopIndex, stop] of stops.entries()) {
    const cos = Math.cos(stop.lat * Math.PI / 180), next: Projection[] = []
    const previousStop = stops[stopIndex - 1]
    const maxAdvance = previousStop ? Math.max(1200, routeDistances([[previousStop.lng, previousStop.lat], [stop.lng, stop.lat]])[1] * 4) : Infinity
    // Keep the lowest-scoring preceding projection within the permitted
    // distance window. A cheaper occurrence earlier on a loop may be too far
    // away even though a later occurrence provides a valid match.
    const candidates: Projection[] = []
    let head = 0, previousIndex = 0
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], x = (b[0] - a[0]) * cos, y = b[1] - a[1], length = x * x + y * y
      const t = length ? Math.max(0, Math.min(1, (((stop.lng - a[0]) * cos) * x + (stop.lat - a[1]) * y) / length)) : 0
      const point: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
      const error = routeDistances([[stop.lng, stop.lat], point])[1]
      if (error > 65) continue
      const distance = distances[i - 1] + t * (distances[i] - distances[i - 1])
      while (previousIndex < states.length && states[previousIndex].distance <= distance) {
        const state = states[previousIndex++]
        while (candidates.length > head && candidates.at(-1)!.score >= state.score) candidates.pop()
        candidates.push(state)
      }
      while (head < candidates.length && candidates[head].distance < distance - maxAdvance) head++
      const best = candidates[head] ?? null
      if (states.length && !best) continue
      next.push({ distance, error, index: i - 1, point, score: error + (best?.score ?? 0), previous: best })
    }
    if (!next.length) return null
    states = next
  }
  const selected: Projection[] = []
  let state: Projection | null = states.reduce((a, b) => a.score <= b.score ? a : b)
  while (state) { selected.push(state); state = state.previous }
  selected.reverse()
  if (selected.length !== stops.length) return null
  const first = selected[0], last = selected.at(-1)!
  if (last.distance - first.distance < 1) return null
  for (let i = 1; i < selected.length; i++) {
    const direct = routeDistances([[stops[i - 1].lng, stops[i - 1].lat], [stops[i].lng, stops[i].lat]])[1]
    if (selected[i].distance - selected[i - 1].distance > Math.max(1200, direct * 4)) return null
  }
  const coordinates: Point[] = [first.point, ...path.slice(first.index + 1, last.index + 1), last.point]
  return { coordinates, stopDistances: selected.map(point => point.distance - first.distance), score: selected.reduce((sum, point) => sum + point.error, 0) / selected.length }
}

// Similar stops can belong to distinct service variants. Do not choose a
// candidate solely because its stops are a few metres closer when another
// matching relation takes a materially different road between those stops.
export function sameCitybusAlignment(a: Point[], b: Point[]): boolean {
  const closeTo = (from: Point[], to: Point[]) => {
    const distances = routeDistances(from), total = distances.at(-1)!
    const step = Math.max(100, total / 600)
    for (let at = 0; at <= total + step; at += step) {
      const point = routePointAtDistance(from, distances, Math.min(at, total))!
      const cos = Math.cos(point[1] * Math.PI / 180)
      let nearest = Infinity
      for (let i = 1; i < to.length; i++) {
        const start = to[i - 1], end = to[i], x = (end[0] - start[0]) * cos, y = end[1] - start[1], norm = x * x + y * y
        const ratio = norm ? Math.max(0, Math.min(1, (((point[0] - start[0]) * cos) * x + (point[1] - start[1]) * y) / norm)) : 0
        const distance = Math.hypot((point[0] - start[0]) * cos - ratio * x, point[1] - start[1] - ratio * y) * 111_195
        if (distance < nearest) nearest = distance
        if (nearest <= 30) break
      }
      if (nearest > 30) return false
    }
    return true
  }
  return closeTo(a, b) && closeTo(b, a)
}

export function matchCitybusOsmCandidates(candidates: Candidate[], stops: BusRouteStop[]): Match | null {
    const matches: Match[] = []
    for (const candidate of candidates) for (const path of candidate.paths) {
      const result = matchCitybusOsmPath(path, stops)
      if (result) matches.push({ ...result, source: 'osm', relation: candidate.relation })
    }
    matches.sort((a, b) => a.score - b.score)
    const best = matches[0]
    return best && matches.every(match => sameCitybusAlignment(best.coordinates, match.coordinates)) ? best : null
}

export async function citybusOsmGeometry(selection: BusRouteSelection, stops: BusRouteStop[]): Promise<Match | null> {
  if (selection.operator !== 'citybus' || !/^[A-Z0-9-]{1,12}$/i.test(selection.route)) return null
  const code = selection.route.toUpperCase(), prefix = code[0]
  try {
    const bucket = await import(`../data/citybus-osm/${prefix}.json`, { with: { type: 'json' } })
    const candidates = (bucket.default as Record<string, Candidate[]>)[code] ?? []
    return matchCitybusOsmCandidates(candidates, stops)
  } catch {
    return null
  }
}
