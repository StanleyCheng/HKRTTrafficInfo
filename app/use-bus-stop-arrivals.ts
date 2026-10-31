'use client'
import { useEffect, useRef, useState } from 'react'
import { getBusStopArrivals } from '@/lib/bus-route-client'
import { RefreshBackoff } from '@/lib/refresh-backoff'
import { ETA_KEEP_MS } from '@/lib/place-arrivals'
import type { BusRouteSelection, BusStopArrivalsResponse } from '@/lib/bus-route'

type StopState = { key: string } & ({ status: 'ready'; data: BusStopArrivalsResponse } | { status: 'loading' | 'error'; data?: BusStopArrivalsResponse })

/** Both renderers share the same stop clock, failure policy and retry action. */
export function useBusStopArrivals(selection: BusRouteSelection | null, onActivity: () => () => void) {
  const key = selection ? JSON.stringify(selection) : ''
  const selectionRef = useRef(selection)
  const cache = useRef(new Map<string, { at: number; state: StopState }>())
  const backoff = useRef(new RefreshBackoff())
  const [result, setResult] = useState<StopState>()
  const [retry, setRetry] = useState(0)
  useEffect(() => { selectionRef.current = selection }, [selection])
  useEffect(() => {
    const selected = selectionRef.current
    if (!selected) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || controller.signal.aborted || document.hidden || !navigator.onLine) return
      const held = cache.current.get(key)
      if (held && (Date.now() - held.at < 30_000 || !backoff.current.due(key))) { setResult(held.state); return }
      pending = true
      if (!held?.state.data) setResult({ key, status: 'loading' })
      const finish = onActivity()
      controller.signal.addEventListener('abort', finish, { once: true })
      try {
        const data = await getBusStopArrivals(selected, controller.signal)
        if (controller.signal.aborted) return
        const observed = Date.parse(data.observedAt ?? '')
        if (!data.ok || data.stale || data.error || !Array.isArray(data.arrivals) || !Number.isFinite(observed)
          || Date.now() - observed >= ETA_KEEP_MS || observed > Date.now() + 30_000) throw new Error('Stop arrivals unavailable')
        backoff.current.reset(key)
        const state: StopState = { key, status: 'ready', data }
        cache.current.set(key, { at: Date.now(), state }); setResult(state)
      } catch {
        if (controller.signal.aborted) return
        backoff.current.fail(key)
        const state: StopState = { key, status: 'error', data: held?.state.data }
        cache.current.set(key, { at: Date.now(), state }); setResult(state)
      } finally { pending = false; controller.signal.removeEventListener('abort', finish); finish() }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    const visible = () => void refresh()
    const online = () => { backoff.current.reset(key); const held = cache.current.get(key); if (held) held.at = 0; void refresh() }
    document.addEventListener('visibilitychange', visible); window.addEventListener('online', online)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', online) }
  }, [key, retry, onActivity])
  const current = result?.key === key ? result : undefined
  return { data: current?.data, status: current?.status ?? 'loading', retry: () => { backoff.current.reset(key); const held = cache.current.get(key); if (held) held.at = 0; setRetry(value => value + 1) } }
}
