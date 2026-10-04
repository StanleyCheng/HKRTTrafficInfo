import { ferryCalls, ferryMinutes, starSailings } from "./ferry-clock.ts"
import { estimateFerryVessels, type FerryMark, type FerryTrack } from "./ferry-run.ts"
import { fortuneDepartureTimes, nextFortuneDepartures } from "./fortune-timetable.ts"
import { SUN_ROUTES } from "./ferry-routes.ts"
import { etaDue, ETA_FRESH_MS, forgetStale, heldRows, type HeldRows } from "./place-arrivals.ts"
import { etaQueue, takeEtaTurn } from "./polite-fetch.ts"
import { pool } from "./pool.ts"
import { fetchUpstream } from "./upstream.ts"
import type { FerryCall, FerryResponse, FerryVessel } from "./types.ts"
import piersFile from "../data/ferry-piers.json" with { type: "json" }

type PierRecord = { id: string; nameTc: string; nameEn: string; lng: number; lat: number }
type PierFile = { piers: PierRecord[] }

const piers = (piersFile as PierFile).piers
const FETCH_LIMIT = 4

const HKKF_ROUTES: { id: number; from: string; to: string; fromTc: string; fromEn: string; toTc: string; toEn: string }[] = [
  { id: 1, from: "hkkf-central", to: "hkkf-sok-kwu-wan", fromTc: "中環", fromEn: "Central", toTc: "索罟灣", toEn: "Sok Kwu Wan" },
  { id: 2, from: "hkkf-central", to: "hkkf-yung-shue-wan", fromTc: "中環", fromEn: "Central", toTc: "榕樹灣", toEn: "Yung Shue Wan" },
  { id: 3, from: "hkkf-central-6", to: "hkkf-peng-chau", fromTc: "中環", fromEn: "Central", toTc: "坪洲", toEn: "Peng Chau" },
  { id: 4, from: "hkkf-peng-chau", to: "hkkf-hei-ling-chau", fromTc: "坪洲", fromEn: "Peng Chau", toTc: "喜靈洲", toEn: "Hei Ling Chau" },
]

const STAR_SHEETS = [
  { url: "https://www.starferry.com.hk/sites/default/files/upload/open_data/csv/ferry_sf_central_tsimshatsui_timetable_eng.csv", from: "star-central", to: "star-tst" },
  { url: "https://www.starferry.com.hk/sites/default/files/upload/open_data/csv/ferry_sf_wanchai_tsimshatsui_timetable_eng.csv", from: "star-wanchai", to: "star-tst" },
]

type Clock = {
  route: string
  destTc: string
  destEn: string
  originTc: string
  originEn: string
  arriving: boolean
  eta: string
  pierId: string
  remarkTc: string
  remarkEn: string
  scheduled?: boolean
}
type SunFix = { vessel: FerryVessel | null; clocks: Clock[] }

const clocks = new Map<string, HeldRows<Clock>>()
const vessels = new Map<string, HeldRows<FerryVessel | null>>()
const feedFaults = new Map<string, string>()
let starText: { at: number; sheets: { from: string; csv: string }[] } | null = null
let fortunePages: { at: number; pages: { pierId: string; destTc: string; destEn: string; html: string }[] } | null = null

const FORTUNE_LEGS = [
  { origin: "16", destination: "17", pierId: "sun-north-point", destTc: "觀塘", destEn: "Kwun Tong" },
  { origin: "17", destination: "16", pierId: "fortune-kwun-tong", destTc: "北角", destEn: "North Point" },
  { origin: "17", destination: "18", pierId: "fortune-kwun-tong", destTc: "啟德", destEn: "Kai Tak" },
]

export async function loadFerrySnapshot(now = Date.now()): Promise<FerryResponse> {
  forgetStale(clocks, now)
  forgetStale(vessels, now)
  const turn = await takeEtaTurn(() => refreshFerryClock(now))
  return ferryBoard(now, turn !== null)
}

