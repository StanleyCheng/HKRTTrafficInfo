import { loadBusRoute, loadBusStopArrivals, validBusSelection, type BusRouteSelection, type BusRouteResponse, type BusStopArrivalsResponse } from '../../../lib/bus-route.ts'
import { selectionCachedGet } from '../../../lib/view-cache.ts'

const EMPTY_ROUTE = (error: string): BusRouteResponse => ({ ok: false, error, vehicle: null, observedAt: null, stale: false })

function parseSelection(request: Request): { stopArrivals: boolean; selection: BusRouteSelection } | null {
  const query = new URL(request.url).searchParams
  const stopArrivals = query.get('stopArrivals') === '1'
  query.delete('stopArrivals')
  const selection = Object.fromEntries(query) as unknown as BusRouteSelection
  if (query.has('routeSeq')) selection.routeSeq = Number(query.get('routeSeq'))
  if (query.has('stopSeq')) selection.stopSeq = Number(query.get('stopSeq'))
  if (!validBusSelection(selection, stopArrivals && selection.operator === 'gmb')) return null
  return { stopArrivals, selection }
}

function selectionKey(stopArrivals: boolean, s: BusRouteSelection): string {
  return [
    stopArrivals ? 'arr' : 'route',
    s.operator,
    s.route,
    s.stopId,
    s.bound ?? '',
    s.serviceType ?? '',
    s.routeId ?? '',
    s.routeSeq ?? '',
    s.stopSeq ?? '',
    s.company ?? '',
  ].join('|')
}

export const GET = selectionCachedGet<BusRouteResponse | BusStopArrivalsResponse>({
  freshMs: 10_000,
  cacheKey: (request) => {
    const parsed = parseSelection(request)
    return parsed ? selectionKey(parsed.stopArrivals, parsed.selection) : null
  },
  load: async (request) => {
    const parsed = parseSelection(request)
    // parseSelection already validated inside cacheKey; this is unreachable but keeps TS happy.
    if (!parsed) return EMPTY_ROUTE('Invalid bus route selection') as BusRouteResponse | BusStopArrivalsResponse
    return parsed.stopArrivals
      ? await loadBusStopArrivals(parsed.selection)
      : await loadBusRoute(parsed.selection)
  },
  invalid: () => EMPTY_ROUTE('Invalid bus route selection'),
  failed: (error) => EMPTY_ROUTE(error instanceof Error ? error.message : 'Bus route unavailable'),
})

