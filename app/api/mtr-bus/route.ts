import { ETA_KEEP_MS } from '../../../lib/place-arrivals.ts'
import { loadMtrBusNear } from '../../../lib/mtr-bus-feed.ts'
import { viewCachedGet } from '../../../lib/view-cache.ts'

export const GET = viewCachedGet({
  freshMs: 5_000,
  keepMs: ETA_KEEP_MS,
  load: loadMtrBusNear,
  missing: () => ({ ok: false, cameras: [], observedAt: null, stale: false, error: 'Map viewport required' }),
  failed: () => ({ ok: false, cameras: [], observedAt: null, stale: true, error: 'MTR bus schedules unavailable' }),
})
