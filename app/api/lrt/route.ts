import { loadLrtSnapshot } from "@/lib/lrt-feed"
import { keepWorkerRequestAlive } from "@/lib/feed-cache"
import { ETA_FRESH_MS } from "@/lib/place-arrivals"
import type { LrtResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

let pending: Promise<LrtResponse> | null = null
let cached: { at: number; body: LrtResponse } | null = null

export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < ETA_FRESH_MS) return Response.json(cached.body)
  const current = pending ?? keepWorkerRequestAlive(loadLrtSnapshot(now).then((body) => {
    if (body.ok && !body.stale) cached = { at: now, body }
    return body
  }).finally(() => {
    pending = null
  }))
  pending = current
  try {
    const body = await current
    if (!body.ok && cached) return Response.json({ ...cached.body, stale: true, error: body.error })
    return Response.json(body, { status: body.ok ? 200 : 502 })
  } catch (error) {
    if (cached) return Response.json({ ...cached.body, stale: true, error: error instanceof Error ? error.message : "Light Rail arrivals failed" })
    const body: LrtResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Light Rail arrivals failed",
      observedAt: null,
      trains: [],
      boards: [],
    }
    return Response.json(body, { status: 502 })
  }
}
