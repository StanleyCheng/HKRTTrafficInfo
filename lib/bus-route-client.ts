import { staticExport } from './traffic.ts'
import type { BusRouteResponse, BusRouteSelection, BusStopArrivalsResponse } from './bus-route.ts'
import { waitForRequest } from './request-wait.ts'

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
