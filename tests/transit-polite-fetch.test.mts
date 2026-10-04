import assert from "node:assert/strict"
import { politeQueue, takeEtaTurn } from "../lib/polite-fetch.ts"

const run = politeQueue(2)
let active = 0
let peak = 0
const tasks = Array.from({ length: 6 }, () =>
  run(async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
  }),
)
await Promise.all(tasks)
assert.equal(peak, 2)

let refreshing = 0
let refreshPeak = 0
const turns = Array.from({ length: 3 }, () =>
  takeEtaTurn(async () => {
    refreshing += 1
    refreshPeak = Math.max(refreshPeak, refreshing)
    await new Promise((resolve) => setTimeout(resolve, 30))
    refreshing -= 1
    return true
  }),
)
const finished = await Promise.all(turns)
assert.equal(refreshPeak, 1)
assert.deepEqual(finished, [true, true, true])

let ran = 0
const held = takeEtaTurn(async () => {
  ran += 1
  await new Promise((resolve) => setTimeout(resolve, 400))
  return "held"
})
await new Promise((resolve) => setTimeout(resolve, 30))
const skipped = await takeEtaTurn(async () => {
  ran += 1
  return "second"
})
assert.equal(skipped, null)
assert.equal(ran, 1)
assert.equal(await held, "held")
