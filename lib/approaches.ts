import { standardHan } from "./camera-place.ts"
import type { ApproachLeg, ApproachPoint, HarbourJourney } from "./types.ts"

// HKeMobility journey-time boards whose roads approach a Victoria Harbour crossing.
const APPROACH_LOCATION_IDS: ReadonlySet<string> = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H11",
  "K02",
  "K03",
  "K07",
  "K08",
])

const CROSSING_ORDER = ["CH", "EH", "WH"] as const

const CROSSING_NAMES: Record<(typeof CROSSING_ORDER)[number], string> = {
  CH: "Cross Harbour Tunnel",
  EH: "Eastern Harbour Crossing",
  WH: "Western Harbour Crossing",
}

export function readApproachPoints(
  wfs: unknown,
  detailsById: Readonly<Record<string, unknown>>,
  traditionalWfs: unknown = null,
): { points: ApproachPoint[]; capturedAt: string | null } {
  const traditional = locationNames(traditionalWfs)
  const points: ApproachPoint[] = []
  let capturedAt: string | null = null

  for (const feature of featuresOf(wfs)) {
    const id = text(feature.properties?.LOCATION_ID)
    if (!APPROACH_LOCATION_IDS.has(id)) continue
    const coordinates = pointOf(feature.geometry)
    if (!coordinates) continue
    const detail = detailsById[id]
    const legs = legsOf(detail).filter((leg) => leg.minutes != null)
    if (legs.length === 0) continue
    const dated = firstDate(detail)
    if (dated && (!capturedAt || dated > capturedAt)) capturedAt = dated
    const named = text(feature.properties?.LOCATION) || textFromDetail(detail)
    points.push({
      id,
      observedAt: dated ?? undefined,
      name: named || id,
      nameTc: standardHan(traditional.get(id) ?? ""),
      coordinates,
      legs,
    })
  }

  points.sort((a, b) => a.id.localeCompare(b.id, "en"))
  return { points, capturedAt }
}

function locationNames(wfs: unknown): Map<string, string> {
  const names = new Map<string, string>()
  for (const feature of featuresOf(wfs)) {
    const id = text(feature.properties?.LOCATION_ID)
    const name = text(feature.properties?.LOCATION)
    if (id && name) names.set(id, name)
  }
  return names
}

function featuresOf(wfs: unknown): Feature[] {
  if (!isRecord(wfs) || !Array.isArray(wfs.features)) return []
  return wfs.features.flatMap((feature) => (isFeature(feature) ? [feature] : []))
}

function legsOf(detail: unknown): ApproachLeg[] {
  if (!Array.isArray(detail)) return []
  const byCode = new Map<string, ApproachLeg>()
  for (const row of detail) {
    if (!isRecord(row) || !isRecord(row.dest)) continue
    const code = text(row.dest.did)
    if (!isCrossing(code) || byCode.has(code)) continue
    const minutes = minutesOf(row.dest.time)
    byCode.set(code, {
      code,
      name: plain(text(row.dest.desc)) || CROSSING_NAMES[code],
      minutes,
      colour: colourOf(row.dest.cid),
    })
  }
  return CROSSING_ORDER.flatMap((code) => {
    const leg = byCode.get(code)
    return leg ? [leg] : []
  })
}

function firstDate(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null
  for (const row of detail) {
    if (!isRecord(row) || !isRecord(row.dest)) continue
    const date = text(row.dest.date)
    // HKeMobility publishes local Hong Kong clock strings without an offset.
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(date) ? `${date}+08:00` : date
    if (normalized && Number.isFinite(Date.parse(normalized))) return normalized
  }
  return null
}

function textFromDetail(detail: unknown): string {
  if (!Array.isArray(detail)) return ""
  for (const row of detail) {
    if (isRecord(row)) {
      const desc = text(row.desc)
      if (desc) return desc
    }
  }
  return ""
}

function pointOf(geometry: Feature["geometry"]): [number, number] | null {
  if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null
  const [lng, lat] = geometry.coordinates
  if (typeof lng !== "number" || typeof lat !== "number") return null
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return [lng, lat]
}

function minutesOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return value
}

function colourOf(cid: unknown): HarbourJourney["colour"] {
  switch (cid) {
    case 1:
    case "1":
      return "red"
    case 2:
    case "2":
      return "amber"
    case 3:
    case "3":
      return "green"
    default:
      return "none"
  }
}

function isCrossing(code: string): code is (typeof CROSSING_ORDER)[number] {
  return code === "CH" || code === "EH" || code === "WH"
}

function plain(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

type Feature = {
  properties?: { LOCATION_ID?: unknown; LOCATION?: unknown }
  geometry?: { type?: unknown; coordinates?: unknown[] } | null
}

function isFeature(value: unknown): value is Feature {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
