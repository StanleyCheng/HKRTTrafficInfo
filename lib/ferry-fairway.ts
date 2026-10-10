import type { GeoPoint } from "./mtr-estimate.ts"
import piersFile from "../data/ferry-piers.json" with { type: "json" }

// shortcut: corridors are inferred from official coastlines, replace with operator sailing polylines when published.
// Source and terminal tolerances: docs/ferry-geography.md.
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
  if (forward) return [from, ...forward, to]
  const back = FAIRWAY[`${toId}|${fromId}`]
  if (back) return [from, ...[...back].reverse(), to]
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
