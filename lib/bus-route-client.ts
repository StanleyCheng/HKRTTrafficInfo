import { staticExport } from './traffic.ts'
import type { BusRouteResponse, BusRouteSelection } from './bus-route.ts'

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
