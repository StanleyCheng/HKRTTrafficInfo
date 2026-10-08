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

const refreshing = new Set<string>()

// One refresh per operator. Other operators still progress through the shared ETA queue.
export async function takeEtaTurn<T>(key: string, task: () => Promise<T>): Promise<T | null> {
  const started = Date.now()
  while (refreshing.has(key) && Date.now() - started < 200) await pause(40)
  if (refreshing.has(key)) return null
  refreshing.add(key)
  return keepWorkerRequestAlive(Promise.resolve().then(task).finally(() => {
    refreshing.delete(key)
  }))
}

// One isolate shares this queue, so several map views cannot open a burst of ETA calls together.
export const etaQueue = politeQueue(6)
