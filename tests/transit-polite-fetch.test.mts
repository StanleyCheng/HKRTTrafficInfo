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
  takeEtaTurn("kmb", async () => {
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
const held = takeEtaTurn("kmb", async () => {
  ran += 1
  await new Promise((resolve) => setTimeout(resolve, 400))
  return "held"
})
await new Promise((resolve) => setTimeout(resolve, 30))
const sibling = await takeEtaTurn("ferry", async () => "ferry")
assert.equal(sibling, "ferry", "A slow bus refresh must not starve ferry or other operators")
const joined = await takeEtaTurn("kmb", async () => {
  ran += 1
  return "second"
})
assert.equal(joined, "held", "Concurrent callers join the same in-flight refresh instead of returning null")
assert.equal(ran, 1, "Joined callers must not run another task")
assert.equal(await held, "held")
