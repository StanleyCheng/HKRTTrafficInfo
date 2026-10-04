type Messages = { noFeed: string; clear: string; veryBusyCount: (n: number) => string; badApproachCount: (n: number) => string; busyCount: (n: number) => string; slowCount: (n: number) => string; closedCount: (n: number) => string }
import type { SpeedBand } from "./types.ts"

export type ControlPointCode = "HYW" | "HZM" | "LMC" | "LSC" | "LWS" | "MKT" | "SBC" | "STK"

export type QueueFile = Record<ControlPointCode, { arrQueue: number; depQueue: number }>

const VEHICLE_ROADS: Record<ControlPointCode, string[]> = {
  HYW: ["HEUNG YUEN WAI"],
  HZM: ["TUEN MUN CHEK LAP KOK", "HONG KONG-ZHUHAI-MACAO", "HONG KONG ZHUHAI"],
  LMC: ["SAN TIN HIGHWAY", "LOK MA CHAU"],
  LSC: ["SAN TIN HIGHWAY", "LOK MA CHAU"],
  LWS: [],
  MKT: ["MAN KAM TO"],
  SBC: ["SHENZHEN BAY", "KONG SHAM", "HUNG TIN"],
  STK: ["SHA TAU KOK"],
}

const POINTS: { code: ControlPointCode; name: string; coordinates: [number, number] }[] = [
  { code: "HYW", name: "Heung Yuen Wai", coordinates: [114.1516, 22.5592] },
  { code: "HZM", name: "Hong Kong-Zhuhai-Macao Bridge", coordinates: [113.9542, 22.3166] },
  { code: "LMC", name: "Lok Ma Chau", coordinates: [114.0757, 22.5122] },
  { code: "LSC", name: "Lok Ma Chau Spur Line", coordinates: [114.0655, 22.5143] },
  { code: "LWS", name: "Lo Wu", coordinates: [114.1133, 22.5281] },
  { code: "MKT", name: "Man Kam To", coordinates: [114.1291, 22.5376] },
  { code: "SBC", name: "Shenzhen Bay", coordinates: [113.9444, 22.5021] },
  { code: "STK", name: "Sha Tau Kok", coordinates: [114.2236, 22.5472] },
]

export function controlPointFeatures(resident: QueueFile, visitor: QueueFile): GeoJSON.Feature[] {
  return POINTS.map((point) => {
    const residentArr = queueCode(resident[point.code]?.arrQueue)
    const residentDep = queueCode(resident[point.code]?.depQueue)
    const visitorArr = queueCode(visitor[point.code]?.arrQueue)
    const visitorDep = queueCode(visitor[point.code]?.depQueue)
    const worst = worstQueue([residentArr, residentDep, visitorArr, visitorDep])
    return {
      type: "Feature",
      properties: {
        code: point.code,
        name: point.name,
        worst,
        residentArrCode: residentArr,
        residentDepCode: residentDep,
        visitorArrCode: visitorArr,
        visitorDepCode: visitorDep,
      },
      geometry: { type: "Point", coordinates: point.coordinates },
    }
  })
}

export function decorateControlPoints(
  collection: GeoJSON.FeatureCollection,
  corridors: { roadEn: string; roadTc: string; speedKmh: number | null; band: SpeedBand }[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => {
      const code = textCode(feature.properties?.code)
      const vehicle = code ? slowestApproach(corridors, VEHICLE_ROADS[code]) : null
      return {
        ...feature,
        properties: {
          ...feature.properties,
          vehicleRoadEn: vehicle?.road ?? "",
          vehicleRoadTc: vehicle?.roadTc ?? "",
          vehicleKmh: vehicle?.speedKmh ?? null,
          vehicleBand: vehicle?.band ?? "",
        },
      }
    }),
  }
}

function slowestApproach(
  corridors: { roadEn: string; roadTc: string; speedKmh: number | null; band: SpeedBand }[],
  needles: string[],
): { road: string; roadTc: string; speedKmh: number; band: SpeedBand } | null {
  let best: { road: string; roadTc: string; speedKmh: number; band: SpeedBand } | null = null
  for (const corridor of corridors) {
    if (corridor.speedKmh == null) continue
    const name = `${corridor.roadEn} ${corridor.roadTc}`.toUpperCase()
    if (!needles.some((needle) => name.includes(needle))) continue
    const road = corridor.roadEn || corridor.roadTc || "Approach"
    if (!best || rankBand(corridor.band) > rankBand(best.band) || (corridor.band === best.band && corridor.speedKmh < best.speedKmh)) {
      best = { road, roadTc: corridor.roadTc, speedKmh: corridor.speedKmh, band: corridor.band }
    }
  }
  return best
}

function rankBand(band: SpeedBand): number {
  switch (band) {
    case "congested":
      return 3
    case "slow":
      return 2
    case "free":
      return 1
    case "unknown":
      return 0
    default: {
      const exhaustive: never = band
      return exhaustive
    }
  }
}

function textCode(value: unknown): ControlPointCode | null {
  if (value === "HYW" || value === "HZM" || value === "LMC" || value === "LSC" || value === "LWS" || value === "MKT" || value === "SBC" || value === "STK") {
    return value
  }
  return null
}

export function isQueueFile(value: unknown): value is QueueFile {
  if (typeof value !== "object" || value === null) return false
  return POINTS.every((point) => {
    const row = (value as Record<string, unknown>)[point.code]
    return typeof row === "object" && row !== null && "arrQueue" in row && "depQueue" in row
  })
}

function queueCode(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 4
}

function worstQueue(codes: number[]): number {
  return codes.reduce((worst, code) => (severity(code) > severity(worst) ? code : worst), 99)
}

function severity(code: number): number {
  switch (code) {
    case 2:
      return 3
    case 1:
      return 2
    case 0:
      return 1
    default:
      return 0
  }
}

export type BoundaryGlance = {
  label: string
  tone: "red" | "amber" | "green" | "none"
}

export function boundaryGlance(collection: GeoJSON.FeatureCollection | null, error: string | null, m: Messages): BoundaryGlance {
  if (error) return { label: m.noFeed, tone: "amber" }
  if (!collection) return { label: "…", tone: "none" }
  let veryBusy = 0
  let busy = 0
  let closed = 0
  let badRoad = 0
  let slowRoad = 0
  for (const feature of collection.features) {
    const worst = feature.properties && typeof feature.properties.worst === "number" ? feature.properties.worst : null
    const band = feature.properties && typeof feature.properties.vehicleBand === "string" ? feature.properties.vehicleBand : ""
    if (worst === 2) veryBusy += 1
    else if (worst === 1) busy += 1
    else if (worst === 99 || worst === 4) closed += 1
    if (band === "congested") badRoad += 1
    else if (band === "slow") slowRoad += 1
  }
  if (veryBusy > 0) return { label: m.veryBusyCount(veryBusy), tone: "red" }
  if (badRoad > 0) return { label: m.badApproachCount(badRoad), tone: "red" }
  if (busy > 0) return { label: m.busyCount(busy), tone: "amber" }
  if (slowRoad > 0) return { label: m.slowCount(slowRoad), tone: "amber" }
  if (closed > 0) return { label: m.closedCount(closed), tone: "amber" }
  return { label: m.clear, tone: "green" }
}
