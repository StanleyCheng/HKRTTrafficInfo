'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const workKey = JSON.stringify(work.map(route => [route.id, route.bus]))
  const workRef = useRef(work), loadedRef = useRef(loaded)
  useEffect(() => { workRef.current = work; loadedRef.current = loaded }, [work, loaded])
  useEffect(() => {
    const controller = new AbortController()
    const queue = workRef.current.filter(route => !loadedRef.current[route.id])
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
  }, [workKey, retry, onActivity])
  return { loaded, retry: () => { setLoaded(previous => Object.fromEntries(Object.entries(previous).filter(([, state]) => state.status !== 'error'))); setRetry(value => value + 1) }, prime: (id: string, routes: BusRouteData[]) => setLoaded(previous => ({ ...previous, [id]: ready(routes) })) }
}
