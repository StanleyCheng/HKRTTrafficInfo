import { loadMtrSnapshot } from "@/lib/mtr-feed"
import { keepWorkerRequestAlive } from "@/lib/feed-cache"
import type { MtrResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

const FRESH_MS = 12_000

let pending: Promise<MtrResponse> | null = null
let cached: { at: number; body: MtrResponse } | null = null

export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < FRESH_MS) return Response.json(cached.body)
  pending ??= keepWorkerRequestAlive(loadMtrSnapshot(now).finally(() => {
    pending = null
  }))
  try {
    const body = await pending
    if (body.ok && !body.stale) cached = { at: Date.now(), body }
    else if (!body.ok && cached) return Response.json({ ...cached.body, stale: true, error: body.error })
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
