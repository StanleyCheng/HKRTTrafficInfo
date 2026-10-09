import { ferryCalls, ferryInstant, ferryMinutes, starSailings } from "./ferry-clock.ts"
import { estimateFerryVessels, type FerryMark, type FerryTrack } from "./ferry-run.ts"
import { fortuneDepartureTimes } from "./fortune-timetable.ts"
import { ferryFairway } from "./ferry-fairway.ts"
import { parseSunTimetable, parseHkkfTimetable } from "./ferry-timetable.ts"
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
  firstFerry?: string
  lastFerry?: string
}
type SunFix = { vessel: FerryVessel | null; clocks: Clock[] }

const clocks = new Map<string, HeldRows<Clock>>()
const vessels = new Map<string, HeldRows<FerryVessel | null>>()
const feedFaults = new Map<string, string>()
let starText: { at: number; sheets: { from: string; csv: string }[] } | null = null
let fortunePages: { at: number; pages: { pierId: string; destTc: string; destEn: string; html: string }[] } | null = null
let holidays: { at: number; dates: string[] } | null = null
const timetableText = new Map<string, { at: number; csv: string }>()
const TIMETABLE_URLS = [
  ...["central_cheungchau", "central_muiwo", "interislands", "northpoint_hunghom", "northpoint_kowlooncity"]
    .map((route) => `https://www.sunferry.com.hk/eta/timetable/SunFerry_${route}_timetable_eng.csv`),
  ...["pc", "ysw", "skw"].map((route) => `https://www.td.gov.hk/datagovhk_td/ferry-tt-ft/resources/en/ferry_central_${route}_timetable_eng.csv`),
]

const FORTUNE_LEGS = [
  { origin: "16", destination: "17", pierId: "sun-north-point", destTc: "觀塘", destEn: "Kwun Tong" },
  { origin: "17", destination: "16", pierId: "fortune-kwun-tong", destTc: "北角", destEn: "North Point" },
  { origin: "17", destination: "18", pierId: "fortune-kwun-tong", destTc: "啟德", destEn: "Kai Tak" },
]

export async function loadFerrySnapshot(now = Date.now()): Promise<FerryResponse> {
  forgetStale(clocks, now)
  forgetStale(vessels, now)
  // takeEtaTurn now joins the in-flight promise; the refresh always runs for the
  // first caller and shares its result with any concurrent callers.
  await takeEtaTurn("ferry", () => refreshFerryClock(now))
  return ferryBoard(now)
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
  const live = pool(due, FETCH_LIMIT, async (job) => {
    const result = await job.run()
    if (!result) {
      feedFaults.set(job.key, `${job.key.startsWith("sun:") ? "Sun Ferry" : "HKKF"} arrivals unavailable`)
      return
    }
    feedFaults.delete(job.key)
    clocks.set(job.key, { at: now, rows: result.clocks })
    if (job.key.startsWith("sun:")) vessels.set(job.key, { at: now, rows: result.vessel ? [result.vessel] : [] })
  })
  await Promise.all([
    live,
    rememberFortune(now),
    rememberHolidays(now).then(() => Promise.all([rememberStar(now), rememberTimetables(now)])),
  ])
  return true
}

