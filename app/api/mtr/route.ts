import { loadMtrSnapshot } from "@/lib/mtr-feed"
import { keepWorkerRequestAlive } from "@/lib/feed-cache"
import { ETA_FRESH_MS } from "@/lib/place-arrivals"
import type { MtrResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

let pending: Promise<MtrResponse> | null = null
let cached: { at: number; body: MtrResponse } | null = null

export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < ETA_FRESH_MS) return Response.json(cached.body)
  pending ??= keepWorkerRequestAlive(loadMtrSnapshot(now).then((body) => {
    if (body.ok && !body.stale) cached = { at: now, body }
    return body
  }).finally(() => {
    pending = null
  }))
  try {
    const body = await pending
    if (!body.ok && cached) return Response.json({ ...cached.body, stale: true, error: body.error })
    return Response.json(body, { status: body.ok ? 200 : 502 })
  } catch (error) {
    if (cached) return Response.json({ ...cached.body, stale: true, error: error instanceof Error ? error.message : "Next train feed failed" })
    const body: MtrResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Next train feed failed",
      observedAt: null,
      trains: [],
      boards: [],
    }
    return Response.json(body, { status: 502 })
  }
}
