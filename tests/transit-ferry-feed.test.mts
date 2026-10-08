import assert from "node:assert/strict"
import { ferryCalls, ferryMinutes, starFerryRemark, starSailings } from "../lib/ferry-clock.ts"

const now = Date.parse("2026-10-03T04:00:00+08:00")
const calls = ferryCalls([
  { route: "CECC", destTc: "長洲", destEn: "Cheung Chau", eta: "2026-10-03T04:15:00+08:00" },
], now)
assert.equal(calls[0]?.minutes, 15)
assert.equal(calls[0]?.route, "CECC")
assert.equal(ferryMinutes("04:48", now), 48)
assert.equal(ferryMinutes("03:50", now), null)
assert.equal(ferryMinutes("04:15", Date.parse("2026-10-03T04:43:00+08:00")), null)
assert.equal(ferryMinutes("00:20", Date.parse("2026-10-03T23:10:00+08:00")), 70)
assert.equal(ferryMinutes("2026-10-03T03:50:00+08:00", now), null)
assert.equal(ferryMinutes("2026-10-03T03:59:00+08:00", now), 0)
const arrived = ferryCalls([
  { route: "CECC", destTc: "長洲", destEn: "Cheung Chau", originTc: "中環", originEn: "Central", arriving: true, eta: "2026-10-03T04:15:00+08:00", remarkTc: "風浪", remarkEn: "Rough sea" },
], now)
assert.equal(arrived[0]?.arriving, true)
assert.equal(arrived[0]?.originTc, "中環")
assert.equal(arrived[0]?.remarkTc, "風浪")
assert.deepEqual(starFerryRemark("6 -- 8"), { remarkTc: "6至8分鐘一班", remarkEn: "every 6 to 8 min" })
assert.deepEqual(starFerryRemark("6"), { remarkTc: "6分鐘一班", remarkEn: "every 6 min" })

const sheet = {
  from: "star-central",
  csv: [
    "Central to Tsim Sha Tsui,Mon – Fri  (Except Public Holidays),9:55am-8:40pm,6 -- 8",
    "Central to Tsim Sha Tsui,\"Sat, Sun & Public Holidays\",7:25am-10:40pm,6 -- 8",
    "Tsim Sha Tsui to Central,\"Sat, Sun & Public Holidays\",7:15am-10:30pm,6 --8",
  ].join("\n"),
}
const saturday = starSailings([sheet], Date.parse("2026-10-03T10:00:00+08:00"))
assert.deepEqual([...new Set(saturday.map((row) => row.pierId))], ["star-central", "star-tst"])
assert.match(saturday[0]?.remarkEn ?? "", /Headway estimate.*every 6 to 8 min/)
assert.equal(saturday[0]?.firstFerry, "07:25")
assert.equal(saturday[0]?.lastFerry, "22:40")
assert.ok(saturday.every((row) => row.scheduled))
const friday = starSailings([sheet], Date.parse("2026-10-02T10:00:00+08:00"))
assert.deepEqual([...new Set(friday.map((row) => row.pierId))], ["star-central"])
assert.equal(starSailings([sheet], Date.parse("2026-10-03T05:00:00+08:00"))[0]?.firstFerry, "07:25")

const wanChai = {
  from: "star-wanchai",
  csv: [
    "Wanchai to Tsim Sha Tsui,Mon – Sat (Except Public Holidays),9:12am-4:48pm,12",
    "Wanchai to Tsim Sha Tsui,Sun & Public Holidays,7:40am-1:00pm,20",
    "Tsim Sha Tsui to Wanchai,Mon – Sat (Except Public Holidays),9:12am-4:48pm,12",
    "Tsim Sha Tsui to Wanchai,Sun & Public Holidays,7:40am-1:00pm,20",
  ].join("\n"),
}
const saturdayNoon = starSailings([wanChai], Date.parse("2026-10-03T12:24:00+08:00"))
assert.deepEqual([...new Set(saturdayNoon.map((row) => row.remarkEn))], ["Headway estimate · every 12 min"])
assert.deepEqual([...new Set(saturdayNoon.map((row) => row.destEn))], ["Tsim Sha Tsui", "Wan Chai"])
const sundayNoon = starSailings([wanChai], Date.parse("2026-10-04T12:24:00+08:00"))
assert.deepEqual([...new Set(sundayNoon.map((row) => row.remarkEn))], ["Headway estimate · every 20 min"])

const everyDay = {
  from: "star-central",
  csv: "Central to Tsim Sha Tsui,Mon – Sun,9:00am-9:00pm,8",
}
assert.equal(starSailings([everyDay], Date.parse("2026-10-02T12:00:00+08:00"))[0]?.remarkEn, "Headway estimate · every 8 min")
assert.equal(starSailings([everyDay], Date.parse("2026-10-03T12:00:00+08:00"))[0]?.remarkEn, "Headway estimate · every 8 min")
assert.equal(starSailings([everyDay], Date.parse("2026-10-04T12:00:00+08:00"))[0]?.remarkEn, "Headway estimate · every 8 min")

const overnight = {
  from: "star-central",
  csv: "Central to Tsim Sha Tsui,\"Sat, Sun & Public Holidays\",11:00pm-1:00am,15",
}
assert.equal(starSailings([overnight], Date.parse("2026-10-03T23:30:00+08:00"))[0]?.remarkEn, "Headway estimate · every 15 min")
assert.equal(starSailings([overnight], Date.parse("2026-10-04T00:30:00+08:00"))[0]?.eta, "2026-10-03T15:00:00.000Z")
const afterService = starSailings([everyDay], Date.parse("2026-10-04T22:00:00+08:00"))
assert.equal(afterService.at(-1)?.eta, "")
assert.equal(afterService.at(-1)?.lastFerry, "21:00")
const holiday = starSailings([wanChai], Date.parse("2026-10-01T12:00:00+08:00"), true)
assert.equal(holiday[0]?.firstFerry, "07:40")
const fridayOvernight = { from: "star-central", csv: "Central to Tsim Sha Tsui,Mon – Fri (Except Public Holidays),11:00pm-1:00am,15" }
assert.ok(starSailings([fridayOvernight], Date.parse("2026-10-03T00:30:00+08:00")).length > 0)
assert.equal(starSailings([fridayOvernight], Date.parse("2026-10-02T00:30:00+08:00"), false, true).length, 0)
