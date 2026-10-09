import { viewportAllowed } from "./view-cache.ts"
import { arrivalPairs } from "./arrival-pairs.ts"
import { nlbArrivalMs } from "./nlb-clock.ts"
import { nearestNlbStops, nlbStop } from "./nlb-network.ts"
import { etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstreamResilient } from "./upstream-resilient.ts"
import type { NlbCall, NlbPlacesResponse, NlbResponse, NlbStopBoard } from "./types.ts"

const STOP_LIMIT = 6
const PAIR_BUDGET = 24
const FETCH_LIMIT = 4
const ETA_ROOT = "https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals"

type Arrival = { estimatedArrivalTime?: string; departed?: string | number; noGPS?: string | number }

const remembered = new Map<string, HeldRows<Arrival>>()

export function loadNlbPlaces(lng: number, lat: number, _now = Date.now(), zoom = Number.NaN): NlbPlacesResponse {
  void _now
  if (!viewportAllowed("nlb", lng, lat, zoom)) return { ok: true, stops: [] }
  const stops: NlbPlacesResponse["stops"] = []
  for (const stop of nearestNlbStops(lng, lat, STOP_LIMIT)) {
    const record = nlbStop(stop.id)
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

export async function loadNlbNear(lng: number, lat: number, now = Date.now(), zoom = Number.NaN): Promise<NlbResponse> {
  if (!viewportAllowed("nlb", lng, lat, zoom)) return { ok: true, observedAt: null, stops: [] }
  forgetStale(remembered, now)
  const nearest = nearestNlbStops(lng, lat, STOP_LIMIT)
  const pairs = arrivalPairs(nearest.map((stop) => {
    const record = nlbStop(stop.id)
    return { id: stop.id, routes: record?.services.map((service) => service.id) ?? [] }
  }), PAIR_BUDGET)
  const turn = await takeEtaTurn("nlb", async () => {
    let missed = 0
    await pool(pairs, FETCH_LIMIT, async (pair) => {
      const key = `${pair.stopId}/${pair.route}`
      const cached = remembered.get(key)
      if (!etaDue(cached, now)) return
      const rows = await fetchEta(pair.route, pair.stopId)
      if (rows) remembered.set(key, { at: now, rows })
      else missed += 1
    })
    return missed
  })
  const total = pairs.length
  const missed = turn
  const totalFailure = total > 0 && missed === total
  const partialFailure = !totalFailure && missed > 0

  const stops: NlbStopBoard[] = []
  for (const stop of nearest) {
    const record = nlbStop(stop.id)
    if (!record) continue
    const calls: NlbCall[] = []
    for (const service of record.services) {
      const rows = heldRows(remembered.get(`${stop.id}/${service.id}`), now) ?? []
      const call = callAt(service.code, rows, now)
      if (call) calls.push({ ...call, tracking: { operator: "nlb", route: service.code, stopId: stop.id, routeId: service.id } })
    }
    calls.sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999) || a.route.localeCompare(b.route, undefined, { numeric: true }))
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: record.routes,
      calls: calls.slice(0, 12),
    })
  }
  const error = totalFailure
    ? "NLB arrivals could not refresh"
    : partialFailure
      ? `Some NLB arrivals could not refresh (${missed} of ${total})`
      : undefined
  const latest = Math.max(0, ...pairs.map((pair) => remembered.get(`${pair.stopId}/${pair.route}`)?.at ?? 0))
  return {
    ok: nearest.length === 0 || stops.length > 0,
    ...(error ? { error } : {}),
    observedAt: latest > 0 ? new Date(latest).toISOString() : null,
    stale: totalFailure,
    stops,
    cacheable: !totalFailure && !partialFailure,
  }
}

function callAt(route: string, rows: Arrival[], now: number): NlbCall | null {
  let best: NlbCall | null = null
  for (const row of rows) {
    const etaMs = row.estimatedArrivalTime ? nlbArrivalMs(row.estimatedArrivalTime) : NaN
    if (!Number.isFinite(etaMs)) continue
    const minutes = Math.max(0, Math.round((etaMs - now) / 60_000))
    if (best && (best.minutes ?? 999) <= minutes) continue
    best = { route, destTc: "", destEn: "", eta: new Date(etaMs).toISOString(), minutes, scheduled: String(row.departed) === "0" || String(row.noGPS) === "1", remarkTc: "", remarkEn: "" }
  }
  return best
}

async function fetchEta(routeId: string, stopId: string): Promise<Arrival[] | null> {
  const url = `${ETA_ROOT}&routeId=${encodeURIComponent(routeId)}&stopId=${encodeURIComponent(stopId)}&lang=en`
  try {
    const response = await etaQueue(() => fetchUpstreamResilient(url, ETA_FRESH_MS, {
      timeoutMs: 5_000,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    }))
    if (response.servedFromCache || response.status < 200 || response.status >= 300) return null
    const text = new TextDecoder().decode(response.body)
    if (!text) return []
    const body = JSON.parse(text) as { estimatedArrivals?: Arrival[] }
    return Array.isArray(body.estimatedArrivals) ? body.estimatedArrivals : []
  } catch {
    return null
  }
}
