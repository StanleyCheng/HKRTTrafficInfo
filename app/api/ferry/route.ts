import { loadFerrySnapshot } from "@/lib/ferry-feed"
import { keepWorkerRequestAlive } from "@/lib/feed-cache"
import { ETA_FRESH_MS } from "@/lib/place-arrivals"
import type { FerryResponse } from "@/lib/types"

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
    if (!body.ok && cached) return Response.json({ ...cached.body, stale: true, error: body.error })
    return Response.json(body, { status: body.ok ? 200 : 502 })
  } catch (error) {
    if (cached) return Response.json({ ...cached.body, stale: true, error: error instanceof Error ? error.message : "Ferry arrivals failed" })
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
