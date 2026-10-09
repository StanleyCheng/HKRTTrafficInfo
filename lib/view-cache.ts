import { keepWorkerRequestAlive } from "./feed-cache.ts"

export type OkBody = { ok: boolean; cacheable?: boolean; stale?: boolean; fetchedAt?: string; error?: string }

export function readViewport(request: Request): { lng: number; lat: number; zoom: number } | null {
  const params = new URL(request.url).searchParams
  const values = ["lng", "lat", "zoom"].map((key) => params.get(key))
  if (values.some((value) => value == null || value.trim() === "")) return null
  const [lng, lat, zoom] = values.map(Number)
  return Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(zoom)
    && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 && zoom >= 0 && zoom <= 24 ? { lng, lat, zoom } : null
}

export function viewportAllowed(feed: string, lng: number, lat: number, zoom: number): boolean {
  if (![lng, lat, zoom].every(Number.isFinite) || Math.abs(lng) > 180 || Math.abs(lat) > 90 || zoom < 0 || zoom > 24) return false
  if (feed === "gmb") return zoom >= 17
  if (feed === "kmb" || feed === "citybus") return zoom >= 13
  if (feed === "nlb") return lng >= 113.8 && lng <= 114.05 && lat >= 22.18 && lat <= 22.34
  return true
}

export function viewCachedGet<T extends OkBody>(options: {
  freshMs: number
  load: (lng: number, lat: number, now: number, zoom: number) => Promise<T>
  missing: () => T
  failed: (error: unknown) => T
  cacheKey?: (lng: number, lat: number, zoom: number) => string
}): (request: Request) => Promise<Response> {
  const cached = new Map<string, { at: number; body: T }>()
  const pending = new Map<string, Promise<T>>()
  return async function GET(request: Request) {
    const view = readViewport(request)
    if (!view) return Response.json(options.missing(), { status: 400 })
    const { lng, lat, zoom } = view
    const parts = new URL(request.url).pathname.split("/")
    const feed = parts[parts.indexOf("api") + 1] ?? ""
    if (!viewportAllowed(feed, lng, lat, zoom)) {
      return Response.json({ ...options.missing(), ok: true, error: undefined, gated: true })
    }
    const key = options.cacheKey?.(lng, lat, zoom) ?? `${lng.toFixed(3)},${lat.toFixed(3)},${Math.floor(zoom)}`
    const now = Date.now()
    const hit = cached.get(key)
    if (hit && now - hit.at < options.freshMs) return Response.json(hit.body)
    let task = pending.get(key)
    if (!task) {
      task = keepWorkerRequestAlive(options.load(lng, lat, now, zoom).then((body) => {
        const result = { ...body, fetchedAt: body.fetchedAt ?? new Date().toISOString() }
        if (body.ok && body.cacheable !== false && !body.stale) {
          if (cached.size >= 300) cached.delete(cached.keys().next().value!)
          cached.set(key, { at: now, body: result })
        }
        return result
      }).finally(() => pending.delete(key)))
      pending.set(key, task)
    }
    try {
      const body = await task
      if (!body.ok && hit) return Response.json({ ...hit.body, stale: true, error: body.error })
      return Response.json(body, { status: body.ok ? 200 : 502 })
    } catch (error) {
      const failure = options.failed(error)
      if (hit) return Response.json({ ...hit.body, stale: true, error: failure.error })
      return Response.json(failure, { status: 502 })
    }
  }
}

/**
 * Selection-keyed variant of viewCachedGet: the caller derives a string cache key
 * from the request (e.g. operator+route+stopId for bus-route popovers). Used by
 * routes whose parameters are not a lng/lat/zoom viewport. Behaviour matches the
 * viewport sibling: in-process coalescing, stale-while-error fallback to the last
 * good body, and a 502/200 status line that the UI can render directly.
 */
export function selectionCachedGet<T extends OkBody>(options: {
  freshMs: number
  cacheKey: (request: Request) => string | null
  load: (request: Request, now: number) => Promise<T>
  invalid: () => T
  failed: (error: unknown) => T
}): (request: Request) => Promise<Response> {
  const cached = new Map<string, { at: number; body: T }>()
  const pending = new Map<string, Promise<T>>()
  return async function GET(request: Request) {
    const key = options.cacheKey(request)
    if (key == null) return Response.json(options.invalid(), { status: 400 })
    const now = Date.now()
    const hit = cached.get(key)
    if (hit && now - hit.at < options.freshMs) return Response.json(hit.body)
    let task = pending.get(key)
    if (!task) {
      task = keepWorkerRequestAlive(options.load(request, now).then((body) => {
        const result = { ...body, fetchedAt: body.fetchedAt ?? new Date().toISOString() }
        if (body.ok && body.cacheable !== false && !body.stale) {
          if (cached.size >= 300) cached.delete(cached.keys().next().value!)
          cached.set(key, { at: now, body: result })
        }
        return result
      }).finally(() => pending.delete(key)))
      pending.set(key, task)
    }
    try {
      const body = await task
      if (!body.ok && hit) return Response.json({ ...hit.body, stale: true, error: body.error })
      return Response.json(body, { status: body.ok ? 200 : 502 })
    } catch (error) {
      const failure = options.failed(error)
      if (hit) return Response.json({ ...hit.body, stale: true, error: failure.error })
      return Response.json(failure, { status: 502 })
    }
  }
}
