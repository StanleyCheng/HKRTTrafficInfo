import assert from "node:assert/strict"
import { parseHkkfTimetable, parseSunTimetable } from "../lib/ferry-timetable.ts"

const friday = Date.parse("2026-10-02T12:00:00+08:00")
const saturday = Date.parse("2026-10-03T12:00:00+08:00")
const sunCsv = [
  "Direction,Service Date,Service Hour,Remark",
  "Central to Cheung Chau,Mondays to Saturdays except public holidays,12:30 a.m.,",
  "Central to Cheung Chau,Mondays to Saturdays except public holidays,7:30 p.m.,3",
  "Central to Cheung Chau,Mondays to Saturdays except public holidays,7:40 p.m.,4",
  "Central to Cheung Chau,Sundays and public holidays,11:55 p.m.,",
  "Chueung Chau to Mui Wo,Daily,6:00 a.m.,",
  "Mui Wo  to Chi Ma Wan,Daily,12:00 noon,",
  "Central to Cheung Chau,Mondays to Saturdays except public holidays,25:60,",
].join("\n")
assert.deepEqual(parseSunTimetable(sunCsv, friday, false)[0]?.times, ["00:30", "19:40"])
assert.deepEqual(parseSunTimetable(sunCsv, saturday, false)[0]?.times, ["00:30", "19:30"])
assert.deepEqual(parseSunTimetable(sunCsv, friday, true)[0]?.times, ["23:55"])
assert.equal(parseSunTimetable(sunCsv, friday, true).find(row => row.route === "IICHCMUW")?.firstFerry, "06:00")
assert.equal(parseSunTimetable(sunCsv, saturday, false).find(row => row.route === "IIMUWCMW")?.firstFerry, "12:00")

const routes = [
  { id: 1, from: "hkkf-central", to: "hkkf-sok-kwu-wan", fromTc: "中環", fromEn: "Central", toTc: "索罟灣", toEn: "Sok Kwu Wan" },
  { id: 2, from: "hkkf-central", to: "hkkf-yung-shue-wan", fromTc: "中環", fromEn: "Central", toTc: "榕樹灣", toEn: "Yung Shue Wan" },
  { id: 3, from: "hkkf-central-6", to: "hkkf-peng-chau", fromTc: "中環", fromEn: "Central", toTc: "坪洲", toEn: "Peng Chau" },
]
const hkkfCsv = [
  "\uFEFFDirection,Service Date,Timetable,Remark",
  "Central to Yung Shue Wan,Mondays to Saturdays except public holidays,2:30 a.m.,1.0",
  "Central to Yung Shue Wan,Mondays to Saturdays except public holidays,6:30 a.m.,",
  "Central to Yung Shue Wan,Mondays to Saturdays except public holidays,11:30 p.m.,",
  "Central to Yung Shue Wan,Mondays to Saturdays except public holidays,12:30 a.m.,2.0",
  "Yung Shue Wan to Central,Mondays to Saturdays except public holidays,5:30 a.m.,",
  "Central to Peng Chau,Mondays to Saturdays except public holidays,12:30 a.m.,1",
  "Central to Sok Kwu Wan,Sundays and public holidays,12:50 p.m.,1.0",
  "Central to Sok Kwu Wan,Sundays and public holidays,1:50 p.m.,",
].join("\n")
const weekday = parseHkkfTimetable(hkkfCsv, friday, false, routes)
assert.deepEqual(weekday[0], { route: "2", pierId: "hkkf-central", destTc: "榕樹灣", destEn: "Yung Shue Wan", times: ["06:30", "23:30", "00:30"], nextDayTimes: ["00:30"], firstFerry: "06:30", lastFerry: "00:30" })
assert.equal(parseHkkfTimetable(hkkfCsv, saturday, false, routes)[0]?.firstFerry, "02:30")
assert.equal(weekday[1]?.pierId, "hkkf-yung-shue-wan")
assert.deepEqual(weekday[2]?.nextDayTimes, ["00:30"])
assert.deepEqual(parseHkkfTimetable(hkkfCsv, friday, true, routes)[0]?.times, ["13:50"])
