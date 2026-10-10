import { ferryFairway } from "./ferry-fairway.ts"
import { ferryInstant } from "./ferry-clock.ts"
import { metresBetween, type GeoPoint } from "./mtr-estimate.ts"
import type { FerryVessel } from "./types.ts"

// These boats do not publish a position. The minutes are walked along the
// pier-to-pier run, the same way a train is placed from its countdown.
// Underway speed is about 12 knots. A sea crossing is not an eight-minute rail hop.
const FERRY_MPS = 6

export type FerryTrack = {
  route: string
  fromId: string
  toId: string
  fromTc: string
  fromEn: string
  toTc: string
  toEn: string
  destTc: string
  crossingMinutes?: number
}

export type FerryMark = {
  route: string
  pierId: string
  arriving: boolean
  eta: string
  destTc: string
}

export function ferryCrossingMs(metres: number): number {
  return Math.max(4, metres / FERRY_MPS / 60) * 60_000
}

export function placeFerry(
  from: GeoPoint,
  to: GeoPoint | null,
  departAt: number | null,
  arriveAt: number | null,
  now: number,
): { lng: number; lat: number; minutes: number } | null {
  return placeOnPath(to ? [from, to] : [from], departAt, arriveAt, now)
}

export function placeOnPath(
  path: readonly GeoPoint[],
  departAt: number | null,
  arriveAt: number | null,
  now: number,
): { lng: number; lat: number; minutes: number } | null {
  const origin = path[0]
  if (!origin) return null
  const length = pathMetres(path)
  const model = path.length >= 2 && length > 0 ? ferryCrossingMs(length) : null
  const window = sailingWindow(departAt, arriveAt, model)
  if (!window) return null
  if (now > window.end + 2 * 60_000) return null
  // A later sailing stays on the pier card. The boat is drawn once it is due to leave.
  if (now < window.start && window.start - now > 30 * 60_000) return null
  const minutes = Math.max(0, Math.round((window.end - now) / 60_000))
  if (now <= window.start || path.length < 2) return { lng: origin.lng, lat: origin.lat, minutes }
  const span = window.end - window.start
  const mix = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - window.start) / span))
  const point = pointAlong(path, mix)
  return { lng: point.lng, lat: point.lat, minutes }
}

export function pathMetres(path: readonly GeoPoint[]): number {
  let total = 0
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]
    const next = path[index]
    if (!previous || !next) continue
    total += metresBetween(previous, next)
  }
  return total
}

export function pointAlong(path: readonly GeoPoint[], fraction: number): GeoPoint {
  const origin = path[0]
  if (!origin) return { lng: 0, lat: 0 }
  if (path.length === 1 || fraction <= 0) return origin
  const last = path[path.length - 1]
  if (!last || fraction >= 1) return last ?? origin
  const target = pathMetres(path) * fraction
  let walked = 0
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]
    const next = path[index]
    if (!previous || !next) continue
    const step = metresBetween(previous, next)
    if (walked + step >= target && step > 0) {
      const mix = (target - walked) / step
      return {
        lng: previous.lng + (next.lng - previous.lng) * mix,
        lat: previous.lat + (next.lat - previous.lat) * mix,
      }
    }
    walked += step
  }
  return last
}

export function ferryVesselPoint(vessel: FerryVessel, observedAt: number, now: number): { lng: number; lat: number; minutes: number | null; estimated: boolean } | null {
  const path = vessel.pathLng?.map((lng, index) => ({ lng, lat: vessel.pathLat?.[index] ?? NaN }))
    ?? [{ lng: vessel.fromLng ?? vessel.lng, lat: vessel.fromLat ?? vessel.lat }, { lng: vessel.toLng ?? vessel.lng, lat: vessel.toLat ?? vessel.lat }]
  if (path.some((point) => !Number.isFinite(point.lng) || !Number.isFinite(point.lat))) return null
  if (vessel.fix === "clock") {
    const point = placeOnPath(path, vessel.departAt ?? null, vessel.arriveAt ?? null, now)
    return point ? { ...point, estimated: true } : null
  }
  const at = vessel.observedAt ? Date.parse(vessel.observedAt) : observedAt
  if (!Number.isFinite(at) || now - at > 180_000) return null
  if (path.length < 2 || pathMetres(path) === 0) return { ...vessel, estimated: false }
  let nearest = path[0]!
  let nextIndex = 1
  let distance = Infinity
  const longitudeScale = Math.cos(vessel.lat * Math.PI / 180)
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!, to = path[index]!
    const dx = (to.lng - from.lng) * longitudeScale, dy = to.lat - from.lat
    const lengthSquared = dx * dx + dy * dy
    const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((vessel.lng - from.lng) * longitudeScale * dx + (vessel.lat - from.lat) * dy) / lengthSquared))
    const point = { lng: from.lng + (to.lng - from.lng) * fraction, lat: from.lat + (to.lat - from.lat) * fraction }
    const gap = metresBetween(vessel, point)
    if (gap < distance) { nearest = point; nextIndex = index; distance = gap }
  }
  const arriveAt = vessel.arriveAt === undefined ? ferryInstant(vessel.eta, at) : vessel.arriveAt
  if (vessel.departAt != null && vessel.departAt > at) {
    if (arriveAt == null || arriveAt <= vessel.departAt) return { ...path[0]!, minutes: vessel.minutes, estimated: true }
    const point = placeOnPath(path, vessel.departAt, arriveAt, now)
    return point ? { ...point, estimated: true } : null
  }
  // shortcut: fairways approximate the sailing track; use surveyed routes when available.
  if (arriveAt == null || arriveAt <= at) return { ...nearest, minutes: vessel.minutes, estimated: true }
  const point = placeOnPath([nearest, ...path.slice(nextIndex)], at, arriveAt, now)
  return point ? { ...point, estimated: true } : null
}

