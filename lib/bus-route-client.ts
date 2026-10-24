import { staticExport } from './traffic.ts'
import type { BusRouteResponse, BusRouteSelection, BusStopArrivalsResponse } from './bus-route.ts'
import { waitForRequest } from './request-wait.ts'
import type { BusPathRequest } from './transport-routes.ts'
import type { BusRouteData } from './bus-route.ts'

type BusRoutePath = Pick<BusRouteData, 'key' | 'operator' | 'coordinates' | 'geometry'>
const isBusRoutePath = (value: unknown): value is BusRoutePath => {
  if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' || !('operator' in value) || !['kmb', 'citybus', 'gmb', 'nlb'].includes(String(value.operator)) || !('geometry' in value) || value.geometry !== 'road' && value.geometry !== 'stops' || !('coordinates' in value) || !Array.isArray(value.coordinates)) return false
  return value.coordinates.length > 1 && value.coordinates.every(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n)))
}
export async function getBusRoutePaths(request: BusPathRequest, signal: AbortSignal): Promise<BusRoutePath[]> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(55_000)])
  requestSignal.throwIfAborted()
  if (staticExport) {
    const { loadBusRoutePaths } = await import('./bus-route.ts')
    return waitForRequest(loadBusRoutePaths(request), requestSignal)
  }
  const params = new URLSearchParams(Object.entries(request.tracking ?? { operator: request.operator, route: request.route, stopId: request.stopId }).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/bus-route-paths?${params}`, { signal: requestSignal })
  if (!response.ok) throw new Error('Bus route geometry unavailable')
  const body = await response.json()
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true || !('routes' in body) || !Array.isArray(body.routes) || !body.routes.length || !body.routes.every(isBusRoutePath)) throw new Error('Bus route geometry unavailable')
  return body.routes
}

export async function getBusRoute(selection: BusRouteSelection, signal?: AbortSignal): Promise<BusRouteResponse> {
  const timeout = AbortSignal.timeout(55_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  if (staticExport) {
    const { loadBusRoute } = await import('./bus-route.ts')
    requestSignal.throwIfAborted()
    return waitForRequest(loadBusRoute(selection), requestSignal)
  }
  const params = new URLSearchParams(Object.entries(selection).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/bus-route?${params}`, { cache: 'no-store', signal: requestSignal })
  if (!response.ok) throw new Error('Bus route unavailable')
  return response.json() as Promise<BusRouteResponse>
}

export async function getBusStopArrivals(selection: BusRouteSelection, signal?: AbortSignal): Promise<BusStopArrivalsResponse> {
  const timeout = AbortSignal.timeout(55_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  if (staticExport) {
    const { loadBusStopArrivals } = await import('./bus-route.ts')
    requestSignal.throwIfAborted()
    // The upstream producer is shared; cancel only this popup's wait.
    return waitForRequest(loadBusStopArrivals(selection), requestSignal)
  }
  const params = new URLSearchParams(Object.entries(selection).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))
  params.set('stopArrivals', '1')
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/bus-route?${params}`, { cache: 'no-store', signal: requestSignal })
  if (!response.ok) throw new Error('Stop arrivals unavailable')
  return response.json() as Promise<BusStopArrivalsResponse>
}
