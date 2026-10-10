import { metresBetween, type GeoPoint } from "./mtr-estimate.ts"
import piersFile from "../data/ferry-piers.json" with { type: "json" }

// shortcut: corridors are inferred from official coastlines, replace with operator sailing polylines when published.
// Source and terminal tolerances: docs/ferry-geography.md.

// A ferry cannot turn on the spot, so each corridor is rounded with a
// centripetal Catmull-Rom spline that still passes through every inferred
// bend. Legs without neighbouring bends stay exactly straight.
const CURVE_SAMPLE_METRES = 20
const CURVE_STRAIGHT_METRES = 0.5

const reflect = (about: GeoPoint, away: GeoPoint): GeoPoint => ({ lng: 2 * about.lng - away.lng, lat: 2 * about.lat - away.lat })

// Perpendicular distance in metres from `point` to the line through `a` and `b`.
function offTrackMetres(a: GeoPoint, b: GeoPoint, point: GeoPoint): number {
  const metresPerLat = 111_320
  const metresPerLng = metresPerLat * Math.cos((a.lat * Math.PI) / 180)
  const dx = (b.lng - a.lng) * metresPerLng
  const dy = (b.lat - a.lat) * metresPerLat
  const length = Math.hypot(dx, dy)
  if (length === 0) return metresBetween(a, point)
  return Math.abs((point.lng - a.lng) * metresPerLng * dy - (point.lat - a.lat) * metresPerLat * dx) / length
}

const lerpPoint = (a: GeoPoint, b: GeoPoint, from: number, to: number, at: number): GeoPoint => {
  const mix = (at - from) / (to - from)
  return { lng: a.lng + (b.lng - a.lng) * mix, lat: a.lat + (b.lat - a.lat) * mix }
}

// Barry-Goldman centripetal Catmull-Rom over one knot interval [t1, t2].
function curvePoint(p0: GeoPoint, p1: GeoPoint, p2: GeoPoint, p3: GeoPoint, t0: number, t1: number, t2: number, t3: number, at: number): GeoPoint {
  const a1 = lerpPoint(p0, p1, t0, t1, at)
  const a2 = lerpPoint(p1, p2, t1, t2, at)
  const a3 = lerpPoint(p2, p3, t2, t3, at)
  const b1 = lerpPoint(a1, a2, t0, t2, at)
  const b2 = lerpPoint(a2, a3, t1, t3, at)
  return lerpPoint(b1, b2, t1, t2, at)
}

// The corridor knots are emitted verbatim (piers and inferred bends); the
// spline only adds interior points around bends, rounded to pier precision.
function smoothFairway(corridor: readonly GeoPoint[]): GeoPoint[] {
  const points = corridor.filter((point, index) => index === 0 || metresBetween(corridor[index - 1]!, point) >= 1)
  if (points.length < 3) return [...points]
  const path: GeoPoint[] = []
  for (let index = 0; index + 1 < points.length; index += 1) {
    const p1 = points[index]!
    const p2 = points[index + 1]!
    path.push(p1)
    const p0 = points[index - 1] ?? reflect(p1, p2)
    const p3 = points[index + 2] ?? reflect(p2, p1)
    // Only neighbouring bends curve a leg; without them it stays a straight line.
    if (offTrackMetres(p1, p2, p0) < CURVE_STRAIGHT_METRES && offTrackMetres(p1, p2, p3) < CURVE_STRAIGHT_METRES) continue
    const t1 = Math.sqrt(Math.max(metresBetween(p0, p1), 1e-6))
    const t2 = t1 + Math.sqrt(Math.max(metresBetween(p1, p2), 1e-6))
    const t3 = t2 + Math.sqrt(Math.max(metresBetween(p2, p3), 1e-6))
    const steps = Math.max(2, Math.ceil(metresBetween(p1, p2) / CURVE_SAMPLE_METRES))
    for (let step = 1; step < steps; step += 1) {
      const point = curvePoint(p0, p1, p2, p3, 0, t1, t2, t3, t1 + ((t2 - t1) * step) / steps)
      path.push({ lng: Math.round(point.lng * 1e6) / 1e6, lat: Math.round(point.lat * 1e6) / 1e6 })
    }
  }
  path.push(points[points.length - 1]!)
  return path
}

const HARBOUR_WEST: GeoPoint[] = [
  { lng: 114.148, lat: 22.294 },
  { lng: 114.128, lat: 22.293 },
  { lng: 114.116, lat: 22.29 },
  { lng: 114.108, lat: 22.288 },
  { lng: 114.108, lat: 22.277 },
]

const WEST_OF_ISLAND: GeoPoint[] = [
  { lng: 114.108, lat: 22.268 },
  { lng: 114.104, lat: 22.25 },
]

const CHEUNG_CHAU_APPROACH: GeoPoint[] = [
  { lng: 114.02, lat: 22.2105 },
  { lng: 114.022, lat: 22.2094 },
  { lng: 114.025, lat: 22.209 },
  { lng: 114.0283, lat: 22.20895 },
]