async function refreshFerryClock(now: number): Promise<true> {
  const jobs = [
    ...SUN_ROUTES.map((route) => ({ key: `sun:${route.code}`, run: () => fetchSun(route) })),
    ...HKKF_ROUTES.flatMap((route) => (["inbound", "outbound"] as const).map((direction) => ({
      key: `hkkf:${route.id}:${direction}`,
      run: () => fetchHkkf(route, direction),
    }))),
  ]
  const due = jobs.filter((job) => etaDue(clocks.get(job.key), now))
  await pool(due, FETCH_LIMIT, async (job) => {
    const result = await job.run()
    if (!result) {
      feedFaults.set(job.key, `${job.key.startsWith("sun:") ? "Sun Ferry" : "HKKF"} arrivals unavailable`)
      return
    }
    feedFaults.delete(job.key)
    clocks.set(job.key, { at: now, rows: result.clocks })
    if (job.key.startsWith("sun:")) vessels.set(job.key, { at: now, rows: result.vessel ? [result.vessel] : [] })
  })
  await rememberStar(now)
  await rememberFortune(now)
  return true
}

function ferryBoard(now: number, fresh: boolean): FerryResponse {
  const byPier = new Map<string, FerryCall[]>()
  for (const item of clocks.values()) {
    const rows = heldRows(item, now) ?? []
    for (const row of rows) {
      const timed = row.eta ? ferryCalls([row], now)[0] : null
      const call = timed ?? (row.remarkTc || row.remarkEn
        ? {
            route: row.route,
            destTc: row.destTc,
            destEn: row.destEn,
            originTc: row.originTc,
            originEn: row.originEn,
            arriving: row.arriving,
            eta: "",
            minutes: null,
            remarkTc: row.remarkTc,
            remarkEn: row.remarkEn,
            scheduled: row.scheduled === true,
          }
        : null)
      if (!call) continue
      const list = byPier.get(row.pierId) ?? []
      list.push(call)
      byPier.set(row.pierId, list)
    }
  }
  const boards = piers.map((pier) => ({
    id: pier.id,
    nameTc: pier.nameTc,
    nameEn: pier.nameEn,
    lng: pier.lng,
    lat: pier.lat,
    calls: (byPier.get(pier.id) ?? []).sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999)).slice(0, 6),
  }))
  const moving: FerryVessel[] = []
  const gpsRoutes = new Set<string>()
  for (const item of vessels.values()) {
    for (const vessel of heldRows(item, now) ?? []) {
      if (!vessel) continue
      gpsRoutes.add(vessel.route)
      moving.push({ ...vessel, minutes: ferryMinutes(vessel.eta, now) })
    }
  }
  const marks: FerryMark[] = []
  for (const item of clocks.values()) {
    for (const row of heldRows(item, now) ?? []) marks.push(row)
  }
  moving.push(...estimateFerryVessels(ferryTracks(), marks, gpsRoutes, pierPoint, now))
  const error = [...new Set(feedFaults.values())].join("; ")
  const latest = Math.max(0, ...[...clocks.values()].map((item) => item.at))
  return { ok: true, ...(error ? { error } : {}), stale: !fresh || Boolean(error), observedAt: latest > 0 ? new Date(latest).toISOString() : null, piers: boards, vessels: moving, cacheable: fresh && !error }
}

