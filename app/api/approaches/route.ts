import { cachedFeed } from "@/lib/route-cache"
import { readApproachPoints } from "@/lib/approaches"
import { fetchUpstream } from "@/lib/upstream"
import type { ApproachesResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

const LOCATIONS_URL =
  "https://www.hkemobility.gov.hk/api/drss/layer/map?service=WFS&version=1.0.0&request=GetFeature&typeName=DRSS:VW_JOURNEY_TIME_LOCATION_EN&outputFormat=application/json&srsName=EPSG:4326"

const LOCATIONS_TC_URL =
  "https://www.hkemobility.gov.hk/api/drss/layer/map?service=WFS&version=1.0.0&request=GetFeature&typeName=DRSS:VW_JOURNEY_TIME_LOCATION_TC&outputFormat=application/json&srsName=EPSG:4326"

const DETAIL_IDS = ["H1", "H2", "H3", "H4", "H11", "K02", "K03", "K07", "K08"]

const FRESH_MS = 60_000
const PLACE_MS = 24 * 60 * 60 * 1000

export const GET = cachedFeed<ApproachesResponse>(FRESH_MS, loadApproaches, (error) => ({
  ok: false, error: error instanceof Error ? error.message : "Journey time boards failed", capturedAt: null, points: [],
}))

let places: { at: number; locations: unknown; traditional: unknown } | null = null

async function loadApproaches(): Promise<ApproachesResponse> {
  const placed = await loadPlaces()
  const details = await Promise.all(
    DETAIL_IDS.map(async (id) => {
      try {
        return [id, await readJson(detailUrl(id))] as const
      } catch (error) {
        return [id, error instanceof Error ? error.message : "Journey time board failed"] as const
      }
    }),
  )

  const detailsById: Record<string, unknown> = {}
  const failures: string[] = []
  for (const [id, body] of details) {
    if (typeof body === "string") {
      failures.push(`${id}: ${body}`)
      continue
    }
    detailsById[id] = body
  }

  const { points, capturedAt } = readApproachPoints(placed.locations, detailsById, placed.traditional)
  return {
    ok: points.length > 0,
    error: failures.length ? failures.join("; ") : points.length === 0 ? "No harbour-approach journey times were returned." : undefined,
    cacheable: failures.length === 0,
    capturedAt,
    points,
  }
}

async function loadPlaces(): Promise<{ at: number; locations: unknown; traditional: unknown }> {
  const now = Date.now()
  if (places && now - places.at < PLACE_MS) return places
  try {
    const locations = await readJson(LOCATIONS_URL, PLACE_MS)
    const traditional = await readJson(LOCATIONS_TC_URL, PLACE_MS).catch(() => places?.traditional ?? null)
    places = { at: now, locations, traditional }
    return places
  } catch (error) {
    if (places) return places
    throw error
  }
}

function detailUrl(id: string): string {
  return `https://www.hkemobility.gov.hk/api/drss/getTextInfo/JourneyTime/en/${encodeURIComponent(id)}`
}

async function readJson(url: string, ttlMs = FRESH_MS): Promise<unknown> {
  const response = await fetchUpstream(url, ttlMs, {
    timeoutMs: 40_000,
    headers: {
      Accept: "application/json",
      Referer: "https://www.hkemobility.gov.hk/en/",
    },
  })
  if (response.status !== 200) throw new Error(`HTTP ${response.status} from hkemobility.gov.hk`)
  return JSON.parse(new TextDecoder().decode(response.body)) as unknown
}
