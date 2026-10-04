import assert from "node:assert/strict"
import { shortStopTitle, stopPlate } from "../lib/stop-plate.ts"

assert.equal(shortStopTitle("屯門公路巴士轉乘站(上層), 屯門公路"), "上層")
assert.equal(shortStopTitle("屯門公路巴士轉乘站(下層), 青山公路"), "下層")
assert.equal(shortStopTitle("Tuen Mun Road Bus-Bus Interchange (Upper Level), Tuen Mun Road"), "Upper")
assert.equal(shortStopTitle("Tuen Mun Road Bus-Bus Interchange (Lower Level), Castle Peak Road"), "Lower")
assert.equal(shortStopTitle("置樂花園, 青山公路"), "置樂花園")
assert.equal(shortStopTitle("Chi Lok Fa Yuen, Castle Peak Road"), "Chi Lok Fa Yuen")

const named = stopPlate("金鐘", [])
assert.equal(named.title, "金鐘")
assert.deepEqual(named.lines, [])

const lower = stopPlate("屯門公路巴士轉乘站(下層), 青山公路", ["N952", "962", "952", "952C", "962"])
assert.equal(lower.title, "下層")
assert.deepEqual(lower.lines, ["952 952C 962", "N952"])

const town = stopPlate("置樂花園, 青山公路", ["962X", "952", "B3", "962C"])
assert.equal(town.lines[0], "952 962C 962X")
assert.equal(town.lines.join(" ").split(" ").includes("962"), false)
