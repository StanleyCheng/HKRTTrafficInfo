import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFerrySnapshot } from '../lib/ferry-feed.ts'

test('maintenance pages leave the raw ferry cache before the daily parsed timetable lifetime', async (t) => {
  const originalFetch = globalThis.fetch
  let now = Date.parse('2026-10-23T04:00:00Z'), phase = 0, timetableCalls = 0
  t.mock.method(Date, 'now', () => now)
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('1823.gov.hk')) return Response.json({ vcalendar: [{ vevent: [{ dtstart: ['20261001'] }] }] })
    if (url.includes('SunFerry_central_cheungchau_timetable_eng.csv')) {
      timetableCalls++
      return new Response(phase === 0 ? '<html>Maintenance</html>' : 'Direction,Service Date,Service Hour,Remark\nCentral to Cheung Chau,Mondays to Saturdays except public holidays,12:30 p.m.,', { headers: { 'Content-Type': 'text/csv' } })
    }
    if (url.includes('fortuneferry')) return new Response('<td class="time">12:15</td>')
    if (url.includes('starferry')) return new Response('Central to Tsim Sha Tsui,Mon – Sun,7:00am-11:00pm,8')
    return Response.json({ data: [] })
  }
  try {
    await loadFerrySnapshot(now)
    assert.equal(timetableCalls, 1)
    phase = 1; now += 60_001
    const recovered = await loadFerrySnapshot(now)
    assert.equal(timetableCalls, 2, 'A retry reaches the recovered wire source instead of the cached maintenance bytes')
    assert.ok(recovered.piers.find(pier => pier.id === 'sun-central-5')?.calls.length || recovered.piers.some(pier => pier.calls.some(call => call.destEn === 'Cheung Chau')), 'The recovered published sailing is available')
    now += 60_001
    await loadFerrySnapshot(now)
    assert.equal(timetableCalls, 2, 'The validated parsed timetable keeps its daily lifetime')
  } finally { globalThis.fetch = originalFetch }
})
