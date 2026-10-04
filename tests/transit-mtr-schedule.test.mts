import assert from "node:assert/strict"
import test from "node:test"
import { readSchedule, parseHongKongTime } from "../lib/mtr-schedule.ts"
import { fortuneDepartureTimes } from "../lib/fortune-timetable.ts"

test("MTR schedules retain platform, delay, departure clocks and reject invalid rows", () => {
  const parsed = readSchedule({ isdelay: "Y", message: "successful", data: { "TWL-CEN": {
    curr_time: "2026-10-03 12:00:00", UP: [
      { dest: "TSW", ttnt: "3", plat: "1", timeType: "D" },
      { dest: "TSW", ttnt: "2", valid: "N" },
      { dest: "TSW", ttnt: "-1" },
    ],
  } } }, "TWL", "CEN")
  assert.equal(parsed?.board.trains.length, 1)
  assert.deepEqual(parsed?.board.trains[0], { dest: "TSW", ttnt: 3, plat: "1", delay: true, timeType: "D" })
  assert.equal(parsed?.observations[0]?.dueAt, Date.parse("2026-10-03T12:03:00+08:00"))
  assert.equal(parsed?.board.message, "")
  assert.equal(parsed?.board.observedAt, "2026-10-03T04:00:00.000Z")
  assert.equal(parseHongKongTime("2026-10-03 12:00:00"), Date.parse("2026-10-03T04:00:00Z"))
  assert.equal(readSchedule({}, "TWL", "CEN"), null)
  assert.equal(parseHongKongTime("not a clock"), null)
})

test("MTR timestamp fallback is used only when published station clock is missing", () => {
  const now = Date.parse("2026-10-03T04:10:00Z")
  const board = { UP: [{ dest: "TSW", ttnt: "3", plat: "1" }] }
  const missingClock = readSchedule({ data: { "TWL-CEN": board } }, "TWL", "CEN", now)
  assert.equal(missingClock?.board.observedAt, new Date(now).toISOString())
  const publishedClock = readSchedule({ data: { "TWL-CEN": { ...board, curr_time: "2026-10-03 12:00:00" } } }, "TWL", "CEN", now)
  assert.equal(publishedClock?.board.observedAt, "2026-10-03T04:00:00.000Z")
})

test("Fortune timetable fails visibly when HTML has zero valid clocks", () => {
  assert.throws(() => fortuneDepartureTimes("<html>Service temporarily unavailable</html>"), /no valid departure clocks/)
  assert.throws(() => fortuneDepartureTimes('<td class="time">25:78</td>'), /no valid departure clocks/)
  assert.deepEqual(fortuneDepartureTimes('<td class="time">00:00</td>'), ["00:00"])
})
