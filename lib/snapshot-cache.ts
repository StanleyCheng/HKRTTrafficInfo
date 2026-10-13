import { ETA_KEEP_MS } from "./place-arrivals.ts"

// Re-inserting an old snapshot must not extend its source lifetime. Call after
// the awaited loader so time spent waiting also counts toward both limits.
export function snapshotFallback<T extends { observedAt: string | null }>(
  cached: { at: number; body: T } | null,
  now = Date.now(),
): T | null {
  if (!cached || !Number.isFinite(now) || !Number.isFinite(cached.at)) return null
  const observedAt = Date.parse(cached.body.observedAt ?? "")
  if (!Number.isFinite(observedAt)) return null
  if (cached.at > now + 30_000 || observedAt > now + 30_000) return null
  if (now - cached.at > ETA_KEEP_MS || now - observedAt > ETA_KEEP_MS) return null
  return cached.body
}
