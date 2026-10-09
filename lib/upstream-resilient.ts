// Retryable, backoff-aware, stale-while-error wrapper around fetchUpstream.
// Existing single-shot callers are kept untouched; the bus feeds and bus-route
// call this helper so a transient upstream blip (typical HK gov ETA flakiness)
// does not blank the UI or flip the whole feed to "update failed".
import { fetchUpstream, lastGoodUpstream, type UpstreamBody } from "./upstream.ts"

export type ResilientError =
  | { kind: "timeout"; message: string }
  | { kind: "http"; status: number; message: string }
  | { kind: "abort"; message: string }

export type ResilientUpstream = UpstreamBody & {
  /** Number of upstream attempts made, including the one that succeeded. */
  attempts: number
  /** True when the body came from the in-process last-good cache after a failure. */
  servedFromCache?: boolean
  /** Set when the most recent attempt failed but a stale body was returned. */
  error?: ResilientError
}

export type ResilientOptions = {
  /** Per-attempt timeout forwarded to fetchUpstream. Default 5_000. */
  timeoutMs?: number
  /** Timeout used for any retry attempts; defaults to `timeoutMs`. Useful when
   *  the first attempt is generous but a retry must be quick to keep total wall
   *  time inside the Worker budget. */
  retryTimeoutMs?: number
  /** Extra attempts after the first. Default 1 (two attempts total). */
  retries?: number
  /** Base backoff in ms; multiplied by attempt index and jittered. Default 250. */
  backoffMs?: number
  /** HTTP statuses that should retry. Default 408, 425, 429, 500, 502, 503, 504. */
  retryOn?: ReadonlySet<number>
  /** External cancellation signal for the whole attempt chain. */
  signal?: AbortSignal
  /** Forwarded to fetchUpstream. */
  headers?: HeadersInit
}

const DEFAULT_RETRY_ON = new Set<number>([408, 425, 429, 500, 502, 503, 504])

function logResilient(event: "attempt" | "stale" | "throw" | "ok", fields: Record<string, unknown>): void {
  // wrangler's observability.enabled picks up console.error and pipes it into
  // Logpush; keep one log call per event so the dashboards can plot retries vs
  // success vs servedFromCache without combinatorial logs.
  try {
    console.error(JSON.stringify({ source: "fetchUpstreamResilient", event, ...fields }))
  } catch {
    // Logging must never throw into the request path.
  }
}

/**
 * Fetch a URL with bounded retries, exponential backoff, and stale-while-error.
 *
 * Behaviour:
 * - 2xx returns the body; `attempts` records how many calls were made.
 * - 4xx/5xx listed in `retryOn` (or in the default set) trigger a single retry
 *   with jittered backoff; anything else returns immediately with `error`.
 * - Timeout/AbortError is NOT retried by default; those usually mean the upstream
 *   is loaded, and a second 5s blast is more harmful than helpful. Override with
 *   a custom retry predicate if a specific feed behaves differently.
 * - On total failure a previously-good body from `lastGoodUpstream` is returned
 *   with `servedFromCache: true` and `error` set, so the feed keeps the last
 *   arrival numbers on screen instead of going red.
 */
export async function fetchUpstreamResilient(
  url: string,
  ttlMs: number,
  options: ResilientOptions = {},
): Promise<ResilientUpstream> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const retryTimeoutMs = options.retryTimeoutMs ?? timeoutMs
  const retries = Math.max(0, options.retries ?? 1)
  const backoffMs = options.backoffMs ?? 250
  const retryOn = options.retryOn ?? DEFAULT_RETRY_ON
  const signal = options.signal
  const headers = options.headers

  const startedAt = Date.now()
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return ""
    }
  })()

  let lastError: ResilientError | undefined
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      lastError = { kind: "abort", message: "aborted before attempt" }
      break
    }
    const attemptStartedAt = Date.now()
    let body: UpstreamBody
    try {
      body = await fetchUpstream(url, ttlMs, {
        timeoutMs: attempt === 0 ? timeoutMs : retryTimeoutMs,
        headers,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logResilient("attempt", {
        host,
        url,
        attempt: attempt + 1,
        retries,
        outcome: "throw",
        kind: signal?.aborted ? "abort" : "timeout",
        message,
        elapsedMs: Date.now() - attemptStartedAt,
      })
      if (signal?.aborted) lastError = { kind: "abort", message }
      else lastError = { kind: "timeout", message }
      break
    }
    logResilient("attempt", {
      host,
      url,
      attempt: attempt + 1,
      retries,
      outcome: body.status >= 200 && body.status < 300 ? "ok" : `http-${body.status}`,
      status: body.status,
      bytes: body.body.byteLength,
      servedFromCache: body.status === 304,
      elapsedMs: Date.now() - attemptStartedAt,
    })
    if (body.status >= 200 && body.status < 300) {
      logResilient("ok", { host, url, attempts: attempt + 1, totalElapsedMs: Date.now() - startedAt })
      return { ...body, attempts: attempt + 1 }
    }
    lastError = { kind: "http", status: body.status, message: `HTTP ${body.status}` }
    if (!retryOn.has(body.status) || attempt === retries) {
      // Either unrecoverable status or out of retries; fall through to stale path.
      break
    }
    await jitteredSleep(backoffMs, attempt + 1, signal)
  }

  const stale = lastGoodUpstream(url)
  if (stale) {
    logResilient("stale", {
      host,
      url,
      attempts: retries + 1,
      kind: lastError?.kind,
      status: lastError?.kind === "http" ? lastError.status : undefined,
      totalElapsedMs: Date.now() - startedAt,
    })
    return { ...stale, attempts: retries + 1, servedFromCache: true, error: lastError }
  }
  // No cache to fall back to: surface the failure as a thrown error so callers
  // that wrap in try/catch (the bus feeds do) can keep their existing "missed"
  // accounting intact.
  const detail = lastError?.kind === "http" ? `HTTP ${lastError.status}` : (lastError?.message ?? "unknown")
  logResilient("throw", {
    host,
    url,
    attempts: retries + 1,
    kind: lastError?.kind,
    status: lastError?.kind === "http" ? lastError.status : undefined,
    totalElapsedMs: Date.now() - startedAt,
  })
  throw new Error(`Upstream failed: ${detail}`)
}

async function jitteredSleep(baseMs: number, attemptIndex: number, signal?: AbortSignal): Promise<void> {
  const ms = baseMs * attemptIndex + Math.floor(Math.random() * baseMs)
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
    return
  }
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new Error("aborted"))
      },
      { once: true },
    )
  })
}
