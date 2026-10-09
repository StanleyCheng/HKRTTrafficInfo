import { viewportAllowed } from "./view-cache.ts"
import { arrivalPairs } from "./arrival-pairs.ts"
import { citybusStop, nearestCitybusStops } from "./citybus-network.ts"
import { etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstreamResilient } from "./upstream-resilient.ts"
import type { CitybusCall, CitybusPlacesResponse, CitybusResponse, CitybusStopBoard } from "./types.ts"

// Wall-clock budget: at 24 pairs × (5s attempt + 2.5s retry) ÷ 8 in-flight
// callers = 22.5s worst case, which keeps a degraded-upstream refresh inside
// Cloudflare's 30s paid plan wall clock. Normal-case requests complete well
// under this bound.
const STOP_LIMIT = 6
const PAIR_BUDGET = 24
const FETCH_LIMIT = 8
const ETA_TIMEOUT_MS = 5_000
const ETA_RETRY_TIMEOUT_MS = 2_500
const ETA_ROOT = "https://rt.data.gov.hk/v2/transport/citybus/eta/CTB"

type EtaRow = {
  dir?: "I" | "O"
  seq?: number
  route?: string
  dest_tc?: string
  dest_en?: string
  eta?: string | null
  eta_seq?: number
  rmk_en?: string
  rmk_tc?: string
}

const remembered = new Map<string, HeldRows<EtaRow>>()

export function loadCitybusPlaces(lng: number, lat: number, _now = Date.now(), zoom = Number.NaN): CitybusPlacesResponse {
  void _now
  if (!viewportAllowed("citybus", lng, lat, zoom)) return { ok: true, stops: [] }
  const stops: CitybusPlacesResponse["stops"] = []
  for (const stop of nearestCitybusStops(lng, lat, STOP_LIMIT)) {
    const record = citybusStop(stop.id)
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

// Poles and the routes on them come from the network file. This only refreshes arrival times.
export async function loadCitybusNear(lng: number, lat: number, now = Date.now(), zoom = Number.NaN): Promise<CitybusResponse> {
  if (!viewportAllowed("citybus", lng, lat, zoom)) return { ok: true, observedAt: null, stops: [] }
  forgetStale(remembered, now)
  const nearest = nearestCitybusStops(lng, lat, STOP_LIMIT)
  const pairs = arrivalPairs(nearest, PAIR_BUDGET)
  const turn = await takeEtaTurn("citybus", async () => {
    let missed = 0
    await pool(pairs, FETCH_LIMIT, async (pair) => {
      const key = `${pair.stopId}/${pair.route}`
      const cached = remembered.get(key)
      if (!etaDue(cached, now)) return
      const rows = await fetchEta(pair.stopId, pair.route)
      if (rows) remembered.set(key, { at: now, rows })
      else missed += 1
    })
    return missed
  })
  const missed = turn
  const totalFailure = pairs.length > 0 && missed === pairs.length
  const partialFailure = !totalFailure && missed > 0

  const stops: CitybusStopBoard[] = []
  for (const stop of nearest) {
    const record = citybusStop(stop.id)
    if (!record) continue
    const rows: EtaRow[] = []
    for (const route of stop.routes) {
      const kept = heldRows(remembered.get(`${stop.id}/${route}`), now)
      if (kept) rows.push(...kept)
    }
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: record.routes,
      calls: callsAt(rows, now, stop.id),
    })
  }
  const error = totalFailure
    ? "Citybus arrivals could not refresh"
    : partialFailure
      ? `Some Citybus arrivals could not refresh (${missed} of ${pairs.length})`
      : undefined
  const latest = Math.max(0, ...pairs.map((pair) => remembered.get(`${pair.stopId}/${pair.route}`)?.at ?? 0))
  return {
    ok: !totalFailure,
    ...(error ? { error } : {}),
    observedAt: latest > 0 ? new Date(latest).toISOString() : null,
    stale: totalFailure,
    stops,
    cacheable: !totalFailure && !partialFailure,
  }
}

function callsAt(rows: EtaRow[], now: number, stopId: string): CitybusCall[] {
  const calls: CitybusCall[] = []
  for (const row of rows) {
    if (row.eta_seq !== 1) continue
    const route = text(row.route)
    if (!route) continue
    const etaMs = row.eta ? Date.parse(row.eta) : NaN
    const hasEta = Number.isFinite(etaMs)
    const remarkTc = isScheduled(row) ? "" : text(row.rmk_tc)
    const remarkEn = isScheduled(row) ? "" : text(row.rmk_en)
    calls.push({
      ...(row.dir ? { tracking: { operator: "citybus" as const, route, stopId, bound: row.dir, stopSeq: row.seq } } : {}),
      route,
      destTc: text(row.dest_tc),
      destEn: text(row.dest_en),
      eta: hasEta ? new Date(etaMs).toISOString() : "",
      minutes: hasEta ? Math.max(0, Math.round((etaMs - now) / 60_000)) : null,
      scheduled: isScheduled(row),
      remarkTc,
      remarkEn,
    })
  }
  calls.sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999) || a.route.localeCompare(b.route, undefined, { numeric: true }))
  return calls.slice(0, 12)
}

function isScheduled(row: EtaRow): boolean {
  return row.rmk_en === "Scheduled Bus" || row.rmk_tc === "原定班次"
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

async function fetchEta(stopId: string, route: string): Promise<EtaRow[] | null> {
  try {
    const response = await etaQueue(() => fetchUpstreamResilient(`${ETA_ROOT}/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`, ETA_FRESH_MS, {
      timeoutMs: ETA_TIMEOUT_MS,
      retryTimeoutMs: ETA_RETRY_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    }))
    // servedFromCache means every attempt failed and the wrapper served a
    // previous good body. We must still surface that as a miss so the bus feed
    // can mark partial vs total failure correctly.
    if (response.servedFromCache || response.status < 200 || response.status >= 300) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { data?: EtaRow[] }
    return Array.isArray(body.data) ? body.data : []
  } catch {
    return null
  }
}
