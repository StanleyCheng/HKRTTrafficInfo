import { arrivalExpired } from './place-arrivals.ts'
import { feedMaxAgeMs, type Arrival, type Camera } from './traffic.ts'

/** Retained places remain useful after their live arrival observations expire. */
export function currentArrivals(camera: Camera, now: number): Arrival[] {
  return (camera.arrivals ?? []).filter(call => {
    const observed = Date.parse(call.observedAt ?? camera.dataUpdated ?? '')
    if (!Number.isFinite(observed) || observed > now + 30_000 || now - observed > feedMaxAgeMs(camera.kind)) return false
    const eta = Date.parse(call.eta ?? '')
    return !arrivalExpired(eta, now)
  })
}
