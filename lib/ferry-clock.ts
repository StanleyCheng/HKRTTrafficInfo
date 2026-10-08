export type FerryClockCall = {
  route: string
  destTc: string
  destEn: string
  originTc: string
  originEn: string
  arriving: boolean
  eta: string
  minutes: number
  remarkTc: string
  remarkEn: string
  scheduled: boolean
  firstFerry?: string
  lastFerry?: string
}

export function ferryInstant(eta: string, now: number): number | null {
  const trimmed = eta.trim()
  if (!trimmed) return null
  if (trimmed.includes("T")) {
    const iso = Date.parse(trimmed)
    return Number.isFinite(iso) ? iso : null
  }
  const match = /(\d{1,2}):(\d{2})/.exec(trimmed)
  if (!match?.[1] || !match[2]) return null
  let hours = Number(match[1])
  const minutes = Number(match[2])
  if (/pm/i.test(trimmed) && hours < 12) hours += 12
  if (/am/i.test(trimmed) && hours === 12) hours = 0
  const hongKong = new Date(now + 8 * 60 * 60 * 1000)
  const instant = Date.UTC(hongKong.getUTCFullYear(), hongKong.getUTCMonth(), hongKong.getUTCDate(), hours, minutes) - 8 * 60 * 60 * 1000
  if (now - instant > 12 * 60 * 60 * 1000) return instant + 24 * 60 * 60 * 1000
  return instant
}

export function ferryMinutes(eta: string, now: number): number | null {
  const instant = ferryInstant(eta, now)
  if (instant == null || instant < now - 2 * 60_000) return null
  return Math.max(0, Math.round((instant - now) / 60_000))
}

export function ferryCalls(rows: {
  route: string
  destTc: string
  destEn: string
  originTc?: string
  originEn?: string
  arriving?: boolean
  eta: string
  remarkTc?: string
  remarkEn?: string
  scheduled?: boolean
  firstFerry?: string
  lastFerry?: string
}[], now: number): FerryClockCall[] {
  const calls: FerryClockCall[] = []
  for (const row of rows) {
    const minutes = ferryMinutes(row.eta, now)
    if (minutes == null) continue
    calls.push({
      route: row.route,
      destTc: row.destTc,
      destEn: row.destEn,
      originTc: row.originTc ?? "",
      originEn: row.originEn ?? "",
      arriving: row.arriving === true,
      eta: row.eta,
      minutes,
      remarkTc: row.remarkTc ?? "",
      remarkEn: row.remarkEn ?? "",
      scheduled: row.scheduled === true,
      firstFerry: row.firstFerry,
      lastFerry: row.lastFerry,
    })
  }
  calls.sort((a, b) => a.minutes - b.minutes || a.route.localeCompare(b.route))
  return calls.slice(0, 6)
}

export type StarClock = {
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
  scheduled: boolean
  firstFerry: string
  lastFerry: string
}

