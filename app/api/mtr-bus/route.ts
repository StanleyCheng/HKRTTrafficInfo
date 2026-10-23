import { loadMtrBusNear } from '../../../lib/mtr-bus-feed.ts'
import { viewCachedGet } from '../../../lib/view-cache.ts'

export const GET = viewCachedGet({
  freshMs: 5_000,
  load: loadMtrBusNear,
  missing: () => ({ ok: false, cameras: [], observedAt: null, stale: false, error: 'Map viewport required' }),
  failed: () => ({ ok: false, cameras: [], observedAt: null, stale: true, error: 'MTR bus schedules unavailable' }),
})
