import { commuterCatalogue, metresBetween, mtrBusDestination, mtrBusStops } from './commuter-catalogue.ts'
import { etaQueue, ETA_REFRESH_TIMEOUT_MS } from './polite-fetch.ts'
import { ETA_KEEP_MS } from './place-arrivals.ts'
import { keepWorkerRequestAlive } from './feed-cache.ts'
import type { Arrival, Camera } from './traffic.ts'

type Board = { id: string; arrivals: Arrival[] }
type RouteSnapshot = { at: number; fetchedAt: number; refreshMs: number; boards: Board[]; alert: boolean }
const snapshots = new Map<string, RouteSnapshot>()
const pending = new Map<string, Promise<RouteSnapshot>>()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value : ''

export function parseMtrBusSchedule(payload: unknown, route: string, now: number): RouteSnapshot {
  if (!record(payload) || !['0', '1'].includes(String(payload.status)) || payload.routeName !== route || !Array.isArray(payload.busStop)) throw new Error('MTR bus schedule shape unavailable')
  const time = text(payload.routeStatusTime).replaceAll('/', '-').replace(' ', 'T')
  const at = Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time) ? `${time}:00+08:00` : time)
  if (!Number.isFinite(at) || now - at > ETA_KEEP_MS || at > now + 30_000) throw new Error('MTR bus source clock expired')
  const boards = payload.busStop.map(stop => {
    if (!record(stop) || typeof stop.busStopId !== 'string' || !Array.isArray(stop.bus)) throw new Error('MTR bus stop shape unavailable')
    const arrivals: Arrival[] = []
    for (const bus of stop.bus) {
      if (!record(bus) || typeof bus.lineRef !== 'string' || typeof bus.isScheduled !== 'string') throw new Error('MTR bus arrival shape unavailable')
      const arrival = Number(bus.arrivalTimeInSecond), departure = Number(bus.departureTimeInSecond)
      const seconds = bus.arrivalTimeInSecond !== '' && Number.isFinite(arrival) && arrival >= 0 && arrival < 86_400 ? arrival : departure
      if (!Number.isFinite(seconds) || seconds < -60 || seconds >= 86_400 || stop.isSuspended === '1') continue
      const destination = mtrBusDestination(bus.lineRef)
      const eta = at + Math.max(0, seconds) * 1000
      if (eta < now - 60_000) continue
      arrivals.push({ route, destination: destination?.tc ?? '', destinationEn: destination?.en ?? '', eta: new Date(eta).toISOString(), observedAt: new Date(at).toISOString(), minutes: Math.max(0, Math.ceil((eta - now) / 60_000)), scheduled: bus.isScheduled === '1' })
    }
    return { id: stop.busStopId, arrivals: arrivals.sort((a, b) => Date.parse(a.eta!) - Date.parse(b.eta!)) }
  })
  const alert = String(payload.status) !== '1'
  const hint = Number(payload.appRefreshTimeInSecond)
  return { at, fetchedAt: now, refreshMs: alert ? 5_000 : Number.isFinite(hint) && hint >= 30 ? Math.min(hint * 1000, 120_000) : 30_000, boards, alert }
}

async function loadRoute(route: string, signal: AbortSignal, now: number): Promise<RouteSnapshot> {
  const held = snapshots.get(route)
  if (held && now - held.fetchedAt < held.refreshMs && now - held.at <= ETA_KEEP_MS) return held
  const existing = pending.get(route)
  if (existing) return existing
  const task = keepWorkerRequestAlive(etaQueue(async () => {
    const response = await fetch('https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal,
      body: JSON.stringify({ language: 'en', routeName: route }),
    })
    if (!response.ok) throw new Error(`MTR bus HTTP ${response.status}`)
    const payload: unknown = await response.json()
    const snapshot = parseMtrBusSchedule(payload, route, now)
    snapshots.set(route, snapshot)
    return snapshot
  }, signal).finally(() => pending.delete(route)))
  pending.set(route, task)
  return task
}

export async function loadMtrBusNear(lng: number, lat: number, now = Date.now(), zoom = 13) {
  const places = commuterCatalogue('mtr-bus').filter(stop => metresBetween(stop, { lng, lat }) <= 1800)
    .sort((a, b) => metresBetween(a, { lng, lat }) - metresBetween(b, { lng, lat })).slice(0, 36)
  if (zoom < 13) return { ok: true, cameras: [] as Camera[], observedAt: null, stale: false }
  const routes = [...new Set(places.flatMap(stop => stop.routes ?? []))].slice(0, 8)
  const signal = AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS)
  const result = new Map<string, RouteSnapshot>()
  let missed = 0
  await Promise.all(routes.map(async route => {
    try {
      const snapshot = await loadRoute(route, signal, now)
      result.set(route, snapshot)
      if (snapshot.alert) missed++
    } catch {
      missed++
      const held = snapshots.get(route)
      if (held && Date.now() - held.at <= ETA_KEEP_MS) result.set(route, held)
    }
  }))
  const cameras = places.map(camera => {
    const route = mtrBusStops.find(stop => stop.id === camera.sourceId)?.route
    const snapshot = route ? result.get(route) : undefined
    return { ...camera, dataUpdated: snapshot ? new Date(snapshot.at).toISOString() : undefined,
      arrivals: snapshot?.boards.find(board => board.id === camera.sourceId)?.arrivals ?? [],
      information: { en: 'Arrivals are published estimates and may be scheduled. This layer does not display bus GPS positions.', zh: '到站時間為公布的估算，亦可能包括時間表班次。此圖層不顯示巴士 GPS 位置。' },
    }
  })
  const observed = [...result.values()].map(snapshot => snapshot.at)
  return { ok: true, cameras, observedAt: observed.length ? new Date(Math.min(...observed)).toISOString() : null,
    stale: missed > 0, error: missed ? 'Some MTR bus schedules are unavailable or carry an operator alert' : undefined,
  }
}

export async function loadMtrBusRoute(route: string, now = Date.now()) {
  const cameras = commuterCatalogue('mtr-bus').filter(camera => camera.routes?.includes(route))
  if (!cameras.length) throw new Error('Unknown MTR bus route')
  const snapshot = await loadRoute(route, AbortSignal.timeout(ETA_REFRESH_TIMEOUT_MS), now)
  return { cameras: cameras.map(camera => ({ ...camera, dataUpdated: new Date(snapshot.at).toISOString(), arrivals: snapshot.boards.find(board => board.id === camera.sourceId)?.arrivals ?? [] })),
    observedAt: new Date(snapshot.at).toISOString(), stale: snapshot.alert }
}