function ferryBoard(now: number): FerryResponse {
  const byPier = new Map<string, FerryCall[]>()
  const rows = [...clocks.values()].flatMap((item) => heldRows(item, now) ?? [])
  const key = (row: Clock) => `${row.route}:${row.pierId}:${row.destTc}`
  const bounds = new Map(rows.filter((row) => row.firstFerry).map((row) => [key(row), row]))
  const live = new Set(rows.filter((row) => !row.scheduled && !row.arriving && (ferryInstant(row.eta, now) ?? 0) >= now).map(key))
  const activeRows = rows.filter((row) => !row.scheduled || !live.has(key(row)))
  for (const row of activeRows) {
      if (!row.arriving && row.eta && (ferryInstant(row.eta, now) ?? 0) < now) continue
      const schedule = bounds.get(key(row))
      if (schedule && !row.arriving) {
        row.firstFerry = schedule.firstFerry
        row.lastFerry = schedule.lastFerry
      }
      const timed = row.eta ? ferryCalls([row], now)[0] : null
      const call = timed ?? (!row.eta && (row.remarkTc || row.remarkEn || row.firstFerry || row.lastFerry)
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
            firstFerry: row.firstFerry,
            lastFerry: row.lastFerry,
          }
        : null)
      if (!call) continue
      const list = byPier.get(row.pierId) ?? []
      list.push(call)
      byPier.set(row.pierId, list)
  }
  const boards = piers.map((pier) => ({
    id: pier.id,
    nameTc: pier.nameTc,
    nameEn: pier.nameEn,
    lng: pier.lng,
    lat: pier.lat,
    calls: (byPier.get(pier.id) ?? []).sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))
      .filter((call, index, all) => all.findIndex((other) => other.route === call.route && other.destTc === call.destTc && other.arriving === call.arriving && other.originTc === call.originTc) === index),
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
  marks.push(...activeRows)
  moving.push(...estimateFerryVessels(ferryTracks(), marks, gpsRoutes, pierPoint, now))
  const error = [...new Set(feedFaults.values())].join("; ")
  const latest = Math.max(0, ...[...clocks.values()].map((item) => item.at))
  // Per-feed sub-requests can fail individually; only mark stale when something
  // actually broke upstream. Module-scope `feedFaults` flags per-key failures.
  const stale = Boolean(error)
  return { ok: true, ...(error ? { error } : {}), stale, observedAt: latest > 0 ? new Date(latest).toISOString() : null, piers: boards, vessels: moving, cacheable: !error }
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
  for (const sheet of STAR_SHEETS) {
    for (const [fromId, toId] of [[sheet.from, sheet.to], [sheet.to, sheet.from]]) {
      const from = piers.find((pier) => pier.id === fromId)!
      const to = piers.find((pier) => pier.id === toId)!
      tracks.push({ route: "天星", fromId: from.id, toId: to.id, fromTc: from.nameTc, fromEn: from.nameEn,
        toTc: to.id === "star-tst" ? "尖沙咀" : to.id === "star-central" ? "中環" : "灣仔",
        toEn: to.id === "star-tst" ? "Tsim Sha Tsui" : to.id === "star-central" ? "Central" : "Wan Chai",
        destTc: to.id === "star-tst" ? "尖沙咀" : to.id === "star-central" ? "中環" : "灣仔",
        // Journey times printed in the official Star Ferry CSV headers.
        crossingMinutes: sheet.from === "star-central" ? 9 : 8 })
    }
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
    const from = pierPoint(route.from)
    const to = pierPoint(route.to)
    const path = from && to ? ferryFairway(route.from, route.to, from, to) : []
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
          destTc: route.destTc,
          destEn: route.destEn,
          pathLng: path.map((point) => point.lng),
          pathLat: path.map((point) => point.lat),
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
    await pool(STAR_SHEETS, FETCH_LIMIT, async (sheet) => {
      try {
        const response = await fetchUpstream(sheet.url, 24 * 60 * 60 * 1000, { timeoutMs: 15_000, headers: { Accept: "text/csv" } })
        if (response.status !== 200) return
        sheets.push({ from: sheet.from, csv: new TextDecoder().decode(response.body) })
      } catch {
        // The previous day's table stays in starText when a sheet fails.
      }
    })
    if (sheets.length) starText = { at: now, sheets: [...sheets, ...(starText?.sheets ?? []).filter((old) => !sheets.some((sheet) => sheet.from === old.from))] }
    if (sheets.length === STAR_SHEETS.length) feedFaults.delete("star")
    else feedFaults.set("star", "Star Ferry timetable unavailable")
  }
  if (!starText) return
  const holiday = isHoliday(now)
  if (holiday == null) { clocks.delete("star"); return }
  const rows = starSailings(starText.sheets, now, holiday, isHoliday(now - 24 * 60 * 60 * 1000) ?? false)
  clocks.set("star", { at: now, rows })
}

