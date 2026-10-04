import { metresBetween, projectTrain, segmentMinutes, type GeoPoint } from "./mtr-estimate.ts"
import type { MtrTrain } from "./types.ts"

export type TrainRun = {
  id: string
  line: string
  dest: string
  path: string[]
  distance: number
  speed: number
  cruise: number
  color: string
  plat: string
  delay: boolean
  timeType: "A" | "D"
  seenAt: number
}

const MATCH_METRES = 1500
const COAST_MS = 20_000
const MAX_SPEED = 20

let nextRunId = 1

export function runsFromTrains(
  trains: MtrTrain[],
  locate: (code: string) => GeoPoint | null,
  colorOf: (line: string) => string,
  now: number,
): TrainRun[] {
  const runs: TrainRun[] = []
  for (const train of trains) {
    const observedAt = Date.parse(train.observedAt)
    if (!Number.isFinite(observedAt)) continue
    const spot = projectTrain({ ...train, observedAt }, locate, now)
    if (!spot) continue
    const distance = distanceOfSpot(train.path, spot, locate)
    const cruise = cruiseAt(train.path, distance, locate)
    const id = nextRunId
    nextRunId += 1
    runs.push({
      id: `run-${train.line}-${train.dest}-${id}`,
      line: train.line,
      dest: train.dest,
      path: train.path,
      distance,
      speed: cruise,
      cruise,
      color: colorOf(train.line),
      plat: train.plat,
      delay: train.delay,
      timeType: train.timeType,
      seenAt: now,
    })
  }
  return runs
}

export function advanceRuns(runs: TrainRun[], dtSec: number, locate: (code: string) => GeoPoint | null): TrainRun[] {
  const dt = Math.max(0, dtSec)
  return runs.map((run) => {
    const end = pathEnd(run.path, locate)
    const cruiseNow = cruiseAt(run.path, run.distance, locate)
    const speed = run.speed > 0 ? run.speed : cruiseNow
    const distance = Math.min(end, run.distance + speed * dt)
    const cruise = cruiseAt(run.path, distance, locate)
    return {
      ...run,
      distance,
      cruise,
      speed: distance >= end - 1 ? 0 : cruise,
    }
  })
}

export function mergeRuns(previous: TrainRun[], incoming: TrainRun[], now: number): TrainRun[] {
  const used = new Set<number>()
  const kept: TrainRun[] = []
  for (const run of previous) {
    let best = -1
    let bestGap = MATCH_METRES
    incoming.forEach((item, index) => {
      if (used.has(index) || item.line !== run.line || item.dest !== run.dest || item.path.join(">") !== run.path.join(">")) return
      const gap = Math.abs(item.distance - run.distance)
      if (gap < bestGap) {
        best = index
        bestGap = gap
      }
    })
    if (best < 0) {
      if (now - run.seenAt < COAST_MS) kept.push(run)
      continue
    }
    used.add(best)
    const item = incoming[best]
    if (!item) continue
    const ahead = item.distance - run.distance
    const speed = ahead > 30 ? Math.min(MAX_SPEED, Math.max(run.cruise, ahead / 30)) : run.cruise
    kept.push({
      ...run,
      speed,
      plat: item.plat,
      delay: item.delay,
      timeType: item.timeType,
      seenAt: now,
    })
  }
  incoming.forEach((item, index) => {
    if (!used.has(index)) kept.push(item)
  })
  return kept
}

export function runCollection(
  runs: TrainRun[],
  locate: (code: string) => GeoPoint | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const run of runs) {
    const place = placeRun(run, locate)
    if (!place) continue
    features.push({
      type: "Feature",
      properties: {
        id: run.id,
        color: run.color,
        line: run.line,
        dest: run.dest,
        plat: run.plat,
        delay: run.delay ? "Y" : "N",
        timeType: run.timeType,
        from: place.from,
        to: place.to,
        minutes: Math.round(place.minutes),
      },
      geometry: { type: "Point", coordinates: [place.lng, place.lat] },
    })
  }
  return { type: "FeatureCollection", features }
}

function placeRun(
  run: TrainRun,
  locate: (code: string) => GeoPoint | null,
): { lng: number; lat: number; from: string; to: string; minutes: number } | null {
  const cum = cumulative(run.path, locate)
  const end = cum[cum.length - 1] ?? 0
  const distance = Math.max(0, Math.min(end, run.distance))
  let index = 0
  while (index < cum.length - 2 && (cum[index + 1] ?? 0) < distance) index += 1
  const here = run.path[index]
  const next = run.path[index + 1]
  const start = here ? locate(here) : null
  if (!here || !start) return null
  if (!next || index >= cum.length - 1) return { lng: start.lng, lat: start.lat, from: here, to: here, minutes: 0 }
  const finish = locate(next)
  const seg = (cum[index + 1] ?? 0) - (cum[index] ?? 0)
  if (!finish || seg <= 1) return { lng: start.lng, lat: start.lat, from: here, to: here, minutes: 0 }
  const along = distance - (cum[index] ?? 0)
  const mix = Math.min(1, Math.max(0, along / seg))
  const speed = run.speed > 0 ? run.speed : run.cruise
  const minutesLeft = speed > 0 ? ((seg - along) / speed) / 60 : 0
  return {
    lng: start.lng + (finish.lng - start.lng) * mix,
    lat: start.lat + (finish.lat - start.lat) * mix,
    from: here,
    to: next,
    minutes: minutesLeft,
  }
}

function distanceOfSpot(
  path: string[],
  spot: { lng: number; lat: number; from: string; to: string },
  locate: (code: string) => GeoPoint | null,
): number {
  const cum = cumulative(path, locate)
  const index = path.indexOf(spot.from)
  if (index < 0) return 0
  if (spot.from === spot.to || path[index + 1] !== spot.to) return cum[index] ?? 0
  const start = locate(spot.from)
  const end = locate(spot.to)
  const seg = start && end ? metresBetween(start, end) : 0
  const along = start ? metresBetween(start, spot) : 0
  const frac = seg > 0 ? Math.min(1, Math.max(0, along / seg)) : 0
  return (cum[index] ?? 0) + frac * seg
}

function cruiseAt(path: string[], distance: number, locate: (code: string) => GeoPoint | null): number {
  const cum = cumulative(path, locate)
  const end = cum[cum.length - 1] ?? 0
  if (distance >= end - 1) return 0
  let index = 0
  while (index < cum.length - 2 && (cum[index + 1] ?? 0) <= distance) index += 1
  const seg = (cum[index + 1] ?? 0) - (cum[index] ?? 0)
  if (seg <= 1) return 0
  return seg / (segmentMinutes(seg) * 60)
}

function pathEnd(path: string[], locate: (code: string) => GeoPoint | null): number {
  const cum = cumulative(path, locate)
  return cum[cum.length - 1] ?? 0
}

function cumulative(path: string[], locate: (code: string) => GeoPoint | null): number[] {
  const cum = [0]
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]
    const start = from ? locate(from) : null
    const finish = to ? locate(to) : null
    const step = start && finish ? metresBetween(start, finish) : 0
    cum.push((cum[index - 1] ?? 0) + step)
  }
  return cum
}
