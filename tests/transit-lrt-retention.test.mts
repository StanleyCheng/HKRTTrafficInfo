import assert from "node:assert/strict"
import test from "node:test"
import { loadLrtSnapshot } from "../lib/lrt-feed.ts"

test("failed LRT refresh preserves each station clock and exposes partial staleness", async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = Date.parse("2026-10-03T04:00:00Z")
  let failing = false
  Date.now = () => now
  globalThis.fetch = async () => failing
    ? new Response("Unavailable", { status: 503 })
    : Response.json({ platform_list: [{ platform_id: 1, route_list: [{ route_no: "610", dest_ch: "屯門碼頭", time_en: "3 mins", arrival_departure: "A" }] }] })
  try {
    const fresh = await loadLrtSnapshot(now)
    assert.equal(fresh.boards.length, 8)
    assert.equal(fresh.boards[0]?.observedAt, new Date(now).toISOString())
    assert.equal(fresh.boards[0]?.calls[0]?.ttnt, 3)
    failing = true
    now += 65000
    const held = await loadLrtSnapshot(now)
    assert.equal(held.ok, true)
    assert.equal(held.stale, true)
    assert.match(held.error ?? "", /could not refresh/)
    assert.equal(held.observedAt, fresh.observedAt)
    assert.deepEqual(held.boards, fresh.boards)
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})
