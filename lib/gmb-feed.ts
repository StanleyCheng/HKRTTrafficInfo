import { viewportAllowed } from "./view-cache.ts"
import { gmbStop, gmbStopsWithin } from "./gmb-reach.ts"
import { kmbReachMetres } from "./kmb-reach.ts"
import { etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstream } from "./upstream.ts"
import type { GmbCall, GmbPlacesResponse, GmbResponse, GmbStopBoard } from "./types.ts"

const GMB_CAP = 24
const FETCH_LIMIT = 4
const ETA_ROOT = "https://data.etagmb.gov.hk/eta/stop"

type EtaEntry = {
  eta_seq?: number
  diff?: number
  timestamp?: string
  remarks_tc?: string | null
  remarks_en?: string | null
}

type EtaRoute = {
  route_seq?: number
  stop_seq?: number
  route_id?: number
  enabled?: boolean
  eta?: EtaEntry[] | null
}

const remembered = new Map<string, HeldRows<EtaRoute>>()

export function loadGmbPlaces(lng: number, lat: number, _now = Date.now(), zoom = Number.NaN): GmbPlacesResponse {
  void _now
  if (!viewportAllowed("gmb", lng, lat, zoom)) return { ok: true, stops: [] }
  const stops: GmbPlacesResponse["stops"] = []
  for (const stop of gmbStopsWithin(lng, lat, kmbReachMetres(zoom, lat), GMB_CAP)) {
    const record = gmbStop(stop.id)
    if (!record) continue
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: record.routes,
    })
  }
  return { ok: true, stops }
}

export async function loadGmbNear(lng: number, lat: number, now = Date.now(), zoom = Number.NaN): Promise<GmbResponse> {
  if (!viewportAllowed("gmb", lng, lat, zoom)) return { ok: true, observedAt: null, stops: [] }
  forgetStale(remembered, now)
  const nearest = gmbStopsWithin(lng, lat, kmbReachMetres(zoom, lat), GMB_CAP)
  const turn = await takeEtaTurn(async () => {
    let missed = 0
    await pool(nearest.map((stop) => stop.id), FETCH_LIMIT, async (stopId) => {
      const cached = remembered.get(stopId)
      if (!etaDue(cached, now)) return
      const rows = await fetchStop(stopId)
      if (rows) remembered.set(stopId, { at: now, rows })
      else missed += 1
    })
    return missed
  })
  const missed = turn ?? 0

  const stops: GmbStopBoard[] = []
  for (const stop of nearest) {
    const record = gmbStop(stop.id)
    if (!record) continue
    const rows = heldRows(remembered.get(stop.id), now) ?? []
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: record.routes,
      calls: callsAt(rows, record.ids ?? {}, now, stop.id),
    })
  }
  const error = missed > 0 ? "Some Green minibus arrivals could not refresh" : undefined
  const latest = Math.max(0, ...nearest.map((stop) => remembered.get(stop.id)?.at ?? 0))
  return {
    ok: true,
    ...(error ? { error } : {}),
    observedAt: latest > 0 ? new Date(latest).toISOString() : null,
    stale: missed > 0 || turn === null,
    stops,
    cacheable: turn !== null && missed === 0,
  }
}

function callsAt(rows: EtaRoute[], ids: Record<string, string>, now: number, stopId: string): GmbCall[] {
  const soonest = new Map<string, GmbCall>()
  for (const row of rows) {
    if (row.enabled === false || row.route_id == null) continue
    const route = ids[String(row.route_id)]
    if (!route) continue
    const entry = (row.eta ?? []).find((item) => item.eta_seq === 1) ?? row.eta?.[0]
    if (!entry) continue
    const etaMs = entry.timestamp ? Date.parse(entry.timestamp) : NaN
    const hasEta = Number.isFinite(etaMs)
    const minutes = hasEta
      ? Math.max(0, Math.round((etaMs - now) / 60_000))
      : typeof entry.diff === "number" && Number.isFinite(entry.diff)
        ? Math.max(0, entry.diff)
        : null
    if (!hasEta && minutes == null && !text(entry.remarks_tc) && !text(entry.remarks_en)) continue
    const call: GmbCall = {
      ...(row.route_seq ? { tracking: { operator: "gmb" as const, route, stopId, routeId: String(row.route_id), routeSeq: row.route_seq, stopSeq: row.stop_seq } } : {}),
      route,
      destTc: "",
      destEn: "",
      eta: hasEta ? new Date(etaMs).toISOString() : "",
      minutes,
      scheduled: /scheduled/i.test(text(entry.remarks_en)) || text(entry.remarks_tc) === "未開出",
      remarkTc: text(entry.remarks_tc),
      remarkEn: text(entry.remarks_en),
    }
    const key = `${row.route_id}/${row.route_seq}/${row.stop_seq}`
    const current = soonest.get(key)
    if (!current || (call.minutes ?? 999) < (current.minutes ?? 999)) soonest.set(key, call)
  }
  return [...soonest.values()].sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999) || a.route.localeCompare(b.route, undefined, { numeric: true })).slice(0, 12)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

async function fetchStop(stopId: string): Promise<EtaRoute[] | null> {
  try {
    const response = await etaQueue(() => fetchUpstream(`${ETA_ROOT}/${encodeURIComponent(stopId)}`, ETA_FRESH_MS, {
      timeoutMs: 5_000,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    }))
    if (response.status !== 200) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { data?: EtaRoute[] }
    return Array.isArray(body.data) ? body.data : []
  } catch {
    return null
  }
}
