import { commuterCatalogue, tramPaths } from './commuter-catalogue.ts'
import { metresBetween } from './nearest.ts'
import { etaQueue, takeEtaTurn } from './polite-fetch.ts'
import { parseTramEta, tramStation, TramServiceError, TRAM_REFRESH_MS, TRAM_KEEP_MS } from './tram.ts'
import type { Camera } from './traffic.ts'

const held = new Map<string, { at: number; camera: Camera }>()

export function loadTramStop(id: string, now = Date.now()): Promise<Camera> {
  return takeEtaTurn('tram', async () => {
    const base = commuterCatalogue('tram').find(stop => stop.sourceId === id)
    const station = tramStation(id)
    if (!base || !station) throw new Error('Unknown tram stop')
    const cached = held.get(id)
    if (cached && now - cached.at < TRAM_REFRESH_MS) return cached.camera
    const deadline = AbortSignal.timeout(20_000)
    // Shared Happy Valley platforms return the same board for either query.
    // Tin Lok Lane (112) branches east/west and still needs both directions.
    const directions = station.code === 'HVT' || /^(10[5-9]|11[01])$/.test(station.code) ? ['westbound'] : station.directions
    const results = await Promise.all(directions.map(async direction => {
      if (direction !== 'eastbound' && direction !== 'westbound') throw new Error('Invalid tram direction')
      return etaQueue(async () => {
        const response = await fetch(`https://api.hktramways.com/api/v1/tram-eta/${station.code}/${direction}`, { cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(12_000)]), headers: { Accept: 'application/json' } })
        const payload: unknown = await response.json()
        const observedAt = new Date(Date.now()).toISOString()
        // The operator sends service-suspension notices as JSON with HTTP 503.
        // Read those inside this bounded request; generic feed fetching discards
        // error bodies because unrelated providers can stall while sending them.
        const arrivals = parseTramEta(payload, station.code, direction, observedAt)
        if (!response.ok) throw new Error('Tram ETA unavailable')
        return { arrivals, observedAt }
      }, deadline)
    }).map((task, index) => task.then(result => ({ ok: true as const, ...result }), (error: unknown) => ({ ok: false as const, direction: directions[index], notice: error instanceof TramServiceError ? error.message : undefined }))))
    // A failed direction retains only its own unexpired observations. A healthy
    // empty board clears that direction without erasing the other platform.
    const arrivals = results.flatMap(result => result.ok ? result.arrivals : (cached?.camera.arrivals ?? []).filter(call => (directions.length === 1 || call.tram?.direction === result.direction) && now - Date.parse(call.observedAt ?? '') < TRAM_KEEP_MS))
    const failed = results.some(result => !result.ok)
    const notices = results.flatMap(result => !result.ok && result.notice ? [result.notice] : [])
    const camera = { ...base, arrivals: arrivals.length || results.some(result => result.ok) ? arrivals : undefined,
      dataUpdated: arrivals.map(call => call.observedAt!).sort().at(0) ?? results.flatMap(result => result.ok ? [result.observedAt] : []).sort().at(0),
      tramEtaError: failed, tramEtaNotice: [...new Set(notices)].join(' ') || undefined }
    held.set(id, { at: now, camera })
    return camera
  }, id)
}

export async function loadTramNear(lng: number, lat: number, now: number, zoom: number) {
  const places = commuterCatalogue('tram')
  const near = zoom >= 13 ? places.map(camera => ({ camera, distance: metresBetween({ lng, lat }, camera) }))
    .filter(item => item.distance <= 2500).sort((a, b) => a.distance - b.distance).slice(0, 12) : []
  const loaded = await Promise.all(near.map(({ camera }) => loadTramStop(camera.sourceId, now)))
  const cameras = places.map(camera => loaded.find(item => item.id === camera.id) ?? camera)
  const missed = loaded.filter(camera => camera.tramEtaError).length
  return { ok: true, cameras, paths: tramPaths(), observedAt: loaded.map(camera => camera.dataUpdated).filter((at): at is string => Boolean(at)).sort().at(0) ?? null,
    stale: loaded.length > 0 && missed === loaded.length, complete: missed === 0,
    ...(missed ? { error: `Tram ETA unavailable (${missed} of ${loaded.length})` } : {}),
  }
}
