import assert from "node:assert/strict"
import test from "node:test"
import { loadMtrSnapshot } from "../lib/mtr-feed.ts"

test("MTR 429 blocks further requests for 45 seconds with at most four in flight", async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = Date.parse("2026-10-03T04:00:00Z")
  let count = 0
  let active = 0
  let peak = 0
  let limited = false
  Date.now = () => now
  globalThis.fetch = async (input) => {
    count += 1
    active += 1
    peak = Math.max(peak, active)
    await Promise.resolve()
    active -= 1
    if (limited) return new Response("Too many requests", { status: 429 })
    const url = new URL(String(input))
    const key = `${url.searchParams.get("line")}-${url.searchParams.get("sta")}`
    return Response.json({ data: { [key]: {
      curr_time: "2026-10-03 12:00:00",
      UP: [{ dest: "TSW", ttnt: "3", plat: "1" }],
    } } })
  }
  try {
    const initial = await loadMtrSnapshot(now)
    assert.equal(count, 16)
    assert.equal(initial.boards.length, 16)
    assert.equal(initial.observedAt, new Date(now).toISOString())
    assert.equal(initial.boards[0]?.observedAt, initial.observedAt)
    limited = true
    now += 21_000
    const failed = await loadMtrSnapshot(now)
    assert.ok(count > 16 && count <= 20)
    assert.equal(failed.stale, true)
    assert.match(failed.error ?? "", /rate limited/)
    assert.equal(failed.observedAt, initial.observedAt)
    assert.ok(peak <= 4)
    const first = count
    now += 44_999
    const held = await loadMtrSnapshot(now)
    assert.equal(count, first)
    assert.equal(held.observedAt, initial.observedAt)
    assert.equal(held.stale, true)
    assert.equal(held.boards[0]?.observedAt, initial.boards[0]?.observedAt)
    const heldBoard = held.boards[0]!
    const dueAt = Date.parse(heldBoard.observedAt!) + heldBoard.trains[0]!.ttnt * 60_000
    assert.equal(Math.ceil((dueAt - now) / 60_000), 2, "retained three-minute clock ages while global backoff is active")
    now += 1
    await loadMtrSnapshot(now)
    assert.ok(count > first)
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})
