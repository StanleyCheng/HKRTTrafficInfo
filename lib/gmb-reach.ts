import networkFile from "../data/gmb-network.json" with { type: "json" }

type StopRecord = {
  tc: string
  en: string
  lng: number
  lat: number
  routes: string[]
  ids: Record<string, string>
}

type NetworkFile = { stops: Record<string, StopRecord> }

export type GmbStopPoint = { id: string; lng: number; lat: number; routes: string[] }

const network = networkFile as NetworkFile
const stopList: GmbStopPoint[] = []
for (const [id, stop] of Object.entries(network.stops)) {
  if (!Number.isFinite(stop.lng) || !Number.isFinite(stop.lat)) continue
  stopList.push({ id, lng: stop.lng, lat: stop.lat, routes: stop.routes ?? [] })
}

export function gmbStop(id: string): StopRecord | null {
  return network.stops[id] ?? null
}

export function gmbStopsWithin(lng: number, lat: number, radiusMetres: number, limit: number): GmbStopPoint[] {
  const cos = Math.cos((lat * Math.PI) / 180)
  return stopList
    .map((point) => {
      const east = (point.lng - lng) * cos * 111_320
      const north = (point.lat - lat) * 110_540
      return { point, distance: Math.hypot(east, north) }
    })
    .filter((item) => item.distance <= radiusMetres)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.point)
}
