import { timetableApplies } from "./ferry-clock.ts"
import { SUN_ROUTES } from "./ferry-routes.ts"
import { parseCsv } from "./traffic-parsing.ts"

export type FerryTimetable = {
  route: string
  pierId: string
  destTc: string
  destEn: string
  times: string[]
  nextDayTimes: string[]
  firstFerry: string
  lastFerry: string
}

type Direction = { route: string; pierId: string; fromEn: string; destTc: string; destEn: string }
type HkkfRoute = { id: number; from: string; to: string; fromTc: string; fromEn: string; toTc: string; toEn: string }

export function parseSunTimetable(csv: string, now: number, holiday: boolean): FerryTimetable[] {
  return parseTimetable(csv, now, holiday, SUN_ROUTES.map(route => ({ route: route.code, pierId: route.from, fromEn: route.fromEn, destTc: route.destTc, destEn: route.destEn })), false)
}

export function parseHkkfTimetable(csv: string, now: number, holiday: boolean, routes: readonly HkkfRoute[]): FerryTimetable[] {
  return parseTimetable(csv, now, holiday, routes.flatMap(route => [
    { route: String(route.id), pierId: route.from, fromEn: route.fromEn, destTc: route.toTc, destEn: route.toEn },
    { route: String(route.id), pierId: route.to, fromEn: route.toEn, destTc: route.fromTc, destEn: route.fromEn },
  ]), true)
}

function parseTimetable(csv: string, now: number, holiday: boolean, directions: Direction[], hkkf: boolean): FerryTimetable[] {
  const day = new Date(now + 8 * 60 * 60_000).getUTCDay()
  const boards = new Map<string, FerryTimetable>()
  for (const [direction = "", service = "", printed = "", remark = ""] of parseCsv(csv)) {
    const name = direction.trim().replace(/Chueung/g, "Cheung").replace(/\s+/g, " ")
    const leg = directions.find(item => `${item.fromEn} to ${item.destEn}` === name)
    if (!leg || (!/^daily$/i.test(service.trim()) && !timetableApplies(service, day, holiday))) continue
    const flag = Number(remark)
    // Operator data dictionaries define these as restricted or demand-only trips.
    if (hkkf) {
      if (leg.route === "1" && flag === 1) continue
      if (leg.route === "2" && flag === 1 && (day !== 6 || holiday)) continue
    } else {
      const cheungChau = leg.route === "CECC" || leg.route === "CCCE"
      const muiWo = leg.route === "CEMW" || leg.route === "MWCE"
      const weekdayOnly = (cheungChau && (flag === 2 || flag === 4)) || (/^(NPHH|HHNP|NPKC|KCNP)$/.test(leg.route) && flag === 1)
      if (weekdayOnly && (day === 0 || day === 6 || holiday)) continue
      if ((cheungChau || muiWo) && flag === 3 && (day !== 6 || holiday)) continue
    }
    const time = timetableClock(printed)
    if (!time) continue
    const key = `${leg.route}:${leg.pierId}`
    const board = boards.get(key) ?? { route: leg.route, pierId: leg.pierId, destTc: leg.destTc, destEn: leg.destEn, times: [], nextDayTimes: [], firstFerry: time, lastFerry: time }
    if (!board.times.includes(time)) board.times.push(time)
    if (hkkf && ((leg.route === "2" && flag === 2) || ((leg.route === "3" || leg.route === "4") && flag === 1))) board.nextDayTimes.push(time)
    board.lastFerry = time
    boards.set(key, board)
  }
  return [...boards.values()]
}

function timetableClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?|noon|midnight)?$/i.exec(value.trim())
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2]), suffix = match[3]?.toLowerCase()
  if (minute > 59 || hour > 23 || (suffix && (hour < 1 || hour > 12))) return null
  if (suffix?.startsWith("a") || suffix === "midnight") hour %= 12
  if (suffix?.startsWith("p") || suffix === "noon") hour = hour % 12 + 12
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}
