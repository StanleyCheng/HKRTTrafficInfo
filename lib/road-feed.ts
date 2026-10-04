import { fetchUpstream } from "./upstream.ts"

export async function roadWfs(typeName: string, ttlMs: number): Promise<unknown> {
  const params = new URLSearchParams({ service: "WFS", version: "1.0.0", request: "GetFeature", typeName, outputFormat: "application/json", srsName: "EPSG:4326" })
  const response = await fetchUpstream(`https://www.hkemobility.gov.hk/api/drss/layer/map?${params}`, ttlMs, {
    timeoutMs: 40_000, headers: { Accept: "application/json", Referer: "https://www.hkemobility.gov.hk/en/" },
  })
  if (response.status !== 200) throw new Error(`HTTP ${response.status} from HKeMobility`)
  const payload = JSON.parse(new TextDecoder().decode(response.body))
  if (!payload || !Array.isArray(payload.features)) throw new Error("HKeMobility returned an invalid feature collection")
  return payload
}
