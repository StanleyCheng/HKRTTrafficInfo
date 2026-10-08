import { viewportAllowed } from "./view-cache.ts"
import { busCompany } from "./bus-company.ts"
import { refreshKmbCatalogueSoon } from "./kmb-catalogue.ts"
import { kmbStop, kmbStopsWithin } from "./kmb-network.ts"
import { kmbRoutesAt, refreshKmbRoutesSoon } from "./kmb-routes.ts"
import { isListedKmbRow, kmbReachMetres, STOP_CAP } from "./kmb-reach.ts"
import { etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstream } from "./upstream.ts"
import type { KmbCall, KmbPlacesResponse, KmbResponse, KmbStopBoard } from "./types.ts"

const FETCH_LIMIT = 6
const ETA_ROOT = "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta"

type EtaRow = {
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
  const catalogueRefresh = Promise.all([refreshKmbCatalogueSoon(now), refreshKmbRoutesSoon(now)])
  forgetStale(remembered, now)
  const nearest = kmbStopsWithin(lng, lat, kmbReachMetres(zoom, lat), STOP_CAP)
  const turn = await takeEtaTurn("kmb", async () => {
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
  await catalogueRefresh

  const stops: KmbStopBoard[] = []
  for (const stop of nearest) {
    const record = kmbStop(stop.id)
    if (!record) continue
    const rows = heldRows(remembered.get(stop.id), now) ?? []
    stops.push({
      id: stop.id,
      nameTc: record.tc,
      nameEn: record.en,
      lng: record.lng,
      lat: record.lat,
      routes: kmbRoutesAt(stop.id),
      calls: callsAt(rows, now, stop.id),
    })
  }
  const error = missed > 0 ? "Some KMB arrivals could not refresh" : undefined
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

function callsAt(rows: EtaRow[], now: number, stopId: string): KmbCall[] {
  const calls: KmbCall[] = []
  for (const row of rows) {
    if (row.eta_seq !== 1) continue
    if (!isListedKmbRow(row)) continue
    const route = text(row.route)
    if (!route) continue
    const etaMs = row.eta ? Date.parse(row.eta) : NaN
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

async function fetchStop(stopId: string): Promise<EtaRow[] | null> {
  try {
    const response = await etaQueue(() => fetchUpstream(`${ETA_ROOT}/${encodeURIComponent(stopId)}`, ETA_FRESH_MS, {
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
