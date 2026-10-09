import { keepWorkerRequestAlive } from "./feed-cache.ts"

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function politeQueue(limit: number) {
  let active = 0
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    while (active >= limit) await pause(20)
    active += 1
    return keepWorkerRequestAlive(Promise.resolve().then(task).finally(() => {
      active -= 1
    }))
  }
}

const refreshing = new Map<string, Promise<unknown>>()

// One refresh per operator at a time, but callers arriving while a refresh is in
// flight JOIN that in-flight promise rather than silently returning null. This
// makes the same kind of caller (e.g. two open popovers for citybus) share one
// upstream round-trip per polling tick instead of paying for two and never
// seeing the freshest data anyway.
export async function takeEtaTurn<T>(key: string, task: () => Promise<T>): Promise<T> {
  const inflight = refreshing.get(key)
  if (inflight) return inflight as Promise<T>
  const promise = keepWorkerRequestAlive(Promise.resolve().then(task))
  refreshing.set(key, promise)
  try {
    return await promise
  } finally {
    if (refreshing.get(key) === promise) refreshing.delete(key)
  }
}

// One isolate shares this queue, so several map views cannot open a burst of ETA calls together.
export const etaQueue = politeQueue(6)
