import { loadFerrySnapshot } from "@/lib/ferry-feed"
import type { FerryResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

const FRESH_MS = 60_000

let cached: { at: number; body: FerryResponse } | null = null

export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < FRESH_MS) return Response.json(cached.body)
  try {
    const body = await loadFerrySnapshot(now)
    if (body.ok && body.cacheable !== false) cached = { at: Date.now(), body }
    else if (!body.ok && cached) return Response.json({ ...cached.body, stale: true, error: body.error })
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
