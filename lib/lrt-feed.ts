import { carryArrivalClock, estimateTrains, type TrainObservation } from "./mtr-estimate.ts"
import { lrtPoint, lrtRoutes, lrtStation, lrtStationId } from "./lrt-network.ts"
import { pool } from "./pool.ts"
import { oldestDue } from "./refresh-slice.ts"
import { ETA_FRESH_MS } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn, ETA_REFRESH_TIMEOUT_MS } from "./polite-fetch.ts"
import { parseHongKongTime } from "./mtr-schedule.ts"
import { fetchUpstream } from "./upstream.ts"
import type { LrtBoard, LrtCalling, LrtResponse, MtrTrain } from "./types.ts"

const REMEMBER_MS = 300_000
const REFRESH_SLICE = 12
const FETCH_LIMIT = 4

type TrainRow = {
  route_no?: string
  additionalInfo1?: string
  special?: number
  dest_ch?: string
  dest_en?: string
  time_ch?: string
  time_en?: string
  stop?: number
  arrival_departure?: string
}

type Parsed = { observations: TrainObservation[]; calls: LrtCalling[] }
type Remembered = { at: number; parsed: Parsed }

const remembered = new Map<string, Remembered>()
const attempted = new Map<string, number>()

// Station positions stay in the network file. These calls only refresh arrival minutes.
export async function loadLrtSnapshot(now = Date.now()): Promise<LrtResponse> {
  return takeEtaTurn("lrt", () => collectLrtSnapshot(now))
}

async function collectLrtSnapshot(now: number): Promise<LrtResponse> {
  let missed = 0
  const signal = AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS)
  const stations = lrtRoutes().flatMap((route) => route.stations)
  const ids = [...new Set(stations)]
  const due = oldestDue(ids, (stationId) => attempted.get(stationId) ?? remembered.get(stationId)?.at ?? null, now, ETA_FRESH_MS, REFRESH_SLICE)
  await pool(due, FETCH_LIMIT, async (stationId) => {
    attempted.set(stationId, now)
    const result = await fetchStation(stationId, signal)
    const parsed = result?.parsed
    if (!parsed) { missed += 1; return }
    const previous = remembered.get(stationId)
    remembered.set(stationId, {
      at: result!.at,
      parsed: {
        calls: parsed.calls,
        observations: carryArrivalClock(previous?.parsed.observations ?? [], parsed.observations),
      },
    })
  })

  const boards: LrtBoard[] = []
  const observations: TrainObservation[] = []
  for (const [stationId, item] of remembered) {
    if (now - item.at > REMEMBER_MS) {
      remembered.delete(stationId)
      continue
    }
    boards.push({ station: stationId, observedAt: new Date(item.at).toISOString(), calls: item.parsed.calls })
    observations.push(...item.parsed.observations)
  }
  if (boards.length === 0) {
    return { ok: false, error: "Light Rail arrivals failed", observedAt: null, trains: [], boards: [] }
  }
  const trains = estimateTrains(lrtRoutes(), observations, lrtPoint).map((train): MtrTrain => ({
    id: train.id,
    line: train.line,
    dest: train.dest,
    plat: train.plat,
    ttnt: train.ttnt,
    observedAt: new Date(train.observedAt).toISOString(),
    delay: train.delay,
    timeType: train.timeType,
    anchor: train.anchor,
    path: train.path,
    hold: train.hold,
  }))
  const observedAt = Math.max(...[...remembered.values()].map((item) => item.at))
  return { ok: true, complete: ids.every(id => remembered.has(id)), observedAt: new Date(observedAt).toISOString(), trains, boards, ...(missed > 0 ? { stale: true, error: "Some Light Rail station boards could not refresh" } : {}) }
}

async function fetchStation(stationId: string, signal: AbortSignal): Promise<{ at: number; parsed: Parsed } | null> {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${encodeURIComponent(stationId)}&with_special=1`
  try {
    const response = await etaQueue(() => fetchUpstream(url, ETA_FRESH_MS, {
      timeoutMs: 5_000,
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    }), signal)
    if (response.status !== 200) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as {
      status?: number
      system_time?: string
      platform_list?: { platform_id?: number; route_list?: TrainRow[] }[]
    }
    if (body.status === 0 || !Array.isArray(body.platform_list) || body.platform_list.some(platform => !platform || typeof platform !== "object" || !Array.isArray(platform.route_list))) return null
    const at = body.system_time ? parseHongKongTime(body.system_time) : Date.parse(response.fetchedAt)
    if (at == null) return null
    if (!Number.isFinite(at) || Date.now() - at > REMEMBER_MS || at > Date.now() + 30_000) return null
    return { at, parsed: parsePlatforms(stationId, body.platform_list, at) }
  } catch {
    return null
  }
}

function parsePlatforms(stationId: string, platforms: { platform_id?: number; route_list?: TrainRow[] }[], now: number): Parsed {
  const observations: TrainObservation[] = []
  const calls: LrtCalling[] = []
  for (const platform of platforms) {
    const plat = platform.platform_id == null ? "" : String(platform.platform_id)
    for (const row of platform.route_list ?? []) {
      if (row.stop === 1) continue
      const special = row.special === 1
      const route = special ? text(row.additionalInfo1) || text(row.route_no) : text(row.route_no)
      if (!route || route === "SPR") continue
      const minutes = minutesOf(text(row.time_en), text(row.time_ch))
      if (minutes == null) continue
      const destName = text(row.dest_ch) || text(row.dest_en)
      const dest = lrtStationId(destName)
      if (!dest) continue
      const timeType = row.arrival_departure === "D" ? "D" : "A"
      const station = lrtStation(dest)
      calls.push({
        route,
        dest,
        destTc: station?.tc ?? text(row.dest_ch),
        destEn: station?.en ?? text(row.dest_en),
        ttnt: minutes,
        timeType,
        plat,
      })
      observations.push({
        line: route,
        station: stationId,
        dest,
        plat,
        ttnt: minutes,
        dueAt: now + minutes * 60_000,
        observedAt: now,
        delay: false,
        timeType,
        viaRacecourse: false,
      })
    }
  }
  const soonest = new Map<string, LrtCalling>()
  for (const call of calls) {
    const key = `${call.route}|${call.dest}|${call.plat}`
    const current = soonest.get(key)
    if (!current || call.ttnt < current.ttnt) soonest.set(key, call)
  }
  return { observations, calls: [...soonest.values()] }
}

function minutesOf(timeEn: string, timeCh: string): number | null {
  const english = /(\d+)\s*mins?/i.exec(timeEn)
  if (english?.[1]) return Number(english[1])
  const chinese = /(\d+)\s*分鐘/.exec(timeCh)
  if (chinese?.[1]) return Number(chinese[1])
  if (/arriving|departing/i.test(timeEn) || timeEn === "-" || timeCh.includes("即將") || timeCh.includes("正在") || timeCh === "-") return 0
  return null
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
