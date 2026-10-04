import type { MtrBoard, MtrCalling, MtrTimeType } from "./types.ts"
import type { TrainObservation } from "./mtr-estimate.ts"

export function readSchedule(
  payload: unknown,
  line: string,
  station: string,
  fallbackObservedAt?: number,
): { board: MtrBoard; observations: TrainObservation[] } | null {
  if (!payload || typeof payload !== "object") return null
  const root = payload as Record<string, unknown>
  const data = root.data
  if (!data || typeof data !== "object") return null
  const block = (data as Record<string, unknown>)[`${line}-${station}`]
  if (!block || typeof block !== "object") return null
  const body = block as Record<string, unknown>
  const clock = text(body.curr_time) || text(root.curr_time)
  const observedAt = parseHongKongTime(clock) ?? (Number.isFinite(fallbackObservedAt) ? fallbackObservedAt! : null)
  if (observedAt === null) return null
  const delay = root.isdelay === "Y" || body.isdelay === "Y"
  const trains: MtrCalling[] = []
  const observations: TrainObservation[] = []
  for (const row of [...asList(body.UP), ...asList(body.DOWN)]) {
    if (!row || typeof row !== "object") continue
    const train = row as Record<string, unknown>
    if (train.valid === "N") continue
    const dest = text(train.dest).toUpperCase()
    const ttnt = wholeMinutes(train.ttnt)
    if (!/^[A-Z0-9]{2,5}$/.test(dest) || ttnt === null) continue
    const plat = text(train.plat)
    const timeType: MtrTimeType = train.timeType === "D" || train.timetype === "D" ? "D" : "A"
    const viaRacecourse = train.route === "RAC"
    trains.push({ dest, plat, ttnt, delay, timeType })
    observations.push({
      line,
      station,
      dest,
      plat,
      ttnt,
      dueAt: observedAt + ttnt * 60_000,
      observedAt,
      delay,
      timeType,
      viaRacecourse,
    })
  }
  return {
    board: { line, station, observedAt: new Date(observedAt).toISOString(), message: publicMessage(text(root.message)), trains },
    observations,
  }
}

export function parseHongKongTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null
  const parsed = Date.parse(`${value.replace(" ", "T")}+08:00`)
  return Number.isFinite(parsed) ? parsed : null
}

function publicMessage(value: string): string {
  const textValue = value.trim()
  if (!textValue || textValue === "-" || /^successful$/i.test(textValue) || /^ok$/i.test(textValue)) return ""
  return textValue
}

function wholeMinutes(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 90) return null
  return parsed
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") return [value]
  return []
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
