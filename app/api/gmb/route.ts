import { loadGmbNear } from "@/lib/gmb-feed"
import { kmbCacheKey } from "@/lib/kmb-reach"
import type { GmbResponse } from "@/lib/types"
import { viewCachedGet } from "@/lib/view-cache"
import { ETA_FRESH_MS } from "@/lib/place-arrivals"

export const dynamic = "force-dynamic"

const empty = (error: string): GmbResponse => ({ ok: false, error, observedAt: null, stops: [] })

export const GET = viewCachedGet({
  freshMs: ETA_FRESH_MS,
  load: loadGmbNear,
  cacheKey: kmbCacheKey,
  missing: () => empty("Green minibus centre missing"),
  failed: (error) => empty(error instanceof Error ? error.message : "Green minibus arrivals failed"),
})
