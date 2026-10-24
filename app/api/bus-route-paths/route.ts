import { loadBusRoutePaths } from '../../../lib/bus-route.ts'
import { selectionCachedGet } from '../../../lib/view-cache.ts'
import { parseBusPathRequest } from '../../../lib/bus-path-request.ts'
import type { BusRouteData } from '../../../lib/bus-route.ts'

export const GET = selectionCachedGet<{ ok: boolean; routes: BusRouteData[]; error?: string }>({
  freshMs: 24 * 60 * 60 * 1000,
  cacheKey: request => { const input = parseBusPathRequest(request); return input ? JSON.stringify(input) : null },
  load: async request => { const input = parseBusPathRequest(request); if (!input) return { ok: false, routes: [] }; return { ok: true, routes: await loadBusRoutePaths(input) } },
  invalid: () => ({ ok: false, routes: [], error: 'Invalid bus route' }),
  failed: () => ({ ok: false, routes: [], error: 'Bus route geometry unavailable' }),
})
