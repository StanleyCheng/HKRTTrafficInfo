import assert from "node:assert/strict"
import piersFile from "../data/ferry-piers.json" with { type: "json" }

const piers = Object.fromEntries(piersFile.piers.map((pier) => [pier.id, pier]))

// Independent Transport Department berth coordinates; source: docs/ferry-geography.md.
const berths: Record<string, [number, number]> = {
  "star-central": [114.161145, 22.286943],
  "star-tst": [114.168635, 22.293762],
  "hkkf-central": [114.158447, 22.287918],
  "sun-central": [114.159378, 22.287648],
  "hkkf-central-6": [114.160252, 22.287268],
  "sun-cheung-chau": [114.02848, 22.208617],
  "sun-hung-hom": [114.190257, 22.301122],
  "sun-kowloon-city": [114.194277, 22.317873],
  "hkkf-peng-chau": [114.037143, 22.284536],
  "sun-north-point": [114.199864, 22.293824],
  "fortune-north-point": [114.200863, 22.294194],
  "fortune-kai-tak": [114.213017, 22.309778],
  "star-wanchai": [114.176263, 22.283043],
  "hkkf-hei-ling-chau": [114.02774, 22.25796],
  "sun-chi-ma-wan": [114.000268, 22.239654],
  "hkkf-yung-shue-wan": [114.108861, 22.226316],
  "hkkf-sok-kwu-wan": [114.131099, 22.206339],
  "sun-mui-wo": [114.002157, 22.265059],
  "fortune-kwun-tong": [114.22143, 22.306182],
}

for (const [id, [lng, lat]] of Object.entries(berths)) {
  const pier = piers[id]
  assert.ok(pier, id)
  const cos = Math.cos((lat * Math.PI) / 180)
  const metres = Math.hypot((pier.lng - lng) * cos * 111_320, (pier.lat - lat) * 110_540)
  assert.ok(metres < 30, `${id} is ${Math.round(metres)} m from the berth`)
}
