import assert from "node:assert/strict"
import piersFile from "../data/ferry-piers.json" with { type: "json" }

const piers = Object.fromEntries(piersFile.piers.map((pier) => [pier.id, pier]))

// Berth measured on the pier deck, not the road behind it.
const berths: Record<string, [number, number]> = {
  "hkkf-central": [114.15845, 22.28792],
  "sun-central": [114.15938, 22.28768],
  "hkkf-central-6": [114.1603, 22.28739],
  "sun-north-point": [114.20091, 22.29417],
  "hkkf-hei-ling-chau": [114.02769, 22.25796],
  "sun-chi-ma-wan": [113.99994, 22.23958],
  "hkkf-yung-shue-wan": [114.10877, 22.22631],
  "hkkf-sok-kwu-wan": [114.1313, 22.20626],
  "sun-mui-wo": [114.00116, 22.26507],
  "fortune-kwun-tong": [114.22159, 22.30633],
}

for (const [id, [lng, lat]] of Object.entries(berths)) {
  const pier = piers[id]
  assert.ok(pier, id)
  const cos = Math.cos((lat * Math.PI) / 180)
  const metres = Math.hypot((pier.lng - lng) * cos * 111_320, (pier.lat - lat) * 110_540)
  assert.ok(metres < 30, `${id} is ${Math.round(metres)} m from the berth`)
}
