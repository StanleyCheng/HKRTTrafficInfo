import assert from "node:assert/strict"
import { STOP_LABEL_WIDTH, declutterLabels, stopLabelHeight, type StopLabelItem, type StopLabelPlacement } from "../lib/stop-labels.ts"

// Stops offer plate boxes in preference order (key, x, y), mirroring the
// anchor candidates the map builds for .stop-plate and its .pos-* classes.
const at = (id: string, priority: number, ...placements: [string, number, number][]): StopLabelItem => ({
  id,
  priority,
  placements: placements.map(([key, x, y]) => ({ key, x, y, w: 150, h: 53 })),
})

// The four anchors exactly as platePlacements in traffic-map.tsx derives them
// from a stop's container point.
const mapCandidates = (x: number, y: number): StopLabelPlacement[] => [
  { key: "right", x: x + 13, y: y - 11, w: 150, h: 53 },
  { key: "left", x: x - 163, y: y - 11, w: 150, h: 53 },
  { key: "above", x: x - 75, y: y - 66, w: 150, h: 53 },
  { key: "below", x: x - 75, y: y + 13, w: 150, h: 53 },
]

// Overlap removal: the weaker label loses.
const crowded = declutterLabels([
  at("busy", 12, ["right", 0, 0]),
  at("quiet", 2, ["right", 60, 20]),
])
assert.deepEqual([...crowded.keys()], ["busy"])

// Priority order decides the winner regardless of input order.
const flipped = declutterLabels([
  at("quiet", 2, ["right", 60, 20]),
  at("busy", 12, ["right", 0, 0]),
])
assert.deepEqual([...flipped.keys()], ["busy"])

// Equal priority: lowest stop id wins, so pans and polls keep the same labels.
const tie = declutterLabels([
  at("kmb-B2", 4, ["right", 20, 5]),
  at("kmb-A1", 4, ["right", 0, 0]),
])
assert.deepEqual([...tie.keys()], ["kmb-A1"])

// Labels that only touch edges do not overlap; far labels all survive.
const spread = declutterLabels([
  at("a", 1, ["right", 0, 0]),
  at("b", 1, ["right", 150, 0]),
  at("c", 1, ["right", 0, 53]),
])
assert.equal(spread.size, 3)

// Preference order: the first fitting anchor wins, so plates stay right by default.
const preferred = declutterLabels([at("solo", 1, ["right", 0, 0], ["left", -170, 0])])
assert.equal(preferred.get("solo"), "right")

// Placement fallback: a label that collides on the right survives on the left.
const fallback = declutterLabels([
  at("strong", 10, ["right", 0, 0], ["left", -170, 0]),
  at("weak", 5, ["right", 20, 10], ["left", -150, 10]),
])
assert.equal(fallback.get("strong"), "right")
assert.equal(fallback.get("weak"), "left")

// Two stops 100px apart: a single fixed anchor fits only one plate, the
// fallback anchors fit both without overlapping.
const singleAnchor = declutterLabels([
  { id: "hub", priority: 9, placements: mapCandidates(0, 0).slice(0, 1) },
  { id: "spoke", priority: 8, placements: mapCandidates(100, 0).slice(0, 1) },
])
assert.equal(singleAnchor.size, 1)
const multiAnchor = declutterLabels([
  { id: "hub", priority: 9, placements: mapCandidates(0, 0) },
  { id: "spoke", priority: 8, placements: mapCandidates(100, 0) },
])
assert.equal(multiAnchor.size, 2)
assert.equal(multiAnchor.get("hub"), "right")
assert.equal(multiAnchor.get("spoke"), "above")

// Every anchor blocked: the label hides instead of overlapping.
const boxedIn = declutterLabels([
  at("wall", 9, ["right", 0, 0]),
  {
    id: "trapped",
    priority: 1,
    placements: [
      { key: "right", x: 50, y: 10, w: 150, h: 53 },
      { key: "left", x: 20, y: 10, w: 150, h: 53 },
    ],
  },
])
assert.equal(boxedIn.has("trapped"), false)
assert.equal(boxedIn.get("wall"), "right")

// Determinism: permuting the input never changes the outcome.
const stops = [
  at("s1", 7, ["right", 10, 10], ["left", -160, 10]),
  at("s2", 7, ["right", 90, 40], ["left", -80, 40]),
  at("s3", 3, ["right", 400, 10]),
  at("s4", 9, ["right", 430, 90], ["left", 270, 90]),
  at("s5", 1, ["right", 120, 200]),
]
const forward = declutterLabels(stops)
const shuffled = declutterLabels([...stops].reverse())
assert.deepEqual([...forward.entries()], [...shuffled.entries()])
assert.deepEqual([...declutterLabels(stops).entries()], [...forward.entries()])

// Viewport culling: outside labels are dropped and never block visible ones.
const culled = declutterLabels([
  at("edge", 1, ["right", 750, 10]),
  at("offscreen", 99, ["right", 820, 15]),
], { x: 0, y: 0, w: 800, h: 600 })
assert.deepEqual([...culled.keys()], ["edge"])

// Culling is per anchor: a fully offscreen anchor is skipped and an onscreen
// fallback still shows.
const clipped = declutterLabels([
  {
    id: "clipped",
    priority: 1,
    placements: [
      { key: "right", x: 810, y: 10, w: 150, h: 53 },
      { key: "left", x: 600, y: 10, w: 150, h: 53 },
    ],
  },
], { x: 0, y: 0, w: 800, h: 600 })
assert.equal(clipped.get("clipped"), "left")

// Fixed box estimates stay in sync with the .stop-plate CSS metrics.
assert.equal(STOP_LABEL_WIDTH, 150)
assert.equal(stopLabelHeight(0), 21)
assert.equal(stopLabelHeight(2), 53)
assert.equal(stopLabelHeight(4), 85)
assert.equal(stopLabelHeight(9), 85)
