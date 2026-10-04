import { loadBoundary } from "@/lib/boundary"
import { cachedFeed } from "@/lib/route-cache"
import type { ControlPointsResponse } from "@/lib/types"
export const dynamic = "force-dynamic"
export const GET = cachedFeed<ControlPointsResponse>(60_000, loadBoundary, (error) => ({ ok: false, error: error instanceof Error ? error.message : "Control point waiting times failed", observedAt: null, points: { type: "FeatureCollection", features: [] } }))
