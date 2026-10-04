export const ETA_FRESH_MS = 60_000
export const ETA_KEEP_MS = 3 * 60_000

export type HeldRows<T> = { at: number; rows: T[] }

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
