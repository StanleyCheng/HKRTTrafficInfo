import { parsePedestrian, pedestrianUrl } from '../../../lib/pedestrian.ts'
import { viewCachedGet, type OkBody } from '../../../lib/view-cache.ts'
import type { Camera, MapPath } from '../../../lib/traffic.ts'

type PedestrianBody = OkBody & { paths: MapPath[]; cameras: Camera[]; complete: boolean }

export const GET = viewCachedGet<PedestrianBody>({
  freshMs: 60_000,
  keepMs: 300_000,
  maxEntries: 24,
  load: async (lng, lat) => {
    // Parsed local samples are cached here; do not also accumulate large raw
    // geometry responses in the shared upstream byte cache.
    const response = await fetch(pedestrianUrl(lng, lat), { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
    if (response.status !== 200) throw new Error('Pedestrian network unavailable')
    const payload: unknown = await response.json()
    return { ok: true, ...parsePedestrian(payload), fetchedAt: new Date().toISOString() }
  },
  missing: () => ({ ok: false, paths: [], cameras: [], complete: false }),
  failed: () => ({ ok: false, paths: [], cameras: [], complete: false, error: 'Pedestrian connections unavailable' }),
})
