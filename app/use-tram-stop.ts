'use client'
import { useEffect, useState } from 'react'
import { staticExport, type Camera, type Arrival } from '@/lib/traffic'
import { TRAM_REFRESH_MS } from '@/lib/tram'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function isArrival(value: unknown): value is Arrival {
  return record(value) && typeof value.route === 'string' && typeof value.destination === 'string' && typeof value.destinationEn === 'string'
    && typeof value.eta === 'string' && Number.isFinite(Date.parse(value.eta)) && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt))
    && typeof value.minutes === 'number' && Number.isFinite(value.minutes) && typeof value.scheduled === 'boolean'
    && record(value.tram) && (value.tram.routeId === null || typeof value.tram.routeId === 'string')
    && (value.tram.direction === 'eastbound' || value.tram.direction === 'westbound') && (value.tram.vehicleId === null || typeof value.tram.vehicleId === 'string')
}
export function useTramStop(camera: Camera, onActivity: () => () => void) {
  const [result, setResult] = useState<{ id: string; camera: Camera; failed: boolean }>()
  const [retry, setRetry] = useState(0)
  const active = camera.kind === 'tram' && camera.positionType !== 'vehicle' && !staticExport
  const id = active ? camera.sourceId : null
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || document.hidden || controller.signal.aborted) return
      pending = true
      const finish = onActivity()
      controller.signal.addEventListener('abort', finish, { once: true })
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/tram?stop=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) })
        const payload: unknown = await response.json()
        if (!response.ok || !record(payload) || payload.ok !== true || !record(payload.camera)
          || payload.camera.sourceId !== id || payload.camera.kind !== 'tram') throw new Error('Tram arrivals unavailable')
        const arrivals = payload.camera.arrivals
        if (arrivals !== undefined && (!Array.isArray(arrivals) || !arrivals.every(isArrival))) throw new Error('Invalid tram arrivals')
        if (!controller.signal.aborted) setResult({ id, camera: { ...camera, arrivals, dataUpdated: typeof payload.camera.dataUpdated === 'string' ? payload.camera.dataUpdated : undefined, tramEtaNotice: typeof payload.camera.tramEtaNotice === 'string' ? payload.camera.tramEtaNotice : undefined }, failed: payload.camera.tramEtaError === true })
      } catch {
        if (!controller.signal.aborted) setResult(previous => ({ id, camera: previous?.id === id ? previous.camera : camera, failed: true }))
      } finally { pending = false; controller.signal.removeEventListener('abort', finish); finish() }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), TRAM_REFRESH_MS)
    const resume = () => void refresh()
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume) }
    // Stop identity owns the request; background map refreshes must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, retry, onActivity])
  const current = active && result?.id === id ? result : undefined
  return { camera: current?.camera ?? camera, loading: active && !current && !camera.arrivals, failed: Boolean(current?.failed), retry: () => setRetry(value => value + 1) }
}
