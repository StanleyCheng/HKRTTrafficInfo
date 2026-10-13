import { keepWorkerRequestAlive, openFeedCache } from "./feed-cache.ts"
import { waitForRequest } from "./request-wait.ts"

export type UpstreamBody = {
  status: number
  body: ArrayBuffer
  contentType: string
  fetchedAt: string
  etag?: string
  lastModified?: string
}

type UpstreamOptions = {
  headers?: HeadersInit
  timeoutMs?: number
  /** Cancel this caller's wait; the shared producer remains available to others. */
  signal?: AbortSignal
}

const memory = new Map<string, { expires: number; body: UpstreamBody }>()
const pending = new Map<string, Promise<UpstreamBody>>()

/** Read the most recently succeeded body for the URL, even after its TTL has expired.
 *  Used by resilient callers to implement stale-while-error so a transient upstream
 *  blip does not blank the UI. The map only stores successful responses, so any
 *  caller's downstream JSON parsing is still safe. */
export function lastGoodUpstream(url: string): UpstreamBody | undefined {
  return memory.get(url)?.body
}

export async function fetchUpstream(url: string, ttlMs: number, options: UpstreamOptions = {}): Promise<UpstreamBody> {
  options.signal?.throwIfAborted()
  const fresh = memory.get(url)
  if (fresh && fresh.expires > Date.now()) return fresh.body
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 25_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const current = pending.get(url)
  if (current) return waitForRequest(current, signal)
  const task = keepWorkerRequestAlive(readThrough(url, ttlMs, options).finally(() => pending.delete(url)))
  pending.set(url, task)
  return waitForRequest(task, signal)
}

async function readThrough(url: string, ttlMs: number, options: UpstreamOptions): Promise<UpstreamBody> {
  // Both cache lookup and body download share the producer's original deadline.
  const signal = AbortSignal.timeout(options.timeoutMs ?? 25_000)
  const cacheSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(500, options.timeoutMs ?? 25_000))])
  const shared = await waitForRequest(readShared(url, ttlMs, cacheSignal), cacheSignal).catch(() => null)
  if (shared) return shared
  signal.throwIfAborted()

  // Send conditional headers on the wire when the cache has previous validators.
  // Servers that return 304 let us reuse the cached body — bandwidth and CPU win
  // on every periodic refresh of an unchanged endpoint.
  const headers = safeHeaders(options.headers)
  const cached = memory.get(url)?.body
  if (cached?.etag) headers.set("If-None-Match", cached.etag)
  if (cached?.lastModified) headers.set("If-Modified-Since", cached.lastModified)

  // One cache only. fetch() with cacheTtl and cache.put of the same URL wait on
  // each other, and the request never produces a response.
  const response = await waitForRequest(rawFetch()(url, {
    signal,
    headers,
  }), signal)

  const contentType = response.headers.get("content-type") ?? ""
  // 304 means upstream confirms our cached body is still current — reuse it.
  if (response.status === 304 && cached) {
    const refreshed: UpstreamBody = {
      ...cached,
      status: 200,
      fetchedAt: new Date(Date.now()).toISOString(),
      etag: response.headers.get("etag") ?? cached.etag,
      lastModified: response.headers.get("last-modified") ?? cached.lastModified,
    }
    memory.set(url, { expires: Date.now() + ttlMs, body: refreshed })
    void keepWorkerRequestAlive(writeShared(url, ttlMs, refreshed))
    return refreshed
  }
  // The status is enough for callers to retry or fail. An error page's stalled
  // body must not hide an immediately retryable 503 until the whole timeout.
  if (!response.ok) void response.body?.cancel().catch(() => {})
  const bytes = response.ok ? await waitForRequest(response.arrayBuffer(), signal) : new ArrayBuffer(0)
  signal.throwIfAborted()
  const body: UpstreamBody = {
    status: response.status,
    body: bytes,
    contentType,
    fetchedAt: new Date(Date.now()).toISOString(),
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
  }
  if (response.ok) {
    validateJson(body)
    memory.set(url, { expires: Date.now() + ttlMs, body })
    void keepWorkerRequestAlive(writeShared(url, ttlMs, body))
  }
  return body
}

async function readShared(url: string, ttlMs: number, signal: AbortSignal): Promise<UpstreamBody | null> {
  const cache = await openFeedCache()
  signal.throwIfAborted()
  if (!cache) return null
  try {
    const cached = await cache.match(new Request(url))
    signal.throwIfAborted()
    if (!cached?.ok) return null
    const fetched = Date.parse(cached.headers.get("X-Feed-Fetched-At") ?? "")
    if (!Number.isFinite(fetched) || Date.now() - fetched >= ttlMs) return null
    return remember(url, ttlMs, cached, signal)
  } catch {
    return null
  }
}

async function writeShared(url: string, ttlMs: number, body: UpstreamBody): Promise<void> {
  const cache = await openFeedCache()
  if (!cache) return
  const seconds = Math.max(1, Math.round(ttlMs / 1000))
  try {
    await cache.put(
      new Request(url),
      new Response(body.body.slice(0), {
        status: 200,
        headers: {
          "Content-Type": body.contentType,
          "Cache-Control": `public, max-age=${seconds}`,
          "X-Feed-Fetched-At": body.fetchedAt,
          ...(body.etag ? { ETag: body.etag } : {}),
          ...(body.lastModified ? { "Last-Modified": body.lastModified } : {}),
        },
      }),
    )
  } catch {
    // A rejected write must not fail the feed. The caller already has the body.
  }
}

async function remember(url: string, ttlMs: number, response: Response, signal: AbortSignal): Promise<UpstreamBody> {
  const body: UpstreamBody = {
    status: response.status,
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "",
    fetchedAt: response.headers.get("X-Feed-Fetched-At") ?? new Date().toISOString(),
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
  }
  // A cache read may settle after its cutoff. Never let it overwrite newer I/O.
  signal.throwIfAborted()
  validateJson(body)
  memory.set(url, { expires: Math.min(Date.now() + ttlMs, Date.parse(body.fetchedAt) + ttlMs), body })
  return body
}

/** Transport success alone must not poison last-good with truncated JSON. */
function validateJson(body: UpstreamBody): void {
  const mediaType = body.contentType.split(';', 1)[0].trim().toLowerCase()
  if (mediaType.endsWith('/json') || mediaType.endsWith('+json')) {
    JSON.parse(new TextDecoder().decode(body.body))
  }
}

function rawFetch(): typeof fetch {
  const saved = (globalThis as unknown as Record<symbol, typeof fetch | undefined>)[
    Symbol.for("vinext.fetchCache.originalFetch")
  ]
  return typeof saved === "function" ? saved : globalThis.fetch
}

function safeHeaders(source?: HeadersInit): Headers {
  const headers = new Headers(source)
  if (typeof window !== "undefined") {
    headers.delete("User-Agent")
    headers.delete("Referer")
  }
  return headers
}
