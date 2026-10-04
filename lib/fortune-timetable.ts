import { ferryMinutes } from "./ferry-clock.ts"

// Departure clocks printed on the Fortune Ferry route page for one date.
// The Transport Department CSV for this route is the 2020 file, and it no longer matches the company page.
export function fortuneDepartureTimes(html: string): string[] {
  const times: string[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/class="time">\s*(\d{2}:\d{2})\s*</g)) {
    const time = match[1]
    if (!time || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || seen.has(time)) continue
    seen.add(time)
    times.push(time)
  }
  if (times.length === 0) throw new Error("Fortune Ferry timetable contains no valid departure clocks")
  return times
}

export function nextFortuneDepartures(times: string[], now: number, limit = 2): string[] {
  const coming = times.filter((time) => ferryMinutes(time, now) != null)
  return coming.slice(0, limit)
}