export function estimateFerryVessels(
  tracks: readonly FerryTrack[],
  marks: readonly FerryMark[],
  gpsRoutes: ReadonlySet<string>,
  locate: (id: string) => GeoPoint | null,
  now: number,
): FerryVessel[] {
  const vessels: FerryVessel[] = []
  for (const track of tracks) {
    if (gpsRoutes.has(track.route)) continue
    const from = locate(track.fromId)
    if (!from) continue
    const to = track.toId ? locate(track.toId) : null
    const departures = instants(marks.filter((mark) => isDeparture(mark, track)), now)
    const arrivals = instants(marks.filter((mark) => isArrival(mark, track)), now)
    const path = to ? ferryFairway(track.fromId, track.toId, from, to) : [from]
    const duration = track.crossingMinutes ? track.crossingMinutes * 60_000 : path.length >= 2 ? ferryCrossingMs(pathMetres(path)) : null
    const arriveAt = arrivals.find((time) => time >= now - 2 * 60_000) ?? null
    const departAt = arriveAt == null
      ? [...departures].reverse().find((time) => time <= now && duration != null && time + duration >= now)
        ?? departures.find((time) => time >= now) ?? null
      : [...departures].reverse().find((time) => time < arriveAt) ?? null
    const window = sailingWindow(departAt, arriveAt, duration)
    if (!window) continue
    const place = placeOnPath(path, window.start, window.end, now)
    if (!place) continue
    vessels.push({
      id: `run-${track.route}-${track.fromId}-${track.toId || track.toEn}-${window.start}`,
      nameTc: `${track.fromTc} – ${track.toTc}`,
      nameEn: `${track.fromEn} – ${track.toEn}`,
      lng: place.lng,
      lat: place.lat,
      route: track.route,
      eta: new Date(window.end).toISOString(),
      minutes: place.minutes,
      destTc: track.toTc,
      destEn: track.toEn,
      fix: "clock",
      fromLng: from.lng,
      fromLat: from.lat,
      toLng: to?.lng ?? from.lng,
      toLat: to?.lat ?? from.lat,
      departAt: window.start,
      arriveAt: window.end,
      pathLng: path.map((point) => point.lng),
      pathLat: path.map((point) => point.lat),
    })
  }
  return vessels
}

function sailingWindow(departAt: number | null, arriveAt: number | null, model: number | null): { start: number; end: number } | null {
  if (departAt != null && arriveAt != null && arriveAt >= departAt) return { start: departAt, end: arriveAt }
  if (arriveAt != null && model != null) return { start: arriveAt - model, end: arriveAt }
  if (departAt != null && model != null) return { start: departAt, end: departAt + model }
  if (departAt != null && arriveAt == null && model == null) return { start: departAt, end: departAt }
  return null
}

function instants(marks: readonly FerryMark[], now: number): number[] {
  return marks
    .map((mark) => ferryInstant(mark.eta, now))
    .filter((time): time is number => time != null && Number.isFinite(time))
    .sort((a, b) => a - b)
}

function isDeparture(mark: FerryMark, track: FerryTrack): boolean {
  return mark.route === track.route && !mark.arriving && mark.pierId === track.fromId && (!mark.destTc || mark.destTc === track.destTc)
}

function isArrival(mark: FerryMark, track: FerryTrack): boolean {
  return mark.route === track.route && mark.arriving && mark.pierId === track.toId
}

