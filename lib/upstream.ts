import { keepWorkerRequestAlive, openFeedCache } from "./feed-cache.ts"

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
  const fresh = memory.get(url)
  if (fresh && fresh.expires > Date.now()) return fresh.body
  const current = pending.get(url)
  if (current) return current
  const task = keepWorkerRequestAlive(readThrough(url, ttlMs, options).finally(() => pending.delete(url)))
  pending.set(url, task)
  return task
}

async function readThrough(url: string, ttlMs: number, options: UpstreamOptions): Promise<UpstreamBody> {
  const shared = await readShared(url, ttlMs)
  if (shared) return shared

  // Send conditional headers on the wire when the cache has previous validators.
  // Servers that return 304 let us reuse the cached body — bandwidth and CPU win
  // on every periodic refresh of an unchanged endpoint.
  const headers = safeHeaders(options.headers)
  const cached = memory.get(url)?.body
  if (cached?.etag) headers.set("If-None-Match", cached.etag)
  if (cached?.lastModified) headers.set("If-Modified-Since", cached.lastModified)

  // One cache only. fetch() with cacheTtl and cache.put of the same URL wait on
  // each other, and the request never produces a response.
  const response = await rawFetch()(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    headers,
  })

  const contentType = response.headers.get("content-type") ?? ""
  const fetchedAt = new Date(Date.now()).toISOString()
  // 304 means upstream confirms our cached body is still current — reuse it.
  if (response.status === 304 && cached) {
    const refreshed: UpstreamBody = {
      ...cached,
      status: 200,
      fetchedAt,
      etag: response.headers.get("etag") ?? cached.etag,
      lastModified: response.headers.get("last-modified") ?? cached.lastModified,
    }
    memory.set(url, { expires: Date.now() + ttlMs, body: refreshed })
    await writeShared(url, ttlMs, refreshed)
    return refreshed
  }
  const bytes = await response.arrayBuffer()
  const body: UpstreamBody = {
    status: response.status,
    body: bytes,
    contentType,
    fetchedAt,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
  }
  if (response.ok) {
    memory.set(url, { expires: Date.now() + ttlMs, body })
    await writeShared(url, ttlMs, body)
  }
  return body
}

async function readShared(url: string, ttlMs: number): Promise<UpstreamBody | null> {
  const cache = await openFeedCache()
  if (!cache) return null
  try {
    const cached = await cache.match(new Request(url))
    if (!cached?.ok) return null
    const fetched = Date.parse(cached.headers.get("X-Feed-Fetched-At") ?? "")
    if (!Number.isFinite(fetched) || Date.now() - fetched >= ttlMs) return null
    return remember(url, ttlMs, cached)
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
        },
      }),
    )
  } catch {
    // A rejected write must not fail the feed. The caller already has the body.
  }
}

async function remember(url: string, ttlMs: number, response: Response): Promise<UpstreamBody> {
  const body: UpstreamBody = {
    status: response.status,
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "",
    fetchedAt: response.headers.get("X-Feed-Fetched-At") ?? new Date().toISOString(),
  }
  memory.set(url, { expires: Math.min(Date.now() + ttlMs, Date.parse(body.fetchedAt) + ttlMs), body })
  return body
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
