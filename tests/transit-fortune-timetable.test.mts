import assert from "node:assert/strict"
import { fortuneDepartureTimes, nextFortuneDepartures } from "../lib/fortune-timetable.ts"

const page = `
<h2>班次到達碼頭時間 : 16:57</h2>
<table id="schedule-table">
<tr><td class="time">08:00</td><td class="time"><p>成人 HKD 8.3</p></td></tr>
<tr><td class="time">16:00</td><td class="time"><p>成人 HKD 8.3</p></td></tr>
<tr><td class="time">17:00</td><td class="time"><p>成人 HKD 8.3</p></td></tr>
<tr><td class="time">19:00</td><td class="time"><p>成人 HKD 8.3</p></td></tr>
</table>
`

assert.deepEqual(fortuneDepartureTimes(page), ["08:00", "16:00", "17:00", "19:00"])
assert.equal(fortuneDepartureTimes(page).includes("16:57"), false)

const afternoon = Date.parse("2026-10-03T16:05:00+08:00")
assert.deepEqual(nextFortuneDepartures(fortuneDepartureTimes(page), afternoon), ["17:00", "19:00"])
assert.deepEqual(nextFortuneDepartures(["08:00"], afternoon), [])
