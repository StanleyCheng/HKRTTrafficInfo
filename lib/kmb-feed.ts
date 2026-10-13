import { viewportAllowed } from "./view-cache.ts"
import { busCompany } from "./bus-company.ts"
import { refreshKmbCatalogueSoon } from "./kmb-catalogue.ts"
import { kmbStop, kmbStopsWithin } from "./kmb-network.ts"
import { kmbRoutesAt, refreshKmbRoutesSoon } from "./kmb-routes.ts"
import { isListedKmbRow, kmbReachMetres, STOP_CAP } from "./kmb-reach.ts"
import { arrivalExpired, arrivalObservedAt, arrivalRows, arrivalSnapshot, etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn, ETA_REFRESH_TIMEOUT_MS } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstreamResilient } from "./upstream-resilient.ts"
import { waitForRequest } from "./request-wait.ts"
import type { KmbCall, KmbPlacesResponse, KmbResponse, KmbStopBoard } from "./types.ts"

// All operators share six wire slots. The batch deadline also bounds queue
// waiting; unfinished stops retain their previous arrivals and count as misses.
const FETCH_LIMIT = 8
const ETA_TIMEOUT_MS = 5_000
const ETA_RETRY_TIMEOUT_MS = 2_500
const ETA_ROOT = "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta"

type EtaRow = {
  data_timestamp?: string
  dir?: "I" | "O"
  service_type?: string | number
  seq?: number
  co?: string
  route?: string
  dest_tc?: string
  dest_en?: string
  eta?: string | null
  eta_seq?: number
  rmk_en?: string
  rmk_tc?: string
}

const remembered = new Map<string, HeldRows<EtaRow>>()

export function loadKmbPlaces(lng: number, lat: number, _now = Date.now(), zoom = Number.NaN): KmbPlacesResponse {
  void _now
  if (!viewportAllowed("kmb", lng, lat, zoom)) return { ok: true, stops: [] }
  // A places request must not start background I/O: Workers can cancel it when
  // this synchronous response ends, leaving an orphaned shared pending promise.
  // The ETA request starts and awaits both daily catalogue refreshes below.
  const stops: KmbPlacesResponse["stops"] = []
  for (const stop of kmbStopsWithin(lng, lat, kmbReachMetres(zoom, lat), STOP_CAP)) {
    const record = kmbStop(stop.id)
    if (!record) continue
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: kmbRoutesAt(stop.id),
    })
  }
  return { ok: true, stops }
}

// Poles come from the catalogue. This only refreshes the arrival clock.
export async function loadKmbNear(lng: number, lat: number, now = Date.now(), zoom = Number.NaN): Promise<KmbResponse> {
  if (!viewportAllowed("kmb", lng, lat, zoom)) return { ok: true, observedAt: null, stops: [] }
  const deadline = AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS)
  const catalogueRefresh = Promise.all([refreshKmbCatalogueSoon(now), refreshKmbRoutesSoon(now)])
  forgetStale(remembered, now)
  const nearest = kmbStopsWithin(lng, lat, kmbReachMetres(zoom, lat), STOP_CAP)
  const turn = await takeEtaTurn("kmb", async () => {
    const signal = deadline
    let missed = 0
    await pool(nearest.map((stop) => stop.id), FETCH_LIMIT, async (stopId) => {
      const cached = remembered.get(stopId)
      if (!etaDue(cached, now)) return
      const rows = await fetchStop(stopId, signal)
      if (rows) remembered.set(stopId, rows)
      else missed += 1
    })
    return missed
  }, nearest.map(stop => stop.id).sort().join(","))
  const total = nearest.length
  const missed = turn
  const totalFailure = total > 0 && missed === total
  const partialFailure = !totalFailure && missed > 0
  // Bundled poles are already usable. Slow daily metadata must not keep today's
  // live clock waiting past its deadline; each metadata producer owns its lifetime.
  await waitForRequest(catalogueRefresh, deadline).catch(() => {})

  const stops: KmbStopBoard[] = []
  for (const stop of nearest) {
    const record = kmbStop(stop.id)
    if (!record) continue
    const rows = heldRows(remembered.get(stop.id), now) ?? []
    const observedAt = arrivalObservedAt(remembered.get(stop.id), now)
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: kmbRoutesAt(stop.id),
      observedAt,
      calls: callsAt(rows, now, stop.id),
    })
  }
  const error = totalFailure
    ? "KMB arrivals could not refresh"
    : partialFailure
      ? `Some KMB arrivals could not refresh (${missed} of ${total})`
      : undefined
  const latest = Math.max(0, ...nearest.map((stop) => remembered.get(stop.id)?.at ?? 0))
  return {
    ok: !totalFailure,
    ...(error ? { error } : {}),
    observedAt: latest > 0 ? new Date(latest).toISOString() : null,
    stale: totalFailure,
    stops,
    cacheable: !totalFailure && !partialFailure,
  }
}

function callsAt(rows: EtaRow[], now: number, stopId: string): KmbCall[] {
  const calls: KmbCall[] = []
  for (const row of rows) {
    if (row.eta_seq !== 1) continue
    if (!isListedKmbRow(row)) continue
    const route = text(row.route)
    if (!route) continue
    const etaMs = row.eta ? Date.parse(row.eta) : NaN
    if (arrivalExpired(etaMs, now)) continue
    const hasEta = Number.isFinite(etaMs)
    const remarkTc = isScheduled(row) ? "" : text(row.rmk_tc)
    const remarkEn = isScheduled(row) ? "" : text(row.rmk_en)
    calls.push({
      ...(row.dir && row.service_type != null ? { tracking: { operator: "kmb" as const, company: busCompany(route, text(row.co)), route, stopId, bound: row.dir, serviceType: String(row.service_type), stopSeq: row.seq } } : {}),
      route,
      destTc: text(row.dest_tc),
      destEn: text(row.dest_en),
      eta: hasEta ? new Date(etaMs).toISOString() : "",
      minutes: hasEta ? Math.max(0, Math.round((etaMs - now) / 60_000)) : null,
      scheduled: isScheduled(row),
      remarkTc,
      remarkEn,
      company: busCompany(route, text(row.co)),
    })
  }
  calls.sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999) || a.route.localeCompare(b.route))
  return calls.slice(0, 12)
}

function isScheduled(row: EtaRow): boolean {
  return row.rmk_en === "Scheduled Bus" || row.rmk_tc === "原定班次"
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

async function fetchStop(stopId: string, signal: AbortSignal): Promise<HeldRows<EtaRow> | null> {
  try {
    const response = await etaQueue(() => fetchUpstreamResilient(`${ETA_ROOT}/${encodeURIComponent(stopId)}`, ETA_FRESH_MS, {
      timeoutMs: ETA_TIMEOUT_MS,
      retryTimeoutMs: ETA_RETRY_TIMEOUT_MS,
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    }), signal)
    if (response.servedFromCache || response.status < 200 || response.status >= 300) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { data?: EtaRow[]; generated_timestamp?: string }
    const rows = arrivalRows<EtaRow>(body.data)
    return arrivalSnapshot(rows, response.fetchedAt, [body.generated_timestamp, ...(rows ?? []).map(row => row.data_timestamp)])
  } catch {
    return null
  }
}
