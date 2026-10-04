import assert from "node:assert/strict"
import { GMB_MIN_ZOOM, KMB_MIN_ZOOM } from "../lib/kmb-view.ts"
import { isListedKmbRow, kmbReachMetres, STOP_CAP } from "../lib/kmb-reach.ts"

const close = kmbReachMetres(16.5, 22.38274)
assert.ok(close > 450 && close <= 650)
assert.equal(kmbReachMetres(13, 22.38274), 650)
assert.equal(GMB_MIN_ZOOM, 17)
assert.ok(GMB_MIN_ZOOM > KMB_MIN_ZOOM)
assert.equal(kmbReachMetres(16, 22.305), 650)
assert.ok(kmbReachMetres(GMB_MIN_ZOOM, 22.305) < 400)
assert.equal(kmbReachMetres(Number.NaN, 22.38), 450)
assert.equal(STOP_CAP, 40)

assert.equal(isListedKmbRow({ eta_seq: 1, route: "85A" }), true)
assert.equal(isListedKmbRow({ eta_seq: 2, route: "85A" }), false)
assert.equal(isListedKmbRow({ eta_seq: 1, route: "  " }), false)
