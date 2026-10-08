import { viewCachedGet } from "../../../lib/view-cache.ts"
import { loadKmbNear } from "../../../lib/kmb-feed.ts"
import { kmbCacheKey } from "../../../lib/kmb-reach.ts"
import { ETA_FRESH_MS } from "../../../lib/place-arrivals.ts"
import type { KmbResponse } from "../../../lib/types.ts"

export const dynamic = "force-dynamic"

const empty = (error: string): KmbResponse => ({ ok: false, error, observedAt: null, stops: [] })

export const GET = viewCachedGet({
  freshMs: ETA_FRESH_MS,
  load: loadKmbNear,
  cacheKey: kmbCacheKey,
  missing: () => empty("KMB centre missing"),
  failed: (error) => empty(error instanceof Error ? error.message : "KMB arrivals failed"),
})