export type FerryMotion = {
  id: string
  fix: "gps" | "clock"
  nameTc: string
  nameEn: string
  route: string
  eta: string
  minutes: number | null
  destTc: string
  destEn: string
  gpsLng: number
  gpsLat: number
  gpsAt: number
  east: number
  north: number
  fromLng: number
  fromLat: number
  toLng: number
  toLat: number
  pathLng: number[]
  pathLat: number[]
  departAt: number | null
  arriveAt: number | null
}

const GPS_COAST_MS = 70_000

export function syncFerryMotion(previous: readonly FerryMotion[], vessels: readonly FerryVessel[], now: number): FerryMotion[] {
  return vessels.map((vessel) => {
    const prior = previous.find((item) => item.id === vessel.id && item.fix === vessel.fix)
    if (vessel.fix === "gps") {
      const same = prior != null && prior.gpsLng === vessel.lng && prior.gpsLat === vessel.lat
      const dt = prior ? now - prior.gpsAt : 0
      const stepped = prior != null && !same && dt > 5_000 && dt < 180_000
      return {
        id: vessel.id,
        fix: "gps",
        nameTc: vessel.nameTc,
        nameEn: vessel.nameEn,
        route: vessel.route,
        eta: vessel.eta,
        minutes: vessel.minutes,
        destTc: vessel.destTc ?? "",
        destEn: vessel.destEn ?? "",
        gpsLng: vessel.lng,
        gpsLat: vessel.lat,
        gpsAt: same && prior ? prior.gpsAt : now,
        east: stepped && prior ? (vessel.lng - prior.gpsLng) / dt : same && prior ? prior.east : 0,
        north: stepped && prior ? (vessel.lat - prior.gpsLat) / dt : same && prior ? prior.north : 0,
        fromLng: vessel.lng,
        fromLat: vessel.lat,
        toLng: vessel.lng,
        toLat: vessel.lat,
        pathLng: [vessel.lng],
        pathLat: [vessel.lat],
        departAt: null,
        arriveAt: null,
      }
    }
    const pathLng = vessel.pathLng ?? [vessel.fromLng ?? vessel.lng, vessel.toLng ?? vessel.lng]
    const pathLat = vessel.pathLat ?? [vessel.fromLat ?? vessel.lat, vessel.toLat ?? vessel.lat]
    return {
      id: vessel.id,
      fix: "clock",
      nameTc: vessel.nameTc,
      nameEn: vessel.nameEn,
      route: vessel.route,
      eta: vessel.eta,
      minutes: vessel.minutes,
      destTc: vessel.destTc ?? "",
      destEn: vessel.destEn ?? "",
      gpsLng: vessel.lng,
      gpsLat: vessel.lat,
      gpsAt: now,
      east: 0,
      north: 0,
      fromLng: vessel.fromLng ?? vessel.lng,
      fromLat: vessel.fromLat ?? vessel.lat,
      toLng: vessel.toLng ?? vessel.lng,
      toLat: vessel.toLat ?? vessel.lat,
      pathLng,
      pathLat,
      departAt: vessel.departAt ?? null,
      arriveAt: vessel.arriveAt ?? null,
    }
  })
}

export function ferryMotionPoint(motion: FerryMotion, now: number): { lng: number; lat: number; minutes: number | null } | null {
  if (motion.fix === "gps") {
    const age = Math.max(0, Math.min(GPS_COAST_MS, now - motion.gpsAt))
    return { lng: motion.gpsLng + motion.east * age, lat: motion.gpsLat + motion.north * age, minutes: motion.minutes }
  }
  const path = motion.pathLng.map((lng, index) => ({ lng, lat: motion.pathLat[index] ?? motion.fromLat }))
  return placeOnPath(path.length > 0 ? path : [{ lng: motion.fromLng, lat: motion.fromLat }], motion.departAt, motion.arriveAt, now)
}

export function ferryMotionFeatures(motions: readonly FerryMotion[], now: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const motion of motions) {
    const point = ferryMotionPoint(motion, now)
    if (!point) continue
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: {
        nameTc: motion.nameTc,
        nameEn: motion.nameEn,
        routes: JSON.stringify([]),
        board: JSON.stringify([{
          route: motion.route,
          destTc: motion.destTc,
          destEn: motion.destEn,
          originTc: "",
          originEn: "",
          arriving: false,
          eta: motion.eta,
          minutes: point.minutes,
          remarkTc: "",
          remarkEn: "",
          scheduled: false,
        }]),
      },
    })
  }
  return { type: "FeatureCollection", features }
}
