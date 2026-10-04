import assert from "node:assert/strict"
import { nlbArrivalMs } from "../lib/nlb-clock.ts"

const now = Date.parse("2026-10-03T14:06:00+08:00")
const arrival = nlbArrivalMs("2026-10-03 14:20:00")

assert.equal(arrival, Date.parse("2026-10-03T14:20:00+08:00"))
assert.equal(Math.round((arrival - now) / 60_000), 14)
assert.equal(nlbArrivalMs("2026-10-03T14:20:00+08:00"), arrival)
assert.equal(Number.isNaN(nlbArrivalMs("")), true)
