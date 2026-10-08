import { loadKmbNear, loadKmbPlaces } from "./kmb-feed.ts"
import { loadCitybusNear, loadCitybusPlaces } from "./citybus-feed.ts"
import { loadGmbNear, loadGmbPlaces } from "./gmb-feed.ts"
import { loadNlbNear, loadNlbPlaces } from "./nlb-feed.ts"
import { viewportAllowed } from "./view-cache.ts"
import { ETA_FRESH_MS } from "./place-arrivals.ts"

export type DirectTransitKind = "kmb" | "citybus" | "gmb" | "nlb"
type TransitResponse = Awaited<ReturnType<typeof loadCitybusNear>>
const refreshes = new Map<DirectTransitKind, { expires: number; promise: Promise<TransitResponse> }>()

// The same bounded loaders serve browser and hosted modes. Their per-stop
// five-second clocks and shared queue protect repeated viewport movements. A
// whole-refresh budget also caps new stops discovered during rapid panning.
export async function loadDirectTransit(kind: DirectTransitKind, lng: number, lat: number, now = Date.now(), zoom = Number.NaN) {
  if (!viewportAllowed(kind, lng, lat, zoom)) return { ok: true as const, observedAt: null, stops: [] }
  const held = refreshes.get(kind)
  if (held && now < held.expires) {
    const arrivals = await held.promise
    const places = { kmb: loadKmbPlaces, citybus: loadCitybusPlaces, gmb: loadGmbPlaces, nlb: loadNlbPlaces }[kind](lng, lat, now, zoom)
    const calls = new Map(arrivals.stops.map((stop) => [stop.id, stop.calls]))
    // Show poles from the current viewport immediately. Only matching retained
    // clocks follow them; a pan must never relabel old clocks as newly observed.
    return { ...arrivals, stops: places.stops.map((stop) => ({ ...stop, calls: calls.get(stop.id) ?? [] })) }
  }
  const entry = { expires: Infinity, promise: load(kind, lng, lat, now, zoom) }
  refreshes.set(kind, entry)
  void entry.promise.then((body) => {
    entry.expires = body.ok && !body.stale && body.cacheable !== false ? now + ETA_FRESH_MS : 0
  }, () => { entry.expires = 0 })
  return entry.promise
}

async function load(kind: DirectTransitKind, lng: number, lat: number, now: number, zoom: number): Promise<TransitResponse> {
  switch (kind) {
    case "kmb": return loadKmbNear(lng, lat, now, zoom)
    case "citybus": return loadCitybusNear(lng, lat, now, zoom)
    case "gmb": return loadGmbNear(lng, lat, now, zoom)
    case "nlb": return loadNlbNear(lng, lat, now, zoom)
  }
}
