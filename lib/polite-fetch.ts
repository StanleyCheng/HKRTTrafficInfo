function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function politeQueue(limit: number) {
  let active = 0
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    while (active >= limit) await pause(20)
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
    }
  }
}

let refreshing = false

// One arrival refresh in an isolate. A second view answers from memory instead of opening another burst.
export async function takeEtaTurn<T>(task: () => Promise<T>): Promise<T | null> {
  const started = Date.now()
  while (refreshing && Date.now() - started < 200) await pause(40)
  if (refreshing) return null
  refreshing = true
  try {
    return await task()
  } finally {
    refreshing = false
  }
}

// One isolate shares this queue, so several map views cannot open a burst of ETA calls together.
export const etaQueue = politeQueue(6)
