// Optional live audit: node --experimental-strip-types scripts/audit-citybus-coverage.mjs [output.json]
// Queries the public Citybus and TD feeds. Three workers and a per-request pause
// bound load; failures and incomplete data are reported rather than counted as missing routes.
import fs from 'node:fs/promises'
import { matchBusGeometry, matchCitybusOfficialGeometry } from '../lib/bus-route-geometry.ts'
import { citybusOsmGeometry, sameCitybusAlignment } from '../lib/citybus-osm-geometry.ts'

const ctb = 'https://rt.data.gov.hk/v2/transport/citybus'
const td = 'https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638844988873_41214/FeatureServer/0/query'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await delay(300)
      const response = await fetch(url, { signal: AbortSignal.timeout(25_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const value = await response.json()
      if (value.error) throw new Error('Source returned an error envelope')
      return value
    } catch (error) {
      if (attempt === 2) throw error
      await delay((attempt + 1) * 1000)
    }
  }
}
async function pool(items, worker) {
  let next = 0
  const output = Array(items.length)
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < items.length) {
      const index = next++
      try { output[index] = await worker(items[index]) } catch { output[index] = null }
    }
  }))
  return output
}
const url = params => `${td}?${new URLSearchParams(params)}`
const routeList = await get(`${ctb}/route/CTB`)
if (!Array.isArray(routeList.data)) throw new Error('Citybus route list unavailable')
const codes = [...new Set(routeList.data.map(row => row.route).filter(code => typeof code === 'string'))].sort()
const where = "COMPANY_CODE LIKE '%CTB%'"
const countResponse = await get(url({ where, returnCountOnly: 'true', f: 'json' }))
if (!Number.isInteger(countResponse.count)) throw new Error('TD route count unavailable')
const offsets = Array.from({ length: Math.ceil(countResponse.count / 50) }, (_, i) => i * 50)
const pages = await pool(offsets, async offset => {
  const data = await get(url({ where, outFields: 'OBJECTID,ROUTE_ID,ROUTE_SEQ,COMPANY_CODE,ROUTE_NAMEE', returnGeometry: 'true', outSR: '4326', f: 'json', resultOffset: String(offset), resultRecordCount: '50', orderByFields: 'OBJECTID' }))
  if (!Array.isArray(data.features)) throw new Error('TD geometry page unavailable')
  return data.features
})
if (pages.some(page => page === null)) throw new Error('TD geometry pages incomplete; audit stopped')
const features = pages.flat()
if (features.length !== countResponse.count || new Set(features.map(feature => feature.attributes?.OBJECTID)).size !== features.length) throw new Error('TD geometry pages contain missing or duplicated records')
const geometry = new Map()
for (const feature of features) {
  const code = feature.attributes?.ROUTE_NAMEE
  if (typeof code !== 'string') continue
  geometry.set(code, [...(geometry.get(code) ?? []), feature.geometry?.paths ?? []])
}
const lookups = codes.flatMap(code => ['outbound', 'inbound'].map(direction => ({ code, direction })))
const stopLists = await pool(lookups, async ({ code, direction }) => {
  const result = await get(`${ctb}/route-stop/CTB/${encodeURIComponent(code)}/${direction}`)
  if (!Array.isArray(result.data)) throw new Error('Stop list unavailable')
  return result.data
})
const database = JSON.parse(await fs.readFile(new URL('../data/citybus-network.json', import.meta.url), 'utf8')).stops
const missing = [...new Set(stopLists.flatMap(rows => (rows ?? []).map(row => row.stop).filter(id => typeof id === 'string' && !database[id])))]
const extras = await pool(missing, async id => {
  const result = await get(`${ctb}/stop/${encodeURIComponent(id)}`)
  if (!result.data || !Number.isFinite(Number(result.data.long)) || !Number.isFinite(Number(result.data.lat))) throw new Error('Stop unavailable')
  return { tc: result.data.name_tc ?? '', en: result.data.name_en ?? '', lng: Number(result.data.long), lat: Number(result.data.lat) }
})
missing.forEach((id, index) => { if (extras[index]) database[id] = extras[index] })
const same = candidates => candidates.length > 0 && candidates.every(candidate => sameCitybusAlignment(candidates[0].coordinates, candidate.coordinates))
const results = []
for (let index = 0; index < lookups.length; index++) {
  const { code, direction } = lookups[index], rows = stopLists[index]
  const entry = { route: code, direction }
  if (rows === null) { results.push({ ...entry, status: 'stop-request-failed' }); continue }
  if (rows.length < 2) { results.push({ ...entry, status: 'fewer-than-two-stops' }); continue }
  if (rows.some(row => !database[row.stop])) { results.push({ ...entry, status: 'stop-coordinate-unavailable' }); continue }
  const stops = rows.map(row => ({ id: row.stop, seq: Number(row.seq), ...database[row.stop], nameTc: database[row.stop].tc, nameEn: database[row.stop].en, distance: 0 })).sort((a, b) => a.seq - b.seq)
  if (stops.some((stop, i) => stop.seq !== i + 1 || !Number.isFinite(stop.lng) || !Number.isFinite(stop.lat))) { results.push({ ...entry, status: 'invalid-stop-sequence' }); continue }
  const paths = geometry.get(code) ?? []
  const oldMatches = paths.map(path => matchBusGeometry(path, stops, { endpoint: 65, intermediate: 65, gap: 2 })).filter(Boolean)
  const newMatches = paths.map(path => matchCitybusOfficialGeometry(path, stops)).filter(Boolean)
  const oldOfficial = same(oldMatches), official = same(newMatches)
  const osm = !official && Boolean(await citybusOsmGeometry({ operator: 'citybus', route: code, bound: direction === 'inbound' ? 'I' : 'O', stopId: stops[0].id }, stops))
  results.push({ ...entry, status: official ? 'official' : osm ? 'osm' : 'unmatched', oldOfficial })
}
const counts = Object.groupBy(results, result => result.status)
const output = { generatedAt: new Date().toISOString(), routeListTimestamp: routeList.generated_timestamp ?? null, routeCount: codes.length, tdGeometryCount: features.length, missingStopLookups: missing.length, counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.length])), oldOfficial: results.filter(result => result.oldOfficial).length, results }
if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ ...output, results: undefined }, null, 2))
