import { commuterCatalogue, commuterRetrievedAt, tramPaths } from './commuter-catalogue.ts'
import { parsePedestrian, pedestrianUrl } from './pedestrian.ts'
import { layers, staticExport, type Camera, type CameraData, type CommuterKind, type MapPath } from './traffic.ts'
import type { MapViewport } from './integration-client.ts'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
async function json(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(25_000)
  const response = await fetch(url, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw new Error('Commuter feed unavailable')
  return response.json()
}
function responseBody(payload: unknown, kind: CommuterKind): { cameras: Camera[]; paths: MapPath[]; observedAt: string | null; stale: boolean; error?: string; complete: boolean } {
  if (!record(payload) || payload.ok !== true || !Array.isArray(payload.cameras) || payload.cameras.some(camera => !record(camera) || camera.kind !== kind || typeof camera.id !== 'string' || !Number.isFinite(camera.lat) || !Number.isFinite(camera.lng))) throw new Error('Commuter feed shape unavailable')
  return { cameras: payload.cameras as Camera[], paths: Array.isArray(payload.paths) ? payload.paths as MapPath[] : [], observedAt: typeof payload.observedAt === 'string' ? payload.observedAt : null, stale: payload.stale === true, error: typeof payload.error === 'string' ? payload.error : undefined, complete: payload.complete !== false }
}
export async function getCommuterData(kind: CommuterKind, view: MapViewport, signal?: AbortSignal): Promise<CameraData> {
  signal?.throwIfAborted()
  let cameras = commuterCatalogue(kind), paths: MapPath[] = [], observedAt: string | null = null, stale = false, complete = true
  let feedError: string | undefined
  if (kind === 'mtr-bus') {
    const query = new URLSearchParams({ lng: String(view.lng), lat: String(view.lat), zoom: String(view.zoom) })
    const result = responseBody(await json(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/mtr-bus?${query}`, signal), kind)
    cameras = result.cameras; observedAt = result.observedAt; stale = result.stale; feedError = result.error
  } else if (kind === 'tram') paths = tramPaths()
  else if (kind === 'access' && view.zoom >= 15) {
    try {
      const query = new URLSearchParams({ lng: String(view.lng), lat: String(view.lat), zoom: String(view.zoom) })
      const payload = await json(staticExport ? pedestrianUrl(view.lng, view.lat) : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/pedestrian?${query}`, signal)
      if (staticExport) {
        const result = parsePedestrian(payload)
        paths = result.paths; cameras = [...cameras, ...result.cameras]; complete = result.complete
      } else {
        const result = responseBody(payload, kind)
        paths = result.paths; cameras = [...cameras, ...result.cameras]; complete = result.complete
        stale = result.stale; feedError = result.error
      }
    } catch (error) {
      signal?.throwIfAborted()
      void error
      feedError = 'Pedestrian connections unavailable'; complete = false
    }
  }
  if (kind !== 'mtr-bus') cameras = cameras.map(camera => ({ ...camera, sourceUpdated: commuterRetrievedAt }))
  return { cameras, paths, count: cameras.length, expectedCount: cameras.length, fetchedAt: new Date().toISOString(), observedAt, sourceLastModified: null, source: layers[kind].source, complete, stale, feedError }
}
