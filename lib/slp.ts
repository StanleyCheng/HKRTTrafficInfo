import { XMLParser } from "fast-xml-parser"
import { parseCsv, inHongKong, pickLatestPeriod } from "./traffic-parsing.ts"
import { isLiveTrafficDataFresh, officialHongKongTimestamp, speedLevel, speedLevelColors, type Camera } from "./traffic.ts"

export const SLP_LOCATIONS_URL = "https://static.data.gov.hk/td/traffic-data-slp/info/traffic_speed_volume_occ_info-slp.csv"
export const SLP_READINGS_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol_SLP-all.xml"

export function parseSlpDetectors(csv: string, xml: string): Camera[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""))
  const headers = rows.shift()?.map((value) => value.trim().toLowerCase()) ?? []
  if (!["aid_id_number", "latitude", "longitude"].every((key) => headers.includes(key))) throw new Error("Invalid smart lamppost locations")
  const column = (key: string) => headers.indexOf(key)
  const raw = new XMLParser().parse(xml)?.raw_speed_volume_list
  type Detector = { detector_id: string; lanes?: { lane?: { valid?: string; speed?: number } | { valid?: string; speed?: number }[] } }
  type Period = { period_to?: string; detectors?: { detector?: Detector | Detector[] } }
  const latest = pickLatestPeriod<Period>(raw?.periods?.period)
  if (!latest?.detectors?.detector) throw new Error("Invalid smart lamppost speed readings")
  const updated = officialHongKongTimestamp(raw?.date, latest.period_to)
  const fresh = isLiveTrafficDataFresh(updated)
  const detectors = Array.isArray(latest.detectors.detector) ? latest.detectors.detector : [latest.detectors.detector]
  const speeds = new Map(detectors.map((detector) => {
    const lanes = detector.lanes?.lane
    const values = (Array.isArray(lanes) ? lanes : lanes ? [lanes] : [])
      .filter((lane) => fresh && lane.valid === "Y").map((lane) => Number(lane.speed)).filter((speed) => Number.isFinite(speed) && speed >= 0)
    return [String(detector.detector_id), values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null] as const
  }))
  return rows.flatMap((row): Camera[] => {
    const id = row[column("aid_id_number")]?.trim()
    const lat = Number(row[column("latitude")]), lng = Number(row[column("longitude")])
    if (!id || !inHongKong(lat, lng)) return []
    const speedKmh = speeds.get(id) ?? null
    const level = speedLevel(speedKmh)
    const clean = (value?: string) => value?.replace(/\s*\[[^\]]+\]\s*$/, "").trim()
    return [{ id: `flow-slp-${id}`, sourceId: id, kind: "flow", name: clean(row[column("road_tc")]) || id, nameEn: clean(row[column("road_en")]), lat, lng, remarks: row[column("direction")], speedKmh, level, color: speedLevelColors[level], dataUpdated: updated }]
  })
}

export async function loadSlpDetectors(): Promise<Camera[]> {
  const responses = await Promise.all([SLP_LOCATIONS_URL, SLP_READINGS_URL].map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) })
    if (!response.ok) throw new Error(`Smart lamppost feed HTTP ${response.status}`)
    return response.text()
  }))
  return parseSlpDetectors(responses[0], responses[1])
}
