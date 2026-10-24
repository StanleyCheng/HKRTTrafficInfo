import { parseBusPathRequest } from '../../../lib/bus-path-request.ts'
import { loadBusRouteVehicles } from '../../../lib/bus-route.ts'
import { loadMtrBusRoute } from '../../../lib/mtr-bus-feed.ts'
import { layers } from '../../../lib/traffic.ts'
import { ETA_KEEP_MS } from '../../../lib/place-arrivals.ts'
import { selectionCachedGet } from '../../../lib/view-cache.ts'
import type { RouteVehicleSnapshot } from '../../../lib/route-vehicles.ts'

function parse(request: Request) {
  const query = new URL(request.url).searchParams
  if (query.get('operator') === 'mtr-bus') {
    const route = query.get('route')
    return route && /^[A-Za-z0-9-]{1,12}$/.test(route) ? { kind: 'mtr-bus' as const, route } : null
  }
  const bus = parseBusPathRequest(request)
  return bus ? { kind: 'bus' as const, bus } : null
}
type Body = { ok: boolean; snapshot?: RouteVehicleSnapshot; observedAt?: string | null; stale?: boolean; error?: string }
export const GET = selectionCachedGet<Body>({
  freshMs: 5_000, keepMs: ETA_KEEP_MS,
  cacheKey: request => { const input = parse(request); return input ? JSON.stringify(input) : null },
  load: async (request, now) => {
    const input = parse(request)
    if (!input) return { ok: false, error: 'Invalid route' }
    if (input.kind === 'bus') {
      const data = await loadBusRouteVehicles(input.bus, now)
      return { ok: data.ok, snapshot: { kind: 'bus', data }, observedAt: data.observedAt, stale: data.stale, error: data.error }
    }
    const feed = await loadMtrBusRoute(input.route, now)
    const data = { ...feed, count: feed.cameras.length, expectedCount: feed.cameras.length, fetchedAt: new Date(now).toISOString(), sourceLastModified: null, source: layers['mtr-bus'].source, complete: !feed.stale }
    return { ok: true, snapshot: { kind: 'mtr-bus', data }, observedAt: data.observedAt, stale: data.stale }
  },
  invalid: () => ({ ok: false, error: 'Invalid route' }),
  failed: () => ({ ok: false, error: 'Vehicle positions unavailable' }),
})
