import { viewportAllowed } from "./view-cache.ts"
import { arrivalPairs } from "./arrival-pairs.ts"
import { citybusStop, nearestCitybusStops } from "./citybus-network.ts"
import { etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstream } from "./upstream.ts"
import type { CitybusCall, CitybusPlacesResponse, CitybusResponse, CitybusStopBoard } from "./types.ts"

const STOP_LIMIT = 6
const PAIR_BUDGET = 24
const FETCH_LIMIT = 4
const ETA_ROOT = "https://rt.data.gov.hk/v2/transport/citybus/eta/CTB"

type EtaRow = {
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
  const turn = await takeEtaTurn(async () => {
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
  const missed = turn ?? 0

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
      calls: callsAt(rows, now),
    })
  }
  const error = missed > 0 ? "Some Citybus arrivals could not refresh" : undefined
  const latest = Math.max(0, ...pairs.map((pair) => remembered.get(`${pair.stopId}/${pair.route}`)?.at ?? 0))
  return {
    ok: true,
    ...(error ? { error } : {}),
    observedAt: latest > 0 ? new Date(latest).toISOString() : null,
    stale: missed > 0 || turn === null,
    stops,
    cacheable: turn !== null && missed === 0,
  }
}

function callsAt(rows: EtaRow[], now: number): CitybusCall[] {
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
    const response = await etaQueue(() => fetchUpstream(`${ETA_ROOT}/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`, ETA_FRESH_MS, {
      timeoutMs: 5_000,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    }))
    if (response.status !== 200) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { data?: EtaRow[] }
    return Array.isArray(body.data) ? body.data : []
  } catch {
    return null
  }
}