const FAIRWAY: Record<string, GeoPoint[]> = {
  "hkkf-central|hkkf-yung-shue-wan": [
    { lng: 114.158, lat: 22.2884 },
    { lng: 114.1589, lat: 22.29 },
    ...HARBOUR_WEST,
    ...WEST_OF_ISLAND,
    { lng: 114.098, lat: 22.234 },
  ],
  "hkkf-central|hkkf-sok-kwu-wan": [
    { lng: 114.158, lat: 22.2884 },
    { lng: 114.1589, lat: 22.29 },
    ...HARBOUR_WEST,
    { lng: 114.108, lat: 22.268 },
    { lng: 114.112, lat: 22.252 },
    { lng: 114.131, lat: 22.245 },
    { lng: 114.143, lat: 22.229 },
    { lng: 114.147, lat: 22.216 },
    { lng: 114.14, lat: 22.212 },
    { lng: 114.135, lat: 22.211 },
  ],
  "hkkf-central-6|hkkf-peng-chau": [
    { lng: 114.1608, lat: 22.2875 },
    { lng: 114.1607, lat: 22.2895 },
    { lng: 114.148, lat: 22.292 },
    { lng: 114.12, lat: 22.291 },
    { lng: 114.07, lat: 22.298 },
    { lng: 114.055, lat: 22.298 },
    { lng: 114.036, lat: 22.297 },
    { lng: 114.031, lat: 22.292 },
    { lng: 114.031, lat: 22.287 },
    { lng: 114.033, lat: 22.283 },
  ],
  "sun-central|sun-cheung-chau": [
    { lng: 114.1599, lat: 22.288 },
    { lng: 114.1597, lat: 22.2895 },
    ...HARBOUR_WEST,
    ...WEST_OF_ISLAND,
    { lng: 114.07, lat: 22.23 },
    { lng: 114.042, lat: 22.229 },
    { lng: 114.024, lat: 22.222 },
    { lng: 114.02, lat: 22.216 },
    ...CHEUNG_CHAU_APPROACH,
  ],
  "hkkf-central-6|sun-mui-wo": [
    { lng: 114.1608, lat: 22.2875 },
    { lng: 114.1607, lat: 22.2895 },
    { lng: 114.148, lat: 22.292 },
    { lng: 114.12, lat: 22.291 },
    { lng: 114.07, lat: 22.278 },
    { lng: 114.04, lat: 22.272 },
    { lng: 114.024, lat: 22.264 },
    { lng: 114.008, lat: 22.264 },
  ],
  "hkkf-peng-chau|sun-mui-wo": [
    { lng: 114.033, lat: 22.283 },
    { lng: 114.03, lat: 22.276 },
    { lng: 114.026, lat: 22.27 },
    { lng: 114.027, lat: 22.264 },
    { lng: 114.008, lat: 22.264 },
  ],
  "sun-mui-wo|sun-chi-ma-wan": [
    { lng: 114.008, lat: 22.264 },
    { lng: 114.016, lat: 22.257 },
    { lng: 114.015, lat: 22.249 },
    { lng: 114.007, lat: 22.242 },
  ],
  "sun-cheung-chau|sun-mui-wo": [
    ...[...CHEUNG_CHAU_APPROACH].reverse(),
    { lng: 114.02, lat: 22.216 },
    { lng: 114.024, lat: 22.225 },
    { lng: 114.022, lat: 22.243 },
    { lng: 114.02, lat: 22.262 },
    { lng: 114.008, lat: 22.264 },
  ],
  "hkkf-peng-chau|hkkf-hei-ling-chau": [
    { lng: 114.033, lat: 22.283 },
    { lng: 114.027, lat: 22.273 },
    { lng: 114.0242, lat: 22.266 },
    { lng: 114.023, lat: 22.263 },
  ],
  "sun-chi-ma-wan|sun-cheung-chau": [
    { lng: 114.006, lat: 22.239 },
    { lng: 114.02, lat: 22.241 },
    { lng: 114.024, lat: 22.225 },
    { lng: 114.02, lat: 22.216 },
    ...CHEUNG_CHAU_APPROACH,
  ],
  "sun-north-point|sun-hung-hom": [],
  "sun-north-point|sun-kowloon-city": [
    { lng: 114.198, lat: 22.295 },
    { lng: 114.1945, lat: 22.314 },
    { lng: 114.194277, lat: 22.3165 },
  ],
  "star-central|star-tst": [
    { lng: 114.162, lat: 22.2875 },
  ],
  "star-wanchai|star-tst": [
    { lng: 114.177, lat: 22.2838 },
    { lng: 114.1763, lat: 22.2865 },
    { lng: 114.1678, lat: 22.2925 },
  ],
  "fortune-north-point|fortune-kwun-tong": [
    { lng: 114.206, lat: 22.298 },
    { lng: 114.221, lat: 22.302 },
  ],
  "fortune-kwun-tong|fortune-kai-tak": [
    { lng: 114.2206, lat: 22.3068 },
    { lng: 114.2183, lat: 22.3065 },
    { lng: 114.2165, lat: 22.3095 },
    { lng: 114.214, lat: 22.3104 },
  ],
}

export function ferryFairway(fromId: string, toId: string, from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const forward = FAIRWAY[`${fromId}|${toId}`]
  if (forward) return smoothFairway([from, ...forward, to])
  const back = FAIRWAY[`${toId}|${fromId}`]
  if (back) return smoothFairway([to, ...back, from]).reverse()
  return [from, to]
}

export function ferryPaths(): { id: string; pathLng: number[]; pathLat: number[] }[] {
  return Object.keys(FAIRWAY).map((key) => {
    const [fromId, toId] = key.split("|")
    const from = piersFile.piers.find((pier) => pier.id === fromId)!
    const to = piersFile.piers.find((pier) => pier.id === toId)!
    const path = ferryFairway(fromId, toId, from, to)
    return { id: `ferry-${fromId}-${toId}`, pathLng: path.map((point) => point.lng), pathLat: path.map((point) => point.lat) }
  })
}
