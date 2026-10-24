import { staticExport } from './traffic.ts'
import type { BusRouteResponse, BusRouteSelection, BusStopArrivalsResponse } from './bus-route.ts'
import { waitForRequest } from './request-wait.ts'
import type { BusPathRequest } from './transport-routes.ts'
import type { BusRouteData } from './bus-route.ts'
import { isBusRouteData } from './route-vehicle-response.ts'
import { readRouteVehicleSnapshot } from './route-vehicle-response.ts'
import type { RouteVehicleSnapshot } from './route-vehicles.ts'

export async function getBusRoutePaths(request: BusPathRequest, signal: AbortSignal): Promise<BusRouteData[]> {
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
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true || !('routes' in body) || !Array.isArray(body.routes) || !body.routes.length || !body.routes.every(isBusRouteData)) throw new Error('Bus route geometry unavailable')
  return body.routes
}

export type RouteVehicleRequest = { kind: 'bus'; bus: BusPathRequest } | { kind: 'mtr-bus'; route: string }
export async function getRouteVehicles(request: RouteVehicleRequest, signal: AbortSignal): Promise<RouteVehicleSnapshot> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(55_000)])
  if (staticExport) {
    if (request.kind !== 'bus') throw new Error('Hosted feed required')
    const { loadBusRouteVehicles } = await import('./bus-route.ts')
    return { kind: 'bus', data: await waitForRequest(loadBusRouteVehicles(request.bus), requestSignal) }
  }
  const values = request.kind === 'bus' ? request.bus.tracking ?? request.bus : { operator: 'mtr-bus', route: request.route }
  const params = new URLSearchParams(Object.entries(values).filter(([key, value]) => key !== 'tracking' && value != null).map(([key, value]) => [key, String(value)]))
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/route-vehicles?${params}`, { signal: requestSignal, cache: 'no-store' })
  if (!response.ok) throw new Error('Vehicle positions unavailable')
  return readRouteVehicleSnapshot(await response.json())
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
