import type { BusRouteSelection, BusRouteStop } from './bus-route.ts'
import { routeDistances } from './bus-route-motion.ts'
import { fetchUpstream } from './upstream.ts'

type Point = [number, number]
type Shape = { coordinates: Point[]; stopDistances: number[]; score: number }
const BUS = 'https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638844988873_41214/FeatureServer/0/query'
const GMB = 'https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1697082463580_57453/FeatureServer/0/query'
const metres = (a: Point, b: Point) => routeDistances([a, b])[1]

export function matchBusGeometry(paths: number[][][], stops: BusRouteStop[]): Shape | null {
  if (!stops.length || !Array.isArray(paths) || !paths.length) return null
  const coordinates: Point[] = []
  for (const path of paths) {
    if (!Array.isArray(path) || !path.length) return null
    for (const point of path) if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 113 || point[0] > 115 || point[1] < 22 || point[1] > 23) return null
    if (coordinates.length && metres(coordinates.at(-1)!, path[0] as Point) > 30) return null
    for (const point of path) coordinates.push([point[0], point[1]])
  }
  if (coordinates.length < 2 || coordinates.length > 100_000) return null
  const first: Point = [stops[0].lng, stops[0].lat]
  const last: Point = [stops.at(-1)!.lng, stops.at(-1)!.lat]
  const startError = metres(first, coordinates[0]), endError = metres(last, coordinates.at(-1)!)
  if (startError > 250 || endError > 250) return null
  const distances = routeDistances(coordinates)
  const stopDistances = [0]
  let score = startError + endError
  for (const stop of stops.slice(1, -1)) {
    let bestError = Infinity, bestDistance = 0
    const cos = Math.cos(stop.lat * Math.PI / 180)
    for (let index = 1; index < coordinates.length; index++) {
      if (distances[index] < stopDistances.at(-1)!) continue
      const a = coordinates[index - 1], b = coordinates[index]
      const x = (b[0] - a[0]) * cos, y = b[1] - a[1]
      const length = x * x + y * y
      const ratio = length ? Math.max(0, Math.min(1, (((stop.lng - a[0]) * cos) * x + (stop.lat - a[1]) * y) / length)) : 0
      const distance = distances[index - 1] + ratio * (distances[index] - distances[index - 1])
      if (distance < stopDistances.at(-1)!) continue
      const error = metres([stop.lng, stop.lat], [a[0] + ratio * (b[0] - a[0]), a[1] + ratio * (b[1] - a[1])])
      if (error < bestError) { bestError = error; bestDistance = distance }
    }
    if (bestError > 200) return null
    stopDistances.push(bestDistance)
    score += bestError
  }
  stopDistances.push(distances.at(-1)!)
  return { coordinates, stopDistances, score }
}

export async function busRoadGeometry(selection: BusRouteSelection, stops: BusRouteStop[]): Promise<Shape | null> {
  const gmb = selection.operator === 'gmb'
  const company = selection.operator === 'kmb' ? selection.company ?? 'KMB' : selection.operator === 'citybus' ? 'CTB' : 'NLB'
  const where = gmb ? `ROUTE_ID=${selection.routeId} AND ROUTE_SEQ=${selection.routeSeq}` : `ROUTE_NAMEE='${selection.route}' AND COMPANY_CODE LIKE '%${company}%'`
  const params = new URLSearchParams({ where, outFields: gmb ? 'ROUTE_ID,ROUTE_SEQ' : 'ROUTE_ID,ROUTE_SEQ,COMPANY_CODE,ROUTE_NAMEE', returnGeometry: 'true', outSR: '4326', f: 'json' })
  const response = await fetchUpstream(`${gmb ? GMB : BUS}?${params}`, 86_400_000, { timeoutMs: 6_000, headers: { Accept: 'application/json' } })
  if (response.status !== 200) return null
  const body = JSON.parse(new TextDecoder().decode(response.body)) as { exceededTransferLimit?: boolean; features?: { geometry?: { paths?: number[][][] } }[] }
  if (body.exceededTransferLimit || !Array.isArray(body.features)) return null
  // The CSDI direction numbering is independent of operator bounds. Match the whole ordered stop list.
  const candidates = body.features.map((feature) => matchBusGeometry(feature.geometry?.paths ?? [], stops)).filter((shape): shape is Shape => shape != null)
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0] ?? null
}
