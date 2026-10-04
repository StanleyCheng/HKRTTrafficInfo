import { controlPointFeatures, isQueueFile } from "./control-points.ts"
import { fetchUpstream } from "./upstream.ts"
import type { ControlPointsResponse } from "./types.ts"
export { controlPointFeatures, isQueueFile, decorateControlPoints } from "./control-points.ts"

export async function loadBoundary(): Promise<ControlPointsResponse> {
  const results = await Promise.all(["R", "V"].map(async (group) => {
    const response = await fetchUpstream(`https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTime${group}.json`, 60_000, { timeoutMs: 15_000 })
    if (response.status !== 200) throw new Error(`HTTP ${response.status} from Immigration Department`)
    const data: unknown = JSON.parse(new TextDecoder().decode(response.body))
    if (!isQueueFile(data)) throw new Error("Control point waiting times were not in the published shape")
    return { data, fetchedAt: response.fetchedAt }
  }))
  const observedAt = results.map((result) => result.fetchedAt).sort()[0]
  return { ok: true, observedAt, fetchedAt: observedAt, points: { type: "FeatureCollection", features: controlPointFeatures(results[0].data, results[1].data) } }
}
