/** Keep producer I/O and cleanup alive when its original Worker client disconnects. */
// ponytail: waitUntil retains work for 30s after disconnect; longer jobs need durable tasks.
export function keepWorkerRequestAlive<T>(promise: Promise<T>): Promise<T> {
  const context = (globalThis as unknown as Record<symbol, { ctx?: { waitUntil(promise: Promise<unknown>): void } } | undefined>)[
    Symbol.for("__cloudflare-context__")
  ]?.ctx
  context?.waitUntil(promise.catch(() => {}))
  return promise
}

export async function openFeedCache(): Promise<Cache | null> {
  const storage = globalThis.caches as (CacheStorage & { default?: Cache }) | undefined
  if (!storage) return null
  if (storage.default) return storage.default
  try {
    return await storage.open("hktraffic-feeds")
  } catch {
    return null
  }
}
