import { fetchUpstream } from '../../../lib/upstream.ts'
import { parsePedestrian, pedestrianUrl } from '../../../lib/pedestrian.ts'
import { viewCachedGet, type OkBody } from '../../../lib/view-cache.ts'
import type { Camera, MapPath } from '../../../lib/traffic.ts'

type PedestrianBody = OkBody & { paths: MapPath[]; cameras: Camera[]; complete: boolean }

export const GET = viewCachedGet<PedestrianBody>({
  freshMs: 60_000,
  keepMs: 300_000,
  load: async (lng, lat) => {
    const response = await fetchUpstream(pedestrianUrl(lng, lat), 60_000, { timeoutMs: 12_000 })
    if (response.status !== 200) throw new Error('Pedestrian network unavailable')
    const payload: unknown = JSON.parse(new TextDecoder().decode(response.body))
    return { ok: true, ...parsePedestrian(payload), fetchedAt: response.fetchedAt }
  },
  missing: () => ({ ok: false, paths: [], cameras: [], complete: false }),
  failed: () => ({ ok: false, paths: [], cameras: [], complete: false, error: 'Pedestrian connections unavailable' }),
})
