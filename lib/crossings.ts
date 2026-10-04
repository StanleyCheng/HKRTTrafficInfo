import { roadOf } from "./camera-place.ts"
import type { ApproachPoint, HarbourJourney } from "./types.ts"

const CODES = ["CH", "EH", "WH"] as const

export type CrossingCode = (typeof CODES)[number]

const LABEL: Record<CrossingCode, string> = {
  CH: "Cross Harbour",
  EH: "Eastern",
  WH: "Western",
}

export type CrossingBest = {
  code: CrossingCode
  label: string
  minutes: number
  from: string
  fromTc: string
  colour: HarbourJourney["colour"]
  coordinates: [number, number]
}

export function bestCrossings(points: ApproachPoint[]): CrossingBest[] {
  const found = new Map<CrossingCode, CrossingBest>()
  for (const point of points) {
    for (const leg of point.legs) {
      if (leg.minutes == null || !isCrossing(leg.code)) continue
      const current = found.get(leg.code)
      if (current && current.minutes <= leg.minutes) continue
      found.set(leg.code, {
        code: leg.code,
        label: LABEL[leg.code],
        minutes: leg.minutes,
        from: roadOf(point.name),
        fromTc: point.nameTc ? roadOf(point.nameTc) : "",
        colour: leg.colour,
        coordinates: point.coordinates,
      })
    }
  }
  return CODES.flatMap((code) => {
    const row = found.get(code)
    return row ? [row] : []
  })
}

function isCrossing(code: string): code is CrossingCode {
  return code === "CH" || code === "EH" || code === "WH"
}
