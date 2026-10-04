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
