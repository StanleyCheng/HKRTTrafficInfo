import { openFeedCache } from "./feed-cache.ts"
import { carryArrivalClock, estimateTrains, type TrainObservation } from "./mtr-estimate.ts"
import { pool } from "./pool.ts"
import { fairLineReads } from "./refresh-slice.ts"
import { fetchUpstream } from "./upstream.ts"
import { mtrQueries, networkRoutes, stationPoint } from "./mtr-network.ts"
import { readSchedule } from "./mtr-schedule.ts"
import type { MtrBoard, MtrResponse, MtrTrain } from "./types.ts"

const REMEMBER_MS = 180_000
const STALE_MS = 20_000
const REFRESH_SLICE = 16
const FETCH_LIMIT = 4

type Remembered = { at: number; board: MtrBoard; observations: TrainObservation[] }

const remembered = new Map<string, Remembered>()
// Not this worker's host. A cache key on our own host can wait on the request that is writing it.
const MEMORY_URL = "https://hktraffic-cache.invalid/mtr-board-memory"
let blockedUntil = 0
let failures = 0

type SavedMemory = { stations: { key: string; at: number; board: MtrBoard; observations: TrainObservation[] }[] }

// Station positions stay in the network file. These calls are only the next-train
// clock. The published feed answers 429 if all 120 station calls arrive together,
// so each refresh reads 16. The shared book is which stations we already know.
// The next 16 are chosen so every line, including Tsuen Wan, is read before a
// line that was just read gets another turn.
export async function loadMtrSnapshot(now = Date.now()): Promise<MtrResponse> {
  if (now >= blockedUntil) failures = 0
  let missed = 0
  await readSharedMemory(now)
  if (now >= blockedUntil) {
    const due = fairLineReads(
      mtrQueries(),
      (pair) => remembered.get(`${pair.line}-${pair.station}`)?.at ?? null,
      now,
      STALE_MS,
      REFRESH_SLICE,
    )
    await pool(due, FETCH_LIMIT, async (pair) => {
      const key = `${pair.line}-${pair.station}`
      const previous = remembered.get(key)
      let parsed = await fetchPair(pair.line, pair.station)
      if (parsed && parsed.observations.length === 0) {
        const again = await fetchPair(pair.line, pair.station)
        if (again && again.observations.length > 0) parsed = again
      }
      if (!parsed) { missed += 1; return }
      if (parsed.observations.length === 0 && previous && previous.observations.length > 0 && now - previous.at < 180_000) return
      remembered.set(key, {
        at: now,
        board: parsed.board,
        observations: carryArrivalClock(previous?.observations ?? [], parsed.observations),
      })
    })
    await writeSharedMemory(now)
  }

  const boards: MtrBoard[] = []
  const observations: TrainObservation[] = []
  for (const [key, item] of remembered) {
    if (now - item.at > REMEMBER_MS) {
      remembered.delete(key)
      continue
    }
    boards.push({ ...item.board, observedAt: item.board.observedAt ?? new Date(item.at).toISOString() })
    observations.push(...item.observations)
  }
  if (boards.length === 0) {
    return { ok: false, error: "Next train feed failed", observedAt: null, trains: [], boards: [] }
  }
  const trains = estimateTrains(networkRoutes(), observations, stationPoint).map((train): MtrTrain => ({
    id: train.id,
    line: train.line,
    dest: train.dest,
    plat: train.plat,
    ttnt: train.ttnt,
    observedAt: new Date(train.observedAt).toISOString(),
    delay: train.delay,
    timeType: train.timeType,
    anchor: train.anchor,
    path: train.path,
    hold: train.hold,
  }))
  const observedAt = Math.max(...[...remembered.values()].map((item) => item.at))
  const error = now < blockedUntil ? "MTR rate limited; retrying after 45 seconds" : missed > 0 ? "Some MTR station boards could not refresh" : undefined
  const complete = mtrQueries().every(pair => remembered.has(`${pair.line}-${pair.station}`))
  return { ok: true, complete, observedAt: new Date(observedAt).toISOString(), trains, boards, ...(error ? { stale: true, error } : {}) }
}

async function readSharedMemory(now: number): Promise<void> {
  const cache = await openFeedCache()
  if (!cache) return
  try {
    const hit = await cache.match(new Request(MEMORY_URL))
    if (!hit?.ok) return
    const saved = await hit.json() as SavedMemory
    for (const item of saved.stations ?? []) {
      if (now - item.at > REMEMBER_MS) continue
      const current = remembered.get(item.key)
      if (!current || item.at > current.at) remembered.set(item.key, { at: item.at, board: item.board, observations: item.observations })
    }
  } catch {
    // A broken cache entry leaves this worker with the stations it already holds.
  }
}

async function writeSharedMemory(now: number): Promise<void> {
  const cache = await openFeedCache()
  if (!cache) return
  const stations: SavedMemory["stations"] = []
  for (const [key, item] of remembered) {
    if (now - item.at > REMEMBER_MS) continue
    stations.push({ key, at: item.at, board: item.board, observations: item.observations })
  }
  try {
    await cache.put(
      new Request(MEMORY_URL),
      new Response(JSON.stringify({ stations } satisfies SavedMemory), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=180" },
      }),
    )
  } catch {
    // The next request still has this worker's own copy.
  }
}

async function fetchPair(line: string, station: string) {
  if (Date.now() < blockedUntil || failures >= 8) return null
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(station)}&lang=tc`
  try {
    const response = await fetchUpstream(url, 15_000, {
      timeoutMs: 5_000,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HKTrafficIntelligence/1.0; +https://hktraffic.keith-li.workers.dev)",
      },
    })
    if (response.status === 429) {
      blockedUntil = Date.now() + 45_000
      failures += 1
      return null
    }
    if (response.status >= 500) {
      failures += 1
      return null
    }
    if (response.status !== 200) return null
    failures = 0
    const payload: unknown = JSON.parse(new TextDecoder().decode(response.body))
    return readSchedule(payload, line, station, Date.now())
  } catch {
    failures += 1
    return null
  }
}
