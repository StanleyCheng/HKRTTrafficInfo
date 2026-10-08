import { keepWorkerRequestAlive } from "./feed-cache.ts"

/** Cache parsed responses, retaining their original timestamps on upstream failure. */
export function cachedFeed<T extends { ok: boolean; error?: string; fetchedAt?: string; stale?: boolean; cacheable?: boolean }>(
  ttlMs: number, load: () => Promise<T>, failed: (error: unknown) => T,
): () => Promise<Response> {
  let cached: { at: number; body: T } | undefined
  let pending: Promise<T> | undefined
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return Response.json(cached.body)
    pending ??= keepWorkerRequestAlive(load().then((body) => {
      const result = { ...body, fetchedAt: body.fetchedAt ?? new Date().toISOString() }
      if (body.ok && !body.stale && body.cacheable !== false) cached = { at: Date.now(), body: result }
      return result
    }).catch(failed).finally(() => { pending = undefined }))
    const body = await pending
    if ((!body.ok || body.stale) && cached) return Response.json({ ...cached.body, stale: true, error: body.error })
    return Response.json(body, { status: body.ok ? 200 : 502 })
  }
}
