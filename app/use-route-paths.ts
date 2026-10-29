'use client'
import { useEffect, useMemo, useState } from 'react'
import { getBusRoutePaths } from '@/lib/bus-route-client'
import { busPaths, routeVisible, type TransportRoute, type RouteVisibility } from '@/lib/transport-routes'
import type { MapPath, LayerKind } from '@/lib/traffic'
import type { BusRouteData } from '@/lib/bus-route'
import { hasBusRoadDisplay } from '@/lib/bus-route-display'

export type PathState = { status: 'ready'; paths: MapPath[]; routes: BusRouteData[]; approximate: boolean; incomplete: boolean; community: boolean } | { status: 'error' }
const ready = (routes: BusRouteData[]): PathState => ({ status: 'ready', paths: busPaths(routes), routes, approximate: routes.some(direction => direction.geometry === 'stops' && hasBusRoadDisplay(direction)), incomplete: routes.some(direction => !hasBusRoadDisplay(direction)), community: routes.some(direction => direction.geometrySource === 'osm') })
export function useRoutePaths(routes: TransportRoute[], enabled: Record<LayerKind, boolean>, visibility: RouteVisibility, onActivity: () => () => void) {
  const [loaded, setLoaded] = useState<Record<string, PathState>>({})
  const [retry, setRetry] = useState(0)
  // A stable work list keeps clock ticks and individual completion renders from restarting the queue.
  const work = useMemo(() => routes.filter(route => route.bus && enabled[route.kind] && routeVisible(route, visibility)), [routes, enabled, visibility])
  useEffect(() => {
    const controller = new AbortController()
    const queue = work.filter(route => !loaded[route.id] || retry && loaded[route.id].status === 'error')
    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const route = queue.shift()
        if (!route?.bus) continue
        const finish = onActivity()
        controller.signal.addEventListener('abort', finish, { once: true })
        try {
          const result = await getBusRoutePaths(route.bus, controller.signal)
          if (!controller.signal.aborted) setLoaded(previous => ({ ...previous, [route.id]: ready(result) }))
        } catch {
          if (!controller.signal.aborted) setLoaded(previous => ({ ...previous, [route.id]: { status: 'error' } }))
        } finally { controller.signal.removeEventListener('abort', finish); finish() }
      }
    }
    void worker(); void worker()
    return () => controller.abort()
    // Loaded results are a cache, not an input that restarts outstanding requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, retry, onActivity])
  return { loaded, retry: () => setRetry(value => value + 1), prime: (id: string, routes: BusRouteData[]) => setLoaded(previous => ({ ...previous, [id]: ready(routes) })) }
}
