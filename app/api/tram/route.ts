import { loadTramNear, loadTramStop } from '../../../lib/tram-feed.ts'
import { tramStation, TRAM_KEEP_MS, TRAM_REFRESH_MS } from '../../../lib/tram.ts'
import { viewCachedGet } from '../../../lib/view-cache.ts'

const nearby = viewCachedGet({ freshMs: TRAM_REFRESH_MS, keepMs: TRAM_KEEP_MS, load: loadTramNear,
  missing: () => ({ ok: false, cameras: [], paths: [], complete: false, observedAt: null, stale: false, error: 'Map viewport required' }),
  failed: () => ({ ok: false, cameras: [], paths: [], complete: false, observedAt: null, stale: true, error: 'Tram arrivals unavailable' }),
})
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('stop')
  if (id === null) return nearby(request)
  if (!tramStation(id)) return Response.json({ ok: false, error: 'Unknown tram stop' }, { status: 400 })
  const camera = await loadTramStop(id)
  return Response.json({ ok: true, camera })
}
