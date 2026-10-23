import type { Camera, MapPath } from './traffic.ts'

const endpoint = 'https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637222018065_52265/FeatureServer/0/query'
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value : ''
export function pedestrianUrl(lng: number, lat: number): string {
  const x = Math.round(lng * 1000) / 1000, y = Math.round(lat * 1000) / 1000
  const query = new URLSearchParams({ f: 'geojson', where: 'Enabled=1', geometry: `${x - .004},${y - .003},${x + .004},${y + .003}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,StreetNameEN,StreetNameTC,WheelchairAccess,WheelchairBarrier,FeatureType,Enabled', outSR: '4326', resultRecordCount: '1000' })
  return `${endpoint}?${query}`
}
export function parsePedestrian(payload: unknown): { paths: MapPath[]; cameras: Camera[]; complete: boolean } {
  if (!record(payload) || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Pedestrian network shape unavailable')
  const paths: MapPath[] = [], cameras: Camera[] = []
  for (const feature of payload.features) {
    if (!record(feature) || !record(feature.geometry) || !record(feature.properties)) throw new Error('Pedestrian feature shape unavailable')
    const geometry = feature.geometry, p = feature.properties
    if (p.Enabled !== 1) continue
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates) ? geometry.coordinates : []
    const accessible = p.WheelchairAccess === 1 && p.WheelchairBarrier === 2
    const blocked = p.WheelchairAccess === 2 || p.WheelchairBarrier === 1
    const color = accessible ? '#137f87' : blocked ? '#b76c28' : '#8a9aa5'
    for (const [i, line] of lines.entries()) {
      if (!Array.isArray(line) || line.length < 2 || line.some(point => !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 113.8 || point[0] > 114.5 || point[1] < 22.1 || point[1] > 22.6)) continue
      const points: [number, number][] = line.map(point => [point[1], point[0]])
      paths.push({ id: `walk-${p.OBJECTID}-${i}`, color, points })
      // Only lifts, ramps and steps need individual detail markers. Ordinary
      // footways stay as lines so a local network does not swamp the map.
      const names: Record<number, [string, string]> = { 10: ['升降機', 'Lift'], 11: ['斜道', 'Ramp'], 12: ['樓梯', 'Steps'], 13: ['樓梯升降台', 'Stairlift'], 18: ['升降機', 'Lift'], 19: ['斜道', 'Ramp'], 20: ['樓梯', 'Steps'], 21: ['樓梯升降台', 'Stairlift'] }
      const name = names[Number(p.FeatureType)]
      if (name) {
        const [lat, lng] = points[Math.floor(points.length / 2)]
        cameras.push({ id: `access-walk-${p.OBJECTID}-${i}`, sourceId: String(p.OBJECTID), kind: 'access', lat, lng,
          name: `${name[0]}${text(p.StreetNameTC) ? ` · ${text(p.StreetNameTC)}` : ''}`, nameEn: `${name[1]}${text(p.StreetNameEN) ? ` · ${text(p.StreetNameEN)}` : ''}`, color,
          rows: [{ label: '已公布輪椅通道', labelEn: 'Published wheelchair access', value: accessible ? '可通行' : blocked ? '設有障礙或未能通行' : '未分類', valueEn: accessible ? 'Accessible' : blocked ? 'Barrier or inaccessible' : 'Unclassified' }],
          information: { en: 'Published infrastructure, without live operating status. Teal paths indicate published wheelchair access without a recorded barrier; amber indicates a barrier or no wheelchair access; grey is unclassified. This is not a complete accessible route.', zh: '已公布設施，並非實時運作狀態。青色路段表示已公布可供輪椅通行且無記錄障礙；琥珀色表示有障礙或輪椅未能通行；灰色表示未分類。此資料並非完整無障礙路線。' },
        })
      }
    }
  }
  return { paths, cameras, complete: !payload.exceededTransferLimit && payload.features.length < 1000 }
}
