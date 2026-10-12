import { keepWorkerRequestAlive } from "./feed-cache.ts"
import { waitForRequest } from "./request-wait.ts"

export function politeQueue(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  function acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (active < limit) {
      active += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener("abort", abort)
        active += 1
        resolve()
      }
      const abort = () => {
        const index = waiting.indexOf(start)
        if (index !== -1) waiting.splice(index, 1)
        reject(signal!.reason)
      }
      waiting.push(start)
      signal?.addEventListener("abort", abort, { once: true })
    })
  }
  return async function run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal)
    // Retain the slot until producer completion, even if this caller stops waiting.
    const producer = keepWorkerRequestAlive(Promise.resolve().then(() => {
      signal?.throwIfAborted()
      return task()
    }).finally(() => {
      active -= 1
      waiting.shift()?.()
    }))
    return signal ? waitForRequest(producer, signal) : producer
  }
}

const refreshing = new Map<string, Promise<unknown>>()

// Only identical work joins: another viewport must fetch its own stops and report
// its own misses. The shared queue still caps concurrency across all selections.
export async function takeEtaTurn<T>(operator: string, task: () => Promise<T>, selection = ""): Promise<T> {
  const key = JSON.stringify([operator, selection])
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
// Includes time waiting behind other operators, not just time spent on the wire.
export const ETA_REFRESH_TIMEOUT_MS = 20_000
