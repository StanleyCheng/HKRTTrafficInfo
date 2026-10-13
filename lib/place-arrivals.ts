export const ETA_FRESH_MS = 5_000
export const ETA_KEEP_MS = 3 * 60_000

export type HeldRows<T> = { at: number; rows: T[] }

// A successful HTTP response with a changed/error payload must not replace the
// last usable arrival board. An explicit empty array is a valid no-service board.
export function arrivalRows<T>(value: unknown): T[] | null {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) return null
  return value as T[]
}

export function arrivalSnapshot<T>(rows: T[] | null, fetchedAt: string, published: unknown[]): HeldRows<T> | null {
  if (!rows) return null
  const clocks = published.filter(value => value != null && value !== "").map(value => {
    if (typeof value !== "string") return Number.NaN
    // Provider timestamps without a zone are Hong Kong local time.
    const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}+08:00` : value
    return Date.parse(timestamp)
  })
  if (!clocks.length) clocks.push(Date.parse(fetchedAt))
  const now = Date.now()
  if (clocks.some(at => !Number.isFinite(at) || now - at > ETA_KEEP_MS || at > now + 30_000)) return null
  return { at: Math.min(...clocks), rows }
}

export function arrivalObservedAt<T>(held: HeldRows<T> | undefined, now: number): string | null {
  return heldRows(held, now) && held ? new Date(held.at).toISOString() : null
}

// Keep a small zero-minute grace window, then stop advertising a retained bus
// as arriving indefinitely during an outage.
export function arrivalExpired(eta: number, now: number): boolean {
  return Number.isFinite(eta) && now - eta > 60_000
}

export function etaDue<T>(held: HeldRows<T> | undefined, now: number, freshMs = ETA_FRESH_MS): boolean {
  return held == null || now - held.at >= freshMs
}

export function heldRows<T>(held: HeldRows<T> | undefined, now: number, keepMs = ETA_KEEP_MS): T[] | null {
  if (!held || now - held.at > keepMs) return null
  return held.rows
}

export function forgetStale<T>(held: Map<string, HeldRows<T>>, now: number, keepMs = ETA_KEEP_MS): void {
  for (const [key, item] of held) {
    if (now - item.at > keepMs) held.delete(key)
  }
}

export function arrivalFailure(missed: number, callCounts: number[], message: string): string | undefined {
  if (missed <= 0) return undefined
  if (callCounts.some((count) => count > 0)) return undefined
  return message
}

type PlaceBody<P> = { ok: boolean; stops: P[] }
type ArrivalBody<S> = { ok: boolean; observedAt: string | null; stops: S[] }

// Places stay on the map. A later arrival copy only fills the clock for ids the catalogue already listed.
export function mergePlaceArrivals<S extends { id: string; calls: unknown[] }>(
  places: PlaceBody<Omit<S, "calls">> | null,
  arrivals: ArrivalBody<S> | null,
): { ok: true; observedAt: string | null; stops: S[] } | null {
  if (places?.ok) {
    const calls = new Map<string, S["calls"]>()
    if (arrivals?.ok) {
      for (const stop of arrivals.stops) calls.set(stop.id, stop.calls)
    }
    return {
      ok: true,
      observedAt: arrivals?.ok ? arrivals.observedAt : null,
      stops: places.stops.map((stop) => ({ ...stop, calls: calls.get(stop.id) ?? [] }) as S),
    }
  }
  if (!arrivals?.ok) return null
  return { ok: true, observedAt: arrivals.observedAt, stops: arrivals.stops }
}
