'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getRouteVehicles, type RouteVehicleRequest } from '@/lib/bus-route-client'
import { RefreshBackoff } from '@/lib/refresh-backoff'
import { retainBusRoute } from '@/lib/bus-route-state'
import { seedBusRoute, type RouteVehicleFeeds, type RouteVehicleState, type RouteVehicleSnapshot } from '@/lib/route-vehicles'
import { routeVisible, type TransportRoute, type RouteVisibility } from '@/lib/transport-routes'
import type { CameraData, LayerKind } from '@/lib/traffic'
import type { BusRouteSelection } from '@/lib/bus-route'
import type { PathState } from './use-route-paths'

export function useRouteVehicles(routes: TransportRoute[], enabled: Record<LayerKind, boolean>, visibility: RouteVisibility, geometry: Record<string, PathState>, feeds: Partial<Record<LayerKind, CameraData>>, onActivity: () => () => void, focused: BusRouteSelection | null, now: number) {
  const [states, setStates] = useState<Record<string, RouteVehicleState>>({})
  const [retry, setRetry] = useState(0)
  const backoff = useRef(new RefreshBackoff())
  const cache = useRef(new Map<string, { at: number; state: RouteVehicleState }>())
  const work = useMemo(() => routes.filter(route => enabled[route.kind] && routeVisible(route, visibility) && (route.bus || route.kind === 'mtr-bus') && !(focused?.operator === route.kind && focused.route === route.code))
    .sort((a, b) => Number(visibility[b.id] === true) - Number(visibility[a.id] === true)), [routes, enabled, visibility, focused])
  const workKey = JSON.stringify(work.map(route => [route.id, route.bus ?? route.code]))
  const workRef = useRef(work)
  useEffect(() => { workRef.current = work }, [work])
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || controller.signal.aborted || document.hidden || !navigator.onLine) return
      pending = true
      const queue = workRef.current.filter(route => { const held = cache.current.get(route.id); return backoff.current.due(route.id) && (!held || Date.now() - held.at >= 30_000) })
      const worker = async () => {
        while (queue.length && !controller.signal.aborted) {
          const route = queue.shift()
          if (!route) continue
          const request: RouteVehicleRequest = route.bus ? { kind: 'bus', bus: route.bus } : { kind: 'mtr-bus', route: route.code }
          const held = cache.current.get(route.id)?.state.data
          setStates(previous => ({ ...previous, [route.id]: { status: 'loading', data: held } }))
          const finish = onActivity()
          controller.signal.addEventListener('abort', finish, { once: true })
          try {
            let next = await getRouteVehicles(request, controller.signal)
            if (controller.signal.aborted) return
            if (next.kind === 'bus' && held?.kind === 'bus') next = { kind: 'bus', data: retainBusRoute(held.data, next.data, Date.now()) }
            const state: RouteVehicleState = next.data.stale || next.kind === 'bus' && next.data.error ? { status: 'error', data: next } : { status: 'ready', data: next }
            if (state.status === 'error') backoff.current.fail(route.id)
            else backoff.current.reset(route.id)
            cache.current.set(route.id, { at: Date.now(), state })
            setStates(previous => ({ ...previous, [route.id]: state }))
          } catch {
            if (controller.signal.aborted) return
            const state: RouteVehicleState = { status: 'error', data: held }
            backoff.current.fail(route.id)
            cache.current.set(route.id, { at: Date.now(), state })
            setStates(previous => ({ ...previous, [route.id]: state }))
          } finally { controller.signal.removeEventListener('abort', finish); finish() }
        }
      }
      try { await Promise.all([worker(), worker()]) } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    const resume = () => void refresh()
    const online = () => { backoff.current.reset(); cache.current.forEach(entry => { entry.at = 0 }); void refresh() }
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', online)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', online) }
  }, [workKey, retry, onActivity])
  const snapshots = useMemo<RouteVehicleFeeds>(() => Object.fromEntries(work.flatMap(route => {
    const state = states[route.id], paths = geometry[route.id]
    const seed = route.bus && paths?.status === 'ready' ? seedBusRoute(paths.routes, feeds[route.kind], now) : undefined
    let snapshot: RouteVehicleSnapshot | undefined = state?.data
    if (!snapshot && seed) snapshot = { kind: 'bus', data: seed }
    else if (snapshot?.kind === 'bus' && snapshot.data.stale && seed) snapshot = { kind: 'bus', data: retainBusRoute(seed, snapshot.data, now) }
    return snapshot ? [[route.id, snapshot]] : []
  })), [work, states, geometry, feeds, now])
  return { states, snapshots, retry: () => { backoff.current.reset(); cache.current.forEach(entry => { entry.at = 0 }); setRetry(value => value + 1) } }
}
