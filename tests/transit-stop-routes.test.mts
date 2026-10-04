import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { readRouteStopList, routesWithoutArrival } from "../lib/stop-routes.ts"

assert.deepEqual(routesWithoutArrival(["79", "982C", "B8"], []), ["79", "982C", "B8"])
assert.deepEqual(routesWithoutArrival(["79", "982C", "B8"], ["79"]), ["982C", "B8"])
assert.deepEqual(routesWithoutArrival(["79", "79", " B8 "], []), ["79", "B8"])
assert.deepEqual(routesWithoutArrival(["79"], ["79"]), [])
assert.deepEqual(routesWithoutArrival([], []), [])

const parsed = readRouteStopList({
  data: [
    { route: "35A", stop: "YT119" },
    { route: "234X", stop: "YT119" },
    { route: "35A", stop: "YT119" },
    { route: "1", stop: "OTHER" },
    { route: "", stop: "YT119" },
  ],
}, 2)
assert.deepEqual(parsed, { YT119: ["35A", "234X"], OTHER: ["1"] })
assert.equal(readRouteStopList({ data: [{ route: "1", stop: "A" }] }, 2), null)

const published = JSON.parse(readFileSync(new URL("../data/kmb-routes.json", import.meta.url), "utf8")) as {
  stops: Record<string, string[]>
}
assert.deepEqual(published.stops.B0F64FFFBECE8AA4, ["35A", "35X", "36X", "37X", "41A", "234X", "242X"])
