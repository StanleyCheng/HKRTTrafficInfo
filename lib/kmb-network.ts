import networkFile from "../data/kmb-network.json" with { type: "json" }
import { nearestPoints } from "./nearest.ts"
import { catalogueAccepts } from "./stop-list.ts"

type StopRecord = { tc: string; en: string; lng: number; lat: number }
type NetworkFile = { stops: Record<string, StopRecord> }

export type KmbStopPoint = { id: string; lng: number; lat: number }

const network = networkFile as NetworkFile

const stopList: KmbStopPoint[] = []
for (const [id, stop] of Object.entries(network.stops)) {
  stopList.push({ id, lng: stop.lng, lat: stop.lat })
}
const bundledCount = stopList.length
let records: Record<string, StopRecord> = network.stops

export function kmbBundledStopCount(): number {
  return bundledCount
}

export function replaceKmbCatalogue(stops: Record<string, StopRecord>): boolean {
  const entries = Object.entries(stops)
  if (!catalogueAccepts(entries.length, bundledCount)) return false
  const nextRecords: Record<string, StopRecord> = {}
  const nextPoints: KmbStopPoint[] = []
  for (const [id, stop] of entries) {
    nextRecords[id] = { tc: stop.tc, en: stop.en, lng: stop.lng, lat: stop.lat }
    nextPoints.push({ id, lng: stop.lng, lat: stop.lat })
  }
  records = nextRecords
  stopList.length = 0
  stopList.push(...nextPoints)
  return true
}

export function kmbStop(id: string): StopRecord | null {
  return records[id] ?? null
}

export function nearestKmbStops(lng: number, lat: number, limit: number): KmbStopPoint[] {
  return nearestPoints(stopList, lng, lat, limit)
}

export function kmbStopsWithin(lng: number, lat: number, radiusMetres: number, limit: number): KmbStopPoint[] {
  const cos = Math.cos((lat * Math.PI) / 180)
  const ranked = stopList
    .map((point) => {
      const east = (point.lng - lng) * cos * 111_320
      const north = (point.lat - lat) * 110_540
      return { point, distance: Math.hypot(east, north) }
    })
    .filter((item) => item.distance <= radiusMetres)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
  return ranked.map((item) => item.point)
}
