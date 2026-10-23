import { currentArrivals } from './arrival-display.ts'
import { metresBetween } from './nearest.ts'
import type { Camera, CameraData, IntegrationKind } from './traffic.ts'

export const nearbyGroups: { id: 'rail' | 'bus' | 'tram' | 'ferry' | 'access' | 'taxi'; kinds: IntegrationKind[] }[] = [
  { id: 'rail', kinds: ['mtr', 'lrt'] },
  { id: 'bus', kinds: ['kmb', 'citybus', 'gmb', 'nlb', 'mtr-bus'] },
  { id: 'tram', kinds: ['tram'] }, { id: 'ferry', kinds: ['ferry'] },
  { id: 'access', kinds: ['access'] }, { id: 'taxi', kinds: ['taxi'] },
]
export const nearbyKinds = nearbyGroups.flatMap(group => group.kinds)
export function nearbyPlaces(data: (CameraData | undefined)[], centre: { lng: number; lat: number }, radius: number, now: number) {
  return data.flatMap(feed => feed?.cameras ?? []).filter(camera => camera.positionType !== 'vehicle')
    .map(camera => ({ camera, metres: metresBetween(camera, centre), arrivals: currentArrivals(camera, now) }))
    .filter(place => place.metres <= radius)
    .sort((a, b) => a.metres - b.metres || a.camera.id.localeCompare(b.camera.id))
}
export function nextArrivalText(camera: Camera, now: number): { route: string; minutes: number; scheduled: boolean } | null {
  const call = currentArrivals(camera, now).filter(call => call.eta && Number.isFinite(Date.parse(call.eta))).sort((a, b) => Date.parse(a.eta!) - Date.parse(b.eta!))[0]
  return call?.eta ? { route: call.route, minutes: Math.max(0, Math.ceil((Date.parse(call.eta) - now) / 60_000)), scheduled: call.scheduled === true } : null
}