function ferryTracks(): FerryTrack[] {
  const tracks: FerryTrack[] = SUN_ROUTES.map((route) => ({
    route: route.code,
    fromId: route.from,
    toId: route.to,
    fromTc: route.fromTc,
    fromEn: route.fromEn,
    toTc: route.destTc,
    toEn: route.destEn,
    destTc: route.destTc,
  }))
  for (const route of HKKF_ROUTES) {
    tracks.push({
      route: String(route.id),
      fromId: route.from,
      toId: route.to,
      fromTc: route.fromTc,
      fromEn: route.fromEn,
      toTc: route.toTc,
      toEn: route.toEn,
      destTc: route.toTc,
    })
    tracks.push({
      route: String(route.id),
      fromId: route.to,
      toId: route.from,
      fromTc: route.toTc,
      fromEn: route.toEn,
      toTc: route.fromTc,
      toEn: route.fromEn,
      destTc: route.fromTc,
    })
  }
  for (const leg of FORTUNE_LEGS) {
    const toId = leg.destination === "17" ? "fortune-kwun-tong" : leg.destination === "16" ? "sun-north-point" : ""
    const to = toId === "fortune-kwun-tong"
      ? { tc: "觀塘", en: "Kwun Tong" }
      : toId === "sun-north-point"
        ? { tc: "北角", en: "North Point" }
        : { tc: leg.destTc, en: leg.destEn }
    const from = leg.pierId === "sun-north-point"
      ? { tc: "北角", en: "North Point" }
      : { tc: "觀塘", en: "Kwun Tong" }
    tracks.push({
      route: "富裕",
      fromId: leg.pierId,
      toId,
      fromTc: from.tc,
      fromEn: from.en,
      toTc: to.tc,
      toEn: to.en,
      destTc: leg.destTc,
    })
  }
  return tracks
}

function pierPoint(id: string): { lng: number; lat: number } | null {
  const pier = piers.find((item) => item.id === id)
  return pier ? { lng: pier.lng, lat: pier.lat } : null
}

async function fetchSun(route: (typeof SUN_ROUTES)[number]): Promise<SunFix | null> {
  try {
    const response = await etaQueue(() => fetchUpstream(`https://www.sunferry.com.hk/eta/?route=${encodeURIComponent(route.code)}`, ETA_FRESH_MS, {
      timeoutMs: 8_000,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)" },
    }))
    if (response.status !== 200) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { data?: Record<string, unknown>[] }
    const row = body.data?.[0]
    if (!row) return { vessel: null, clocks: [] }
    const depart = text(row.depart_time)
    const arrive = text(row.eta)
    const remarkTc = text(row.rmk_tc)
    const remarkEn = text(row.rmk_en)
    const next: Clock[] = []
    if (depart) {
      next.push({
        route: route.code,
        destTc: route.destTc,
        destEn: route.destEn,
        originTc: "",
        originEn: "",
        arriving: false,
        eta: depart,
        pierId: route.from,
        remarkTc,
        remarkEn,
      })
    }
    if (arrive) {
      next.push({
        route: route.code,
        destTc: route.destTc,
        destEn: route.destEn,
        originTc: route.fromTc,
        originEn: route.fromEn,
        arriving: true,
        eta: arrive,
        pierId: route.to,
        remarkTc,
        remarkEn,
      })
    }
    const lng = Number(row.lng)
    const lat = Number(row.lat)
    const vessel: FerryVessel | null = Number.isFinite(lng) && Number.isFinite(lat) && lat > 22 && lat < 23 && lng > 113 && lng < 115
      ? {
          id: `${route.code}-${text(row.vesselcode) || "boat"}`,
          nameTc: `${route.fromTc} – ${route.destTc}`,
          nameEn: `${route.fromEn} – ${route.destEn}`,
          lng,
          lat,
          route: route.code,
          eta: arrive || depart,
          minutes: null,
          fix: "gps",
        }
      : null
    return { vessel, clocks: next }
  } catch {
    return null
  }
}

async function fetchHkkf(route: (typeof HKKF_ROUTES)[number], direction: "inbound" | "outbound"): Promise<SunFix | null> {
  try {
    const response = await etaQueue(() => fetchUpstream(`https://www.hkkfeta.com/opendata/eta/${route.id}/${direction}`, ETA_FRESH_MS, {
      timeoutMs: 8_000,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)" },
    }))
    if (response.status !== 200) return null
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { data?: Record<string, unknown>[] }
    const row = body.data?.[0]
    if (!row) return { vessel: null, clocks: [] }
    const depart = text(row.session_time)
    const arrive = text(row.ETA)
    const towardsDest = direction === "outbound"
    const next: Clock[] = []
    const destTc = towardsDest ? route.toTc : route.fromTc
    const destEn = towardsDest ? route.toEn : route.fromEn
    const originTc = towardsDest ? route.fromTc : route.toTc
    const originEn = towardsDest ? route.fromEn : route.toEn
    if (depart) {
      next.push({
        route: String(route.id),
        destTc,
        destEn,
        originTc: "",
        originEn: "",
        arriving: false,
        eta: depart,
        pierId: towardsDest ? route.from : route.to,
        remarkTc: "",
        remarkEn: "",
      })
    }
    if (arrive) {
      next.push({
        route: String(route.id),
        destTc,
        destEn,
        originTc,
        originEn,
        arriving: true,
        eta: arrive,
        pierId: towardsDest ? route.to : route.from,
        remarkTc: "",
        remarkEn: "",
      })
    }
    return { vessel: null, clocks: next }
  } catch {
    return null
  }
}

