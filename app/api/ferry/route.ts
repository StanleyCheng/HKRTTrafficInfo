import { loadFerrySnapshot } from "../../../lib/ferry-feed.ts"
import { keepWorkerRequestAlive } from "../../../lib/feed-cache.ts"
import { ETA_FRESH_MS } from "../../../lib/place-arrivals.ts"
import { snapshotFallback } from "../../../lib/snapshot-cache.ts"
import type { FerryResponse } from "../../../lib/types.ts"

export const dynamic = "force-dynamic"

let pending: Promise<FerryResponse> | null = null
let cached: { at: number; body: FerryResponse } | null = null

export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < ETA_FRESH_MS) return Response.json(cached.body)
  const current = pending ?? keepWorkerRequestAlive(loadFerrySnapshot(now).then((body) => {
    if (body.ok && body.cacheable !== false) cached = { at: now, body }
    return body
  }).finally(() => { pending = null }))
  pending = current
  try {
    const body = await current
    const fallback = snapshotFallback(cached)
    if (!body.ok && fallback) return Response.json({ ...fallback, stale: true, error: body.error })
    return Response.json(body, { status: body.ok ? 200 : 502 })
  } catch (error) {
    const fallback = snapshotFallback(cached)
    if (fallback) return Response.json({ ...fallback, stale: true, error: error instanceof Error ? error.message : "Ferry arrivals failed" })
    const body: FerryResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Ferry arrivals failed",
      observedAt: null,
      piers: [],
      vessels: [],
    }
    return Response.json(body, { status: 502 })
  }
}
