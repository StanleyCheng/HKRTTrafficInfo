import assert from "node:assert/strict"
import { fairLineReads, oldestDue } from "../lib/refresh-slice.ts"

const now = 1_000_000
const items = ["a", "b", "c", "d"]
const ages: Record<string, number | null> = { a: now - 5_000, b: null, c: now - 40_000, d: now - 20_000 }
const due = oldestDue(items, (item) => ages[item] ?? null, now, 20_000, 2)
assert.deepEqual(due, ["b", "c"])
assert.deepEqual(oldestDue(items, (item) => ages[item] ?? null, now, 20_000, 0), [])

const network = [
  ...Array.from({ length: 5 }, (_, index) => ({ line: "AEL", station: `A${index}` })),
  ...Array.from({ length: 16 }, (_, index) => ({ line: "TWL", station: `T${index}` })),
  ...Array.from({ length: 2 }, (_, index) => ({ line: "DRL", station: `D${index}` })),
]
const first = fairLineReads(network, () => null, now, 20_000, 4)
assert.deepEqual(first.map((item) => item.line), ["TWL", "AEL", "DRL", "TWL"])
assert.equal(first.filter((item) => item.line === "TWL").length, 2)

const freshAel = fairLineReads(
  network,
  (item) => (item.line === "AEL" ? now - 1_000 : null),
  now,
  20_000,
  3,
)
assert.deepEqual(freshAel.map((item) => item.line), ["TWL", "DRL", "TWL"])
