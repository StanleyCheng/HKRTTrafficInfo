import { worksFromWfs, withTraditionalText, WORKS_LAYER_MS } from "@/lib/picture"
import { fillWorksChinese } from "@/lib/works-chinese"
import { roadWfs } from "@/lib/road-feed"
import { cachedFeed } from "@/lib/route-cache"

export const dynamic = "force-dynamic"
export const GET = cachedFeed<{ ok: boolean; error?: string; works: GeoJSON.FeatureCollection }>(WORKS_LAYER_MS, async () => {
  const [en, tc] = await Promise.all([roadWfs("DRSS:VW_ROAD_WORK_EN", WORKS_LAYER_MS), roadWfs("DRSS:VW_ROAD_WORK_TC", WORKS_LAYER_MS)])
  return { ok: true, works: fillWorksChinese(withTraditionalText(worksFromWfs(en), worksFromWfs(tc), ["road", "place", "status", "kind", "lane", "bound", "district"])) }
}, (error) => ({ ok: false, error: error instanceof Error ? error.message : "Road works failed", works: { type: "FeatureCollection" as const, features: [] } }))