async function rememberStar(now: number): Promise<void> {
  if (!starText || now - starText.at > 24 * 60 * 60 * 1000) {
    const sheets: { from: string; csv: string }[] = []
    for (const sheet of STAR_SHEETS) {
      try {
        const response = await fetchUpstream(sheet.url, 24 * 60 * 60 * 1000, { timeoutMs: 15_000, headers: { Accept: "text/csv" } })
        if (response.status !== 200) continue
        sheets.push({ from: sheet.from, csv: new TextDecoder().decode(response.body) })
      } catch {
        // The previous day's table stays in starText when a sheet fails.
      }
    }
    if (sheets.length > 0) starText = { at: now, sheets }
    if (sheets.length === STAR_SHEETS.length) feedFaults.delete("star")
    else feedFaults.set("star", "Star Ferry timetable unavailable")
  }
  if (!starText) return
  const rows = starSailings(starText.sheets, now)
  clocks.set("star", { at: now, rows })
}

async function rememberFortune(now: number): Promise<void> {
  if (!fortunePages || now - fortunePages.at > 60 * 60 * 1000) {
    const date = hongKongDate(now)
    const pages: { pierId: string; destTc: string; destEn: string; html: string }[] = []
    let fault: string | null = null
    for (const leg of FORTUNE_LEGS) {
      try {
        const url = `https://www.fortuneferry.com.hk/zh/route-and-fare?route=3&origin=${leg.origin}&destination=${leg.destination}&departure_date=${date}`
        const response = await etaQueue(() => fetchUpstream(url, 60 * 60 * 1000, {
          timeoutMs: 15_000,
          headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)" },
        }))
        if (response.status !== 200) throw new Error("Fortune Ferry timetable unavailable")
        const html = new TextDecoder().decode(response.body)
        fortuneDepartureTimes(html)
        pages.push({ pierId: leg.pierId, destTc: leg.destTc, destEn: leg.destEn, html })
      } catch (error) {
        fault = error instanceof Error ? error.message : "Fortune Ferry timetable unavailable"
        // Keep the previous hour's page when one direction fails.
      }
    }
    if (fault) feedFaults.set("fortune", fault)
    else feedFaults.delete("fortune")
    // Replace a full timetable atomically, preserving good directions on partial failure.
    if (pages.length === FORTUNE_LEGS.length) fortunePages = { at: now, pages }
  }
  if (!fortunePages) return
  const rows: Clock[] = []
  for (const page of fortunePages.pages) {
    for (const eta of nextFortuneDepartures(fortuneDepartureTimes(page.html), now)) {
      rows.push({
        route: "富裕",
        destTc: page.destTc,
        destEn: page.destEn,
        originTc: "",
        originEn: "",
        arriving: false,
        eta,
        pierId: page.pierId,
        remarkTc: "船期",
        remarkEn: "Timetable",
        scheduled: true,
      })
    }
  }
  clocks.set("fortune", { at: now, rows })
}

function hongKongDate(now: number): string {
  const hongKong = new Date(now + 8 * 60 * 60 * 1000)
  const month = String(hongKong.getUTCMonth() + 1).padStart(2, "0")
  const day = String(hongKong.getUTCDate()).padStart(2, "0")
  return `${hongKong.getUTCFullYear()}-${month}-${day}`
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
