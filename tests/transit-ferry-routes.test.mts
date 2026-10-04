import assert from "node:assert/strict"
import piersFile from "../data/ferry-piers.json" with { type: "json" }
import { SUN_ROUTES, ferryBadge, ferryLeg } from "../lib/ferry-routes.ts"

const SPEC = [
  "CECC",
  "CCCE",
  "CEMW",
  "MWCE",
  "NPHH",
  "HHNP",
  "NPKC",
  "KCNP",
  "IIPECMUW",
  "IIMUWPEC",
  "IIMUWCMW",
  "IICMWMUW",
  "IICMWCHC",
  "IICHCCMW",
  "IICHCMUW",
  "IIMUWCHC",
]

assert.deepEqual(SUN_ROUTES.map((route) => route.code), SPEC)

const pierIds = new Set(piersFile.piers.map((pier) => pier.id))
for (const route of SUN_ROUTES) {
  assert.ok(pierIds.has(route.from), route.from)
  assert.ok(pierIds.has(route.to), route.to)
}

assert.equal(ferryBadge("IICMWCHC").tc, "橫水渡")
assert.equal(ferryBadge("IICMWCHC").en, "Inter-island")
assert.equal(ferryBadge("CECC").tc, "新渡輪")
assert.equal(ferryBadge("1").tc, "港九小輪")
assert.equal(ferryBadge("1").en, "HK & Kowloon Ferry")
assert.equal(ferryBadge("天星").tc, "天星")
assert.equal(ferryBadge("富裕").tc, "富裕小輪")
assert.equal(ferryBadge("富裕").en, "Fortune Ferry")
assert.equal(ferryBadge("IICMWCHC").tc.includes("IICMWCHC"), false)
assert.equal(ferryBadge("NOTACODE").tc, "渡輪")
assert.equal(ferryBadge("NOTACODE").en.includes("NOTACODE"), false)

const chiMaWan = SUN_ROUTES.find((route) => route.code === "IICMWCHC")
assert.ok(chiMaWan)
assert.deepEqual(ferryLeg({ arriving: false, destTc: chiMaWan.destTc, destEn: chiMaWan.destEn }), {
  arriving: false,
  tc: "長洲",
  en: "Cheung Chau",
})
assert.deepEqual(ferryLeg({ arriving: true, originTc: chiMaWan.fromTc, originEn: chiMaWan.fromEn, destTc: chiMaWan.destTc, destEn: chiMaWan.destEn }), {
  arriving: true,
  tc: "芝麻灣",
  en: "Chi Ma Wan",
})
assert.equal(ferryLeg({ arriving: true, destTc: "長洲", destEn: "Cheung Chau" }), null)
assert.equal(JSON.stringify(ferryLeg({ arriving: false, destTc: "長洲", destEn: "Cheung Chau" })).includes("IICMWCHC"), false)
