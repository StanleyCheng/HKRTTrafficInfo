import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { loadFerrySnapshot } from "../lib/ferry-feed.ts"
import { ETA_REFRESH_TIMEOUT_MS } from "../lib/polite-fetch.ts"

test("a slow holiday/timetable branch cannot delay live ferry clocks beyond their deadline", { timeout: 1000 }, async (t) => {
  const originalFetch = globalThis.fetch
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
  const deadline = new AbortController()
  t.mock.method(AbortSignal, "timeout", (ms: number) => ms === ETA_REFRESH_TIMEOUT_MS ? deadline.signal : nativeTimeout(ms))
  const now = Date.parse("2026-10-03T04:00:00Z")
  t.mock.method(Date, "now", () => now)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes("1823.gov.hk")) {
      await held
      return Response.json({ vcalendar: [{ vevent: [{ dtstart: ["20261001"] }] }] })
    }
    if (url.includes("fortuneferry")) return new Response('<td class="time">12:15</td>')
    if (url.includes("starferry")) return new Response("Central to Tsim Sha Tsui,Mon – Sun,7:00am-11:00pm,8")
    return Response.json({ data: [] })
  }
  try {
    const pending = loadFerrySnapshot(now)
    await setImmediate()
    deadline.abort(new DOMException("Batch expired", "TimeoutError"))
    const body = await pending
    assert.equal(body.ok, true)
    assert.equal(body.stale, true)
    assert.equal(body.cacheable, false)
    assert.match(body.error ?? "", /timetable refresh deadline exceeded/)
    assert.ok(body.piers.some(pier => pier.id === "fortune-north-point" && pier.calls.length > 0), "working timetables remain visible while another branch is late")
  } finally { release(); await setImmediate(); globalThis.fetch = originalFetch }
})
