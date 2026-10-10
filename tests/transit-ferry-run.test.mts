import assert from "node:assert/strict"
const { estimateFerryVessels, ferryMotionPoint, placeFerry, syncFerryMotion } = await import("../lib/ferry-run.ts")

const from = { lng: 114, lat: 22 }
const to = { lng: 114.1, lat: 22 }
const now = Date.parse("2026-10-03T10:00:00+08:00")

const halfway = placeFerry(from, to, now - 10 * 60_000, now + 10 * 60_000, now)
assert.ok(halfway)
assert.ok(Math.abs(halfway.lng - 114.05) < 0.001)
assert.equal(halfway.minutes, 10)

const waiting = placeFerry(from, to, now + 12 * 60_000, null, now)
assert.equal(waiting?.lng, from.lng)
assert.equal(waiting?.lat, from.lat)
assert.equal(placeFerry(from, to, now + 50 * 60_000, null, now), null)

const done = placeFerry(from, to, now - 30 * 60_000, now - 5 * 60_000, now)
assert.equal(done, null)

const locate = (id: string) => (id === "a" ? from : id === "b" ? to : null)
const track = {
  route: "1",
  fromId: "a",
  toId: "b",
  fromTc: "甲",
  fromEn: "A",
  toTc: "乙",
  toEn: "B",
  destTc: "乙",
}
const sailing = estimateFerryVessels(
  [track],
  [
    { route: "1", pierId: "a", arriving: false, eta: "2026-10-03T09:50:00+08:00", destTc: "乙" },
    { route: "1", pierId: "b", arriving: true, eta: "2026-10-03T10:10:00+08:00", destTc: "乙" },
  ],
  new Set(),
  locate,
  now,
)
assert.equal(sailing.length, 1)
assert.equal(sailing[0]?.nameTc, "甲 – 乙")
assert.ok(Math.abs((sailing[0]?.lng ?? 0) - 114.05) < 0.001)

const kept = estimateFerryVessels([track], [], new Set(["1"]), locate, now)
assert.equal(kept.length, 0)

const scheduled = estimateFerryVessels([{ ...track, crossingMinutes: 9 }], [
  { route: "1", pierId: "a", arriving: false, eta: "2026-10-03T09:55:00+08:00", destTc: "乙" },
  { route: "1", pierId: "a", arriving: false, eta: "2026-10-03T10:02:00+08:00", destTc: "乙" },
], new Set(), locate, now)
assert.equal(scheduled[0]?.departAt, now - 5 * 60_000)
assert.equal(scheduled[0]?.arriveAt, now + 4 * 60_000)
assert.ok((scheduled[0]?.lng ?? 0) > from.lng)
const scheduledMotion = syncFerryMotion([], scheduled, now)[0]!
assert.ok(ferryMotionPoint(scheduledMotion, now + 60_000)!.lng > ferryMotionPoint(scheduledMotion, now)!.lng)
const nextSailing = estimateFerryVessels([{ ...track, crossingMinutes: 9 }], [
  { route: "1", pierId: "a", arriving: false, eta: "2026-10-03T09:55:00+08:00", destTc: "乙" },
  { route: "1", pierId: "a", arriving: false, eta: "2026-10-03T10:02:00+08:00", destTc: "乙" },
], new Set(), locate, now + 2 * 60_000)
assert.notEqual(nextSailing[0]?.id, scheduled[0]?.id, "A new sailing must not move the previous boat back to its origin")

const nextOnly = estimateFerryVessels(
  [{ ...track, route: "富裕", toId: "", toTc: "啟德", toEn: "Kai Tak", destTc: "啟德" }],
  [
    { route: "富裕", pierId: "a", arriving: false, eta: "2026-10-03T10:10:00+08:00", destTc: "啟德" },
    { route: "富裕", pierId: "a", arriving: false, eta: "2026-10-03T11:10:00+08:00", destTc: "啟德" },
  ],
  new Set(),
  locate,
  now,
)
assert.equal(nextOnly.length, 1)
assert.equal(nextOnly[0]?.lng, from.lng)
assert.equal(nextOnly[0]?.minutes, 10)

const gps = {
  id: "CECC-1",
  fix: "gps" as const,
  nameTc: "中環 – 長洲",
  nameEn: "Central – Cheung Chau",
  lng: 114.1,
  lat: 22.2,
  route: "CECC",
  eta: "",
  minutes: 10,
  destTc: "長洲",
  destEn: "Cheung Chau",
}
const first = syncFerryMotion([], [gps], now)
const atFix = ferryMotionPoint(first[0], now)
assert.equal(atFix?.lng, 114.1)
assert.equal(atFix?.lat, 22.2)
const moved = syncFerryMotion(first, [{ ...gps, lng: 114.11 }], now + 60_000)
const atGps = ferryMotionPoint(moved[0], now + 60_000)
assert.equal(atGps?.lng, 114.11)
const coast = ferryMotionPoint(moved[0], now + 90_000)
assert.ok(coast)
assert.ok(coast.lng > 114.11)
assert.ok(coast.lng < 114.12)

const clock = syncFerryMotion([], [{
  id: "run-1-a",
  fix: "clock",
  nameTc: "甲 – 乙",
  nameEn: "A – B",
  lng: 114.05,
  lat: 22,
  route: "1",
  eta: "",
  minutes: 10,
  destTc: "乙",
  destEn: "B",
  fromLng: from.lng,
  fromLat: from.lat,
  toLng: to.lng,
  toLat: to.lat,
  departAt: now - 10 * 60_000,
  arriveAt: now + 10 * 60_000,
}], now)
const early = ferryMotionPoint(clock[0], now)
const later = ferryMotionPoint(clock[0], now + 60_000)
assert.ok(early && later)
assert.ok(later.lng > early.lng)
assert.ok(later.lng < to.lng)

console.log("ferry run ok")
