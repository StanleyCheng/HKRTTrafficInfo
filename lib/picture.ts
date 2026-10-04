import { standardHan } from "./camera-place.ts"

export const CAMERA_LAYER_MS = 6 * 60 * 60 * 1000
export const TOLL_LAYER_MS = 6 * 60 * 60 * 1000
export const WORKS_LAYER_MS = 5 * 60 * 1000
export const PICTURE_POLL_MS = WORKS_LAYER_MS

const TUNNEL_NAMES: Record<string, string> = {
  WHC: "Western Harbour Crossing",
  CHT: "Cross Harbour Tunnel",
  EHC: "Eastern Harbour Crossing",
  TLT: "Tai Lam Tunnel",
}

export function worksFromWfs(wfs: unknown): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const feature of featuresOf(wfs)) {
    const coordinates = pointOf(feature.geometry)
    const id = text(feature.properties?.ROADWORKS_ID)
    if (!id || !coordinates) continue
    features.push({
      type: "Feature",
      properties: {
        id,
        road: text(feature.properties?.ROAD_NAME),
        place: text(feature.properties?.LOC_DESC),
        status: text(feature.properties?.WORKS_STATUS) || "Road work",
        kind: text(feature.properties?.WORKS_TYPE),
        lane: text(feature.properties?.LANE),
        bound: text(feature.properties?.BOUND),
        district: text(feature.properties?.DISTRICT),
        start: text(feature.properties?.START_TIME),
        end: text(feature.properties?.END_TIME),
      },
      geometry: { type: "Point", coordinates },
    })
  }
  return { type: "FeatureCollection", features }
}

export function tollsFromWfs(wfs: unknown): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const seen = new Set<string>()
  for (const feature of featuresOf(wfs)) {
    const coordinates = pointOf(feature.geometry)
    const code = text(feature.properties?.TunnelCode)
    const featureId = text(feature.properties?.FeatureID) || numberText(feature.properties?.FeatureID)
    if (!code || !coordinates || !featureId || seen.has(featureId)) continue
    seen.add(featureId)
    const scale = text(feature.properties?.Scale)
    features.push({
      type: "Feature",
      properties: {
        id: featureId,
        code,
        name: TUNNEL_NAMES[code] ?? code,
        band: scale === "300+" ? "overview" : "portal",
      },
      geometry: { type: "Point", coordinates },
    })
  }
  return { type: "FeatureCollection", features }
}

export function withTraditionalText(
  english: GeoJSON.FeatureCollection,
  traditional: GeoJSON.FeatureCollection,
  fields: readonly string[],
): GeoJSON.FeatureCollection {
  const byId = new Map<string, GeoJSON.GeoJsonProperties>()
  for (const feature of traditional.features) {
    const id = propertyText(feature.properties, "id")
    if (id) byId.set(id, feature.properties)
  }
  return {
    type: "FeatureCollection",
    features: english.features.map((feature) => {
      const id = propertyText(feature.properties, "id")
      const translated = id ? byId.get(id) : null
      const properties: GeoJSON.GeoJsonProperties = { ...feature.properties }
      for (const field of fields) {
        const value = translated ? propertyText(translated, field) : ""
        if (properties) properties[`${field}Tc`] = value ? standardHan(value) : ""
      }
      return { ...feature, properties }
    }),
  }
}

function propertyText(properties: GeoJSON.GeoJsonProperties, key: string): string {
  const value = properties?.[key]
  return typeof value === "string" ? value.trim() : ""
}

function featuresOf(wfs: unknown): WfsFeature[] {
  if (!isRecord(wfs) || !Array.isArray(wfs.features)) return []
  return wfs.features.flatMap((feature) => {
    if (!isRecord(feature)) return []
    return [
      {
        properties: isRecord(feature.properties) ? feature.properties : null,
        geometry: isRecord(feature.geometry) ? feature.geometry : null,
      },
    ]
  })
}

function pointOf(geometry: WfsFeature["geometry"]): [number, number] | null {
  if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null
  const [lng, lat] = geometry.coordinates
  if (typeof lng !== "number" || typeof lat !== "number") return null
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return [lng, lat]
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim()
  return ""
}

function numberText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

type WfsFeature = {
  properties: Record<string, unknown> | null
  geometry: Record<string, unknown> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
