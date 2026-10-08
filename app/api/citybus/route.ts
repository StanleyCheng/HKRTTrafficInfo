import { viewCachedGet } from "@/lib/view-cache"
import { loadCitybusNear } from "@/lib/citybus-feed"
import { ETA_FRESH_MS } from "@/lib/place-arrivals"
import type { CitybusResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

const empty = (error: string): CitybusResponse => ({ ok: false, error, observedAt: null, stops: [] })

export const GET = viewCachedGet({
  freshMs: ETA_FRESH_MS,
  load: loadCitybusNear,
  missing: () => empty("Citybus centre missing"),
  failed: (error) => empty(error instanceof Error ? error.message : "Citybus arrivals failed"),
})
