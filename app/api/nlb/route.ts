import { loadNlbNear } from "../../../lib/nlb-feed.ts"
import type { NlbResponse } from "../../../lib/types.ts"
import { viewCachedGet } from "../../../lib/view-cache.ts"
import { ETA_FRESH_MS } from "../../../lib/place-arrivals.ts"

export const dynamic = "force-dynamic"

const empty = (error: string): NlbResponse => ({ ok: false, error, observedAt: null, stops: [] })

export const GET = viewCachedGet({
  freshMs: ETA_FRESH_MS,
  load: loadNlbNear,
  missing: () => empty("New Lantao Bus centre missing"),
  failed: (error) => empty(error instanceof Error ? error.message : "New Lantao Bus arrivals failed"),
})
