import type { GeoPoint } from "./mtr-estimate.ts"

// The straight line from Central to Lamma or Cheung Chau crosses Hong Kong Island.
// These bends stay in the harbour, Sulphur Channel, and the Lamma channels.
const HARBOUR_WEST: GeoPoint[] = [
  { lng: 114.148, lat: 22.2915 },
  { lng: 114.128, lat: 22.2895 },
  { lng: 114.116, lat: 22.2845 },
]

const WEST_OF_ISLAND: GeoPoint[] = [
  { lng: 114.108, lat: 22.268 },
  { lng: 114.104, lat: 22.25 },
]

const FAIRWAY: Record<string, GeoPoint[]> = {
  "hkkf-central|hkkf-yung-shue-wan": [
    ...HARBOUR_WEST,
    ...WEST_OF_ISLAND,
    { lng: 114.098, lat: 22.234 },
  ],
  "hkkf-central|hkkf-sok-kwu-wan": [
    ...HARBOUR_WEST,
    ...WEST_OF_ISLAND,
    { lng: 114.125, lat: 22.232 },
    { lng: 114.155, lat: 22.218 },
    { lng: 114.142, lat: 22.198 },
  ],
  "hkkf-central-6|hkkf-peng-chau": [
    { lng: 114.148, lat: 22.292 },
    { lng: 114.12, lat: 22.291 },
    { lng: 114.07, lat: 22.29 },
    { lng: 114.05, lat: 22.287 },
  ],
  "sun-central|sun-cheung-chau": [
    ...HARBOUR_WEST,
    ...WEST_OF_ISLAND,
    { lng: 114.07, lat: 22.23 },
    { lng: 114.045, lat: 22.215 },
  ],
  "sun-central|sun-mui-wo": [
    { lng: 114.148, lat: 22.292 },
    { lng: 114.12, lat: 22.291 },
    { lng: 114.07, lat: 22.278 },
    { lng: 114.04, lat: 22.272 },
    { lng: 114.015, lat: 22.268 },
  ],
  "hkkf-peng-chau|sun-mui-wo": [
    { lng: 114.048, lat: 22.275 },
    { lng: 114.025, lat: 22.27 },
  ],
  "sun-mui-wo|sun-chi-ma-wan": [
    { lng: 114.018, lat: 22.255 },
  ],
  "sun-cheung-chau|sun-mui-wo": [
    { lng: 114.035, lat: 22.235 },
    { lng: 114.028, lat: 22.255 },
  ],
  "hkkf-peng-chau|hkkf-hei-ling-chau": [
    { lng: 114.042, lat: 22.272 },
  ],
}

export function ferryFairway(fromId: string, toId: string, from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const forward = FAIRWAY[`${fromId}|${toId}`]
  if (forward) return [from, ...forward, to]
  const back = FAIRWAY[`${toId}|${fromId}`]
  if (back) return [from, ...[...back].reverse(), to]
  return [from, to]
}
