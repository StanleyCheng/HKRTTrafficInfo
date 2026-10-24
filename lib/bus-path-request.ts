import { validBusSelection } from './bus-selection.ts'
import type { BusRouteSelection } from './bus-route.ts'
import type { BusPathRequest } from './transport-routes.ts'

export function parseBusPathRequest(request: Request): BusPathRequest | null {
  const query = new URL(request.url).searchParams
  const operator = query.get('operator'), route = query.get('route'), stopId = query.get('stopId')
  if (operator !== 'kmb' && operator !== 'citybus' && operator !== 'gmb' && operator !== 'nlb') return null
  if (!route || !/^[A-Za-z0-9-]{1,12}$/.test(route) || !stopId || !/^[A-Za-z0-9]{1,20}$/.test(stopId)) return null
  if (query.has('bound') || query.has('routeId')) {
    const bound = query.get('bound'), company = query.get('company')
    if (bound !== null && bound !== 'I' && bound !== 'O' || company !== null && company !== 'KMB' && company !== 'LWB') return null
    const tracking: BusRouteSelection = { operator, route, stopId,
      ...(bound ? { bound } : {}), ...(company ? { company } : {}),
      ...(query.has('serviceType') ? { serviceType: query.get('serviceType') ?? '' } : {}),
      ...(query.has('routeId') ? { routeId: query.get('routeId') ?? '' } : {}),
      ...(query.has('routeSeq') ? { routeSeq: Number(query.get('routeSeq')) } : {}),
    }
    if (!validBusSelection(tracking)) return null
    return { operator, route, stopId, tracking }
  }
  return { operator, route, stopId }
}
