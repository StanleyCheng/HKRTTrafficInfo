import { kmbBundledStopCount, replaceKmbCatalogue } from "./kmb-network.ts"
import { readStopList } from "./stop-list.ts"
import { fetchUpstream } from "./upstream.ts"
import { keepWorkerRequestAlive } from "./feed-cache.ts"

const DAY_MS = 24 * 60 * 60 * 1000
const RETRY_MS = 60 * 60 * 1000
const LIST_URL = "https://data.etabus.gov.hk/v1/transport/kmb/stop"

let nextTryAt = 0
let pending: Promise<void> | null = null

// The bundled file is the map. Once a day, one stop-list read can add a new pole.
// A short or failed read leaves the poles already on the map.
export function refreshKmbCatalogueSoon(now = Date.now()): Promise<void> {
  if (pending || now < nextTryAt) return pending ?? Promise.resolve()
  const task = keepWorkerRequestAlive(run(now).finally(() => {
    pending = null
  }))
  pending = task
  return task
}

async function run(now: number): Promise<void> {
  try {
    const response = await fetchUpstream(LIST_URL, DAY_MS, {
      timeoutMs: 30_000,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    })
    if (response.status !== 200) {
      nextTryAt = now + RETRY_MS
      return
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(response.body))
    const stops = readStopList(payload, Math.floor(kmbBundledStopCount() * 0.9))
    if (!stops || !replaceKmbCatalogue(stops)) {
      nextTryAt = now + RETRY_MS
      return
    }
    nextTryAt = now + DAY_MS
  } catch {
    nextTryAt = now + RETRY_MS
  }
}
