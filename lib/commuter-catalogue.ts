import buses from '../data/mtr-bus-network.json' with { type: 'json' }
import trams from '../data/tram-network.json' with { type: 'json' }
import access from '../data/accessible-stations.json' with { type: 'json' }
import taxis from '../data/taxi-stands.json' with { type: 'json' }
import source from '../data/commuter-sources.json' with { type: 'json' }
import { tramTrackPaths } from './tram-track-geometry.ts'
import type { Camera, CommuterKind, MapPath } from './traffic.ts'

export const commuterRetrievedAt = source.retrievedAt
export { metresBetween } from './nearest.ts'

export const mtrBusStops = buses.stops.map(stop => ({
  id: stop.STATION_ID, route: stop.ROUTE_ID, direction: stop.DIRECTION,
  reference: stop.REFERENCE_ID, seq: Number(stop.STATION_SEQNO),
  lat: Number(stop.STATION_LATITUDE), lng: Number(stop.STATION_LONGITUDE),
  tc: stop.STATION_NAME_CHI, en: stop.STATION_NAME_ENG,
})).filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))

export function mtrBusLineRef(reference: string, direction: string): string | undefined {
  const route = buses.routes.find(item => item.REFERENCE_ID === reference)
  return (direction === 'O' ? route?.LINE_UP : direction === 'I' ? route?.LINE_DOWN : undefined) || undefined
}

export function mtrBusDestination(lineRef: string): { tc: string; en: string } | null {
  const route = buses.routes.find(route => route.LINE_UP === lineRef || route.LINE_DOWN === lineRef)
  if (!route) return null
  const direction = route.LINE_UP === lineRef ? 'O' : 'I'
  const stops = mtrBusStops.filter(stop => stop.reference === route.REFERENCE_ID && stop.direction === direction)
  const last = stops.sort((a, b) => a.seq - b.seq).at(-1)
  return last ? { tc: last.tc, en: last.en } : null
}

export function commuterCatalogue(kind: CommuterKind): Camera[] {
  if (kind === 'mtr-bus') return [...new Map(mtrBusStops.map(stop => [stop.id, stop])).values()].map(stop => {
    const fare = buses.fares.find(fare => fare.REFERENCE_ID === stop.reference)
    const routes = [...new Set(mtrBusStops.filter(row => row.id === stop.id).map(row => row.route))]
    return { id: `mtr-bus-${stop.id}`, sourceId: stop.id, kind, name: stop.tc, nameEn: stop.en, lng: stop.lng, lat: stop.lat, routes, arrivals: [],
      rows: fare ? [{ label: '成人八達通全程車費', labelEn: 'Adult Octopus full fare', value: `HK$${fare.FARE_OCTO_ADULT}` }] : [],
    }
  })
  if (kind === 'tram') return trams.stops.map(stop => ({
    id: `tram-${stop.id}`, sourceId: stop.id, kind, name: stop.tc, nameEn: stop.en, lng: stop.lng, lat: stop.lat,
    routes: stop.routes,
    rows: trams.routes.filter(route => stop.routes.includes(route.routeId) && route.id.endsWith('-1')).map(route => ({ label: route.tc, labelEn: route.en, value: `HK$${route.fare.toFixed(1)}` })),
    information: { en: 'Arrival estimates from Hong Kong Tramways. Track routes use OpenStreetMap data matched to published stops and may not reflect diversions.', zh: '到站時間由香港電車提供。軌道路線採用與公布車站配對的 OpenStreetMap 資料，未必反映改道情況。' },
  }))
  if (kind === 'access') return access.map(station => ({
    id: `access-${station.id}`, sourceId: station.id, kind, name: station.tc, nameEn: station.en, lng: station.lng, lat: station.lat,
    rows: station.facilities.map(facility => ({ label: facility.tc, labelEn: facility.en, value: facility.exitTc || '已公布設施', valueEn: facility.exitEn || 'Published facility' })),
    information: { en: 'Station position, with published exit and facility descriptions. Lift operation and a complete step-free journey are not confirmed. Zoom in for published pedestrian connections.', zh: '標記位於車站，附已公布出口及設施說明。資料不代表升降機現時運作，亦不保證全程無梯級。放大可查看已公布行人連接。' },
  }))
  return taxis.map(stand => ({
    id: `taxi-${stand.id}`, sourceId: stand.id, kind, name: stand.tc, nameEn: stand.en, lng: stand.lng, lat: stand.lat,
    district: stand.districtTc, districtEn: stand.districtEn,
    rows: [{ label: '的士站類型', labelEn: 'Stand type', value: stand.typeTc, valueEn: stand.typeEn }],
    information: { en: 'Published taxi stand location. Taxi availability and queue length are unknown.', zh: '已公布的士站位置。資料不包括現時可用的士或輪候人數。' },
  }))
}

export function tramPaths(): MapPath[] {
  return tramTrackPaths()
}
