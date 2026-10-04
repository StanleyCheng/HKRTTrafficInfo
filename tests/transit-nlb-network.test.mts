import assert from "node:assert/strict"
import { inLantau, nearestNlbStops } from "../lib/nlb-network.ts"

assert.equal(inLantau(114.002, 22.265), true)
assert.equal(inLantau(114.172, 22.305), false)
assert.equal(nearestNlbStops(114.172, 22.305, 6).length, 0)
const muiWo = nearestNlbStops(114.002, 22.265, 6)
assert.ok(muiWo.some((stop) => stop.routes.includes("1")))