async function rememberFortune(now: number): Promise<void> {
  if (!fortunePages || now - fortunePages.at > 60 * 60 * 1000 || hongKongDate(fortunePages.at) !== hongKongDate(now)) {
    const date = hongKongDate(now)
    const pages: { pierId: string; destTc: string; destEn: string; html: string }[] = []
    let fault: string | null = null
    await pool(FORTUNE_LEGS, FETCH_LIMIT, async (leg) => {
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
    })
    if (fault) feedFaults.set("fortune", fault)
    else feedFaults.delete("fortune")
    // A failed leg must not hide the other directions. Keep its last same-day table.
    if (pages.length) {
      const previous = fortunePages && hongKongDate(fortunePages.at) === date ? fortunePages.pages : []
      fortunePages = { at: now, pages: [...pages, ...previous.filter((old) => !pages.some((page) => page.pierId === old.pierId && page.destEn === old.destEn))] }
    }
  }
  if (!fortunePages || hongKongDate(fortunePages.at) !== hongKongDate(now)) {
    clocks.delete("fortune")
    return
  }
  const rows: Clock[] = []
  for (const page of fortunePages.pages) {
    const times = fortuneDepartureTimes(page.html).sort()
    const departures = times.map((time) => `${hongKongDate(now)}T${time}:00+08:00`)
    if (!departures.some((eta) => Date.parse(eta) >= now)) departures.push("")
    for (const eta of departures) {
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
        firstFerry: times[0],
        lastFerry: times[times.length - 1],
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

async function rememberHolidays(now: number): Promise<void> {
  if (holidays && now - holidays.at < 24 * 60 * 60 * 1000) return
  try {
    const response = await fetchUpstream("https://www.1823.gov.hk/common/ical/en.json", 24 * 60 * 60 * 1000, { timeoutMs: 8_000 })
    if (response.status !== 200) throw new Error("Holiday calendar unavailable")
    const body = JSON.parse(new TextDecoder().decode(response.body).replace(/^\uFEFF/, "")) as { vcalendar?: { vevent?: { dtstart?: unknown[] }[] }[] }
    const dates = (body.vcalendar?.[0]?.vevent ?? []).map((event) => event.dtstart?.[0])
      .filter((date): date is string => typeof date === "string" && /^\d{8}$/.test(date))
    if (!dates.some((date) => date.startsWith(hongKongDate(now).slice(0, 4)))) throw new Error("Holiday calendar unavailable")
    holidays = { at: now, dates }
    feedFaults.delete("holidays")
  } catch { feedFaults.set("holidays", "Holiday calendar unavailable") }
}

function isHoliday(now: number): boolean | null {
  const date = hongKongDate(now).replaceAll("-", "")
  if (!holidays?.dates.some((day) => day.startsWith(date.slice(0, 4)))) return null
  return holidays.dates.includes(date)
}

async function rememberTimetables(now: number): Promise<void> {
  const holiday = isHoliday(now)
  if (holiday == null) { clocks.delete("timetables"); return }
  await pool(TIMETABLE_URLS, FETCH_LIMIT, async (url) => {
    if (now - (timetableText.get(url)?.at ?? 0) < 24 * 60 * 60 * 1000) return
    try {
      const response = await fetchUpstream(url, 24 * 60 * 60 * 1000, { timeoutMs: 8_000, headers: { Accept: "text/csv" } })
      if (response.status !== 200) throw new Error("Timetable unavailable")
      const csv = new TextDecoder().decode(response.body)
      const parsed = url.includes("sunferry") ? parseSunTimetable(csv, now, holiday) : parseHkkfTimetable(csv, now, holiday, HKKF_ROUTES)
      if (!parsed.length) throw new Error("Timetable unavailable")
      timetableText.set(url, { at: now, csv })
      feedFaults.delete(url)
    } catch { feedFaults.set(url, `${url.includes("sunferry") ? "Sun Ferry" : "HKKF"} timetable unavailable`) }
  })
  const rows: Clock[] = []
  for (const [url, table] of timetableText) {
    for (const day of [now - 24 * 60 * 60 * 1000, now]) {
      const dayHoliday = isHoliday(day)
      if (dayHoliday == null) continue
      const schedules = url.includes("sunferry") ? parseSunTimetable(table.csv, day, dayHoliday) : parseHkkfTimetable(table.csv, day, dayHoliday, HKKF_ROUTES)
      for (const schedule of schedules) {
        const today = hongKongDate(day) === hongKongDate(now)
        const departures = schedule.times.filter((time) => today || schedule.nextDayTimes.includes(time)).map((time) =>
          `${hongKongDate(day + (schedule.nextDayTimes.includes(time) ? 24 * 60 * 60 * 1000 : 0))}T${time}:00+08:00`)
        if (today && !departures.some((eta) => Date.parse(eta) >= now)) departures.push("")
        for (const eta of departures) rows.push({ ...schedule, originTc: "", originEn: "", arriving: false, eta,
          scheduled: true, remarkTc: "船期", remarkEn: "Timetable" })
      }
    }
  }
  clocks.set("timetables", { at: now, rows })
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
