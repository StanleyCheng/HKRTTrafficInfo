import assert from "node:assert/strict"
import test from "node:test"
import { readableInk } from "../lib/traffic.ts"

// Station pills paint the station name on the train line colour, so the ink must
// be the one of white/#172c39 with the higher WCAG contrast against that colour.
test("readableInk keeps white on dark line colours and switches to dark ink on light ones", () => {
  assert.equal(readableInk("#E2231A"), "#fff") // Tsuen Wan red — 4.68:1 vs 3.08:1
  assert.equal(readableInk("#007DC5"), "#fff") // Island blue — 4.43:1 vs 3.26:1
  assert.equal(readableInk("#6B208B"), "#fff") // Tseung Kwan O purple — 9.52:1 vs 1.51:1
  assert.equal(readableInk("#9A3B26"), "#fff") // Tuen Ma brown — 6.94:1 vs 2.08:1
  assert.equal(readableInk("#00888A"), "#fff") // Airport Express teal — 4.30:1 vs 3.36:1
  assert.equal(readableInk("#00A651"), "#172c39") // Kwun Tong green — 4.51:1 vs 3.20:1
  assert.equal(readableInk("#F550A8"), "#172c39") // Disneyland pink — 4.53:1 vs 3.18:1
  assert.equal(readableInk("#5EB6E4"), "#172c39") // East Rail light blue — 6.38:1 vs 2.26:1
  assert.equal(readableInk("#BAC429"), "#172c39") // South Island yellow — 7.57:1 vs 1.91:1
  assert.equal(readableInk("#F7943E"), "#172c39") // Tung Chung orange — 6.36:1 vs 2.27:1
  assert.equal(readableInk("#F5C400"), "#172c39") // Light rail yellow — 8.78:1 vs 1.64:1
  assert.equal(readableInk(""), "#fff") // unparsable colours fall back to white
  assert.equal(readableInk("not-a-colour"), "#fff")
})