export function starSailings(sheets: { from: string; csv: string }[], now: number, holiday = false, previousHoliday = false): StarClock[] {
  const hongKong = new Date(now + 8 * 60 * 60 * 1000)
  const day = hongKong.getUTCDay()
  const minuteOfDay = hongKong.getUTCHours() * 60 + hongKong.getUTCMinutes()
  const midnight = Date.UTC(hongKong.getUTCFullYear(), hongKong.getUTCMonth(), hongKong.getUTCDate()) - 8 * 60 * 60 * 1000
  const clocksForNow: StarClock[] = []
  for (const sheet of sheets) {
    const directions = new Map<string, { start: number; end: number; frequency: string }[]>()
    for (const line of sheet.csv.split(/\r?\n/)) {
      const cells = splitCsv(line)
      const direction = cells[0] ?? ""
      const when = cells[1] ?? ""
      const hours = cells[2] ?? ""
      const frequency = cells[3] ?? ""
      if (!direction.includes(" to ")) continue
      const span = hourSpan(hours)
      if (!span) continue
      const previousDay = span.end < span.start && minuteOfDay <= span.end
      if (!timetableApplies(when, previousDay ? (day + 6) % 7 : day, previousDay ? previousHoliday : holiday)) continue
      const start = span.start - (previousDay ? 1440 : 0)
      const end = span.end + (span.end < span.start && !previousDay ? 1440 : 0)
      const bands = directions.get(direction) ?? []
      bands.push({ start, end, frequency })
      directions.set(direction, bands)
    }
    for (const [direction, bands] of directions) {
      bands.sort((a, b) => a.start - b.start)
      const first = Math.min(...bands.map((band) => band.start))
      const last = Math.max(...bands.map((band) => band.end))
      const band = bands.find((item) => minuteOfDay >= item.start && minuteOfDay <= item.end) ?? bands[0]!
      const remark = starFerryRemark(band.frequency)
      const destEn = direction.split(" to ").pop()?.trim() ?? ""
      const place = starPlace(destEn)
      const base: StarClock = {
        route: "天星",
        destTc: place.tc,
        destEn: place.en,
        originTc: "",
        originEn: "",
        arriving: false,
        eta: "",
        pierId: direction.startsWith("Tsim") ? "star-tst" : direction.startsWith("Wan") ? "star-wanchai" : sheet.from,
        remarkTc: `按班次間距估算 · ${remark.remarkTc}`,
        remarkEn: `Headway estimate · ${remark.remarkEn}`,
        scheduled: true,
        firstFerry: displayMinutes(first),
        lastFerry: displayMinutes(last),
      }
      const departures = new Set<number>()
      for (const item of bands) {
        const values = [...item.frequency.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => value > 0)
        if (!values.length) continue
        // ponytail: midpoint headway estimates; replace with actual departures if Star publishes them.
        const headway = values.reduce((total, value) => total + value, 0) / values.length
        for (let minute = item.start; minute <= item.end; minute += headway) departures.add(minute)
        departures.add(item.end)
      }
      for (const minute of [...departures].sort((a, b) => a - b)) {
        clocksForNow.push({ ...base, eta: new Date(midnight + minute * 60_000).toISOString() })
      }
      if (![...departures].some((minute) => midnight + minute * 60_000 >= now)) clocksForNow.push(base)
    }
  }
  return clocksForNow
}

export function timetableApplies(when: string, day: number, holiday = false): boolean {
  if (/daily/i.test(when)) return true
  if (holiday) return /public holidays/i.test(when) && !/except public holidays/i.test(when)
  const mon = /\bmon/i.test(when)
  const fri = /\bfri/i.test(when)
  const sat = /\bsat/i.test(when)
  const sun = /\bsun/i.test(when)
  const coversWeekdays = (mon && fri) || (mon && (sat || sun))
  const coversSaturday = sat || (mon && sun)
  if (day === 6) return coversSaturday
  if (day === 0) return sun
  return coversWeekdays
}

function displayMinutes(value: number): string {
  const minute = (value + 1440) % 1440
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

function hourSpan(value: string): { start: number; end: number } | null {
  const match = /(\d{1,2}):(\d{2})\s*(am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(value)
  if (!match?.[1] || !match[2] || !match[4] || !match[5]) return null
  return { start: clockMinutes(match[1], match[2], match[3]), end: clockMinutes(match[4], match[5], match[6] || match[3]) }
}

function clockMinutes(hourText: string, minuteText: string, suffix: string | undefined): number {
  let hours = Number(hourText)
  const minutes = Number(minuteText)
  if (/pm/i.test(suffix ?? "") && hours < 12) hours += 12
  if (/am/i.test(suffix ?? "") && hours === 12) hours = 0
  return hours * 60 + minutes
}

function splitCsv(line: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted
      continue
    }
    if (char === "," && !quoted) {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function starPlace(dest: string): { tc: string; en: string } {
  if (/tsim/i.test(dest)) return { tc: "尖沙咀", en: "Tsim Sha Tsui" }
  if (/wan/i.test(dest)) return { tc: "灣仔", en: "Wan Chai" }
  return { tc: "中環", en: "Central" }
}

export function starFerryRemark(frequency: string): { remarkTc: string; remarkEn: string } {
  const numbers = [...frequency.matchAll(/\d+/g)].map((match) => match[0]).filter(Boolean)
  const first = numbers[0]
  const second = numbers[1]
  if (!first) return { remarkTc: "", remarkEn: "" }
  if (!second || second === first) return { remarkTc: `${first}分鐘一班`, remarkEn: `every ${first} min` }
  return { remarkTc: `${first}至${second}分鐘一班`, remarkEn: `every ${first} to ${second} min` }
}
