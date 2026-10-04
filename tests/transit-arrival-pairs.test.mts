import assert from "node:assert/strict"
import { arrivalPairs } from "../lib/arrival-pairs.ts"

const pairs = arrivalPairs([
  { id: "a", routes: ["1", "2", "3"] },
  { id: "b", routes: ["4"] },
], 3)
assert.deepEqual(pairs, [
  { stopId: "a", route: "1" },
  { stopId: "a", route: "2" },
  { stopId: "a", route: "3" },
])

const shared = arrivalPairs([
  { id: "a", routes: ["1"] },
  { id: "b", routes: ["4", "5"] },
], 24)
assert.deepEqual(shared.map((pair) => pair.route), ["1", "4", "5"])
