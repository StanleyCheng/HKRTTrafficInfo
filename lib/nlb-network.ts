import networkFile from "../data/nlb-network.json" with { type: "json" }
import { inLantau } from "./lantau.ts"

type Service = { id: string; code: string }
type StopRecord = { tc: string; en: string; lng: number; lat: number; routes: string[]; services: Service[] }
type NetworkFile = { stops: Record<string, StopRecord> }

export type NlbStopPoint = { id: string; lng: number; lat: number; routes: string[] }

const network = networkFile as NetworkFile
const stopList: NlbStopPoint[] = []
for (const [id, stop] of Object.entries(network.stops)) {
  stopList.push({ id, lng: stop.lng, lat: stop.lat, routes: stop.routes })
}

export { inLantau }

export function nlbStop(id: string): StopRecord | null {
  return network.stops[id] ?? null
}

export function nearestNlbStops(lng: number, lat: number, limit: number): NlbStopPoint[] {
  if (!inLantau(lng, lat)) return []
  const cos = Math.cos((lat * Math.PI) / 180)
  return stopList
    .map((point) => {
      const east = (point.lng - lng) * cos * 111_320
      const north = (point.lat - lat) * 110_540
      return { point, distance: east * east + north * north }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.point)
}
