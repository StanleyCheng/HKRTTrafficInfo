import { tollsFromWfs, TOLL_LAYER_MS } from "@/lib/picture"
import { roadWfs } from "@/lib/road-feed"
import { cachedFeed } from "@/lib/route-cache"

export const dynamic = "force-dynamic"
export const GET = cachedFeed<{ ok: boolean; error?: string; tolls: GeoJSON.FeatureCollection }>(TOLL_LAYER_MS, async () => ({ ok: true, tolls: tollsFromWfs(await roadWfs("DRSS:DRSS_TOLL_POINT", TOLL_LAYER_MS)) }),
  (error) => ({ ok: false, error: error instanceof Error ? error.message : "Toll points failed", tolls: { type: "FeatureCollection" as const, features: [] } }))
