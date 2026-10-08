import { staticExport } from './traffic.ts'
import type { BusRouteResponse, BusRouteSelection, BusStopArrivalsResponse } from './bus-route.ts'

export async function getBusRoute(selection: BusRouteSelection, signal?: AbortSignal): Promise<BusRouteResponse> {
  signal?.throwIfAborted()
  if (staticExport) {
    const { loadBusRoute } = await import('./bus-route.ts')
    const response = await loadBusRoute(selection)
    signal?.throwIfAborted()
    return response
  }
  const params = new URLSearchParams(Object.entries(selection).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))
  const timeout = AbortSignal.timeout(55_000)
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/bus-route?${params}`, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
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
    return new Promise((resolve, reject) => {
      const abort = () => reject(requestSignal.reason)
      requestSignal.addEventListener('abort', abort, { once: true })
      void loadBusStopArrivals(selection).then(resolve, reject).finally(() => requestSignal.removeEventListener('abort', abort))
    })
  }
  const params = new URLSearchParams(Object.entries(selection).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))
  params.set('stopArrivals', '1')
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/bus-route?${params}`, { cache: 'no-store', signal: requestSignal })
  if (!response.ok) throw new Error('Stop arrivals unavailable')
  return response.json() as Promise<BusStopArrivalsResponse>
}
