import assert from "node:assert/strict"
import { gmbStopsWithin } from "../lib/gmb-reach.ts"

const near = gmbStopsWithin(114.172, 22.305, 400, 24)
assert.ok(near.length > 0)
assert.ok(near.length <= 24)
assert.ok(near.every((stop) => Array.isArray(stop.routes)))
