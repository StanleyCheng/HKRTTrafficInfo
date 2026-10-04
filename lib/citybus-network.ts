import networkFile from "../data/citybus-network.json" with { type: "json" }
import { nearestPoints } from "./nearest.ts"

type StopRecord = { tc: string; en: string; lng: number; lat: number; routes: string[] }
type NetworkFile = { stops: Record<string, StopRecord> }

export type CitybusStopPoint = { id: string; lng: number; lat: number; routes: string[] }

const network = networkFile as NetworkFile

const stopList: CitybusStopPoint[] = []
for (const [id, stop] of Object.entries(network.stops)) {
  stopList.push({ id, lng: stop.lng, lat: stop.lat, routes: stop.routes })
}

export function citybusStop(id: string): StopRecord | null {
  return network.stops[id] ?? null
}

export function nearestCitybusStops(lng: number, lat: number, limit: number): CitybusStopPoint[] {
  return nearestPoints(stopList, lng, lat, limit)
}
