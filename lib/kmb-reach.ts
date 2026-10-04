const STOP_CAP = 40
const MIN_RADIUS_M = 220
const MAX_RADIUS_M = 650

export { STOP_CAP }

export function kmbReachMetres(zoom: number, lat: number): number {
  if (!Number.isFinite(zoom)) return 450
  const metresPerPixel = (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, metresPerPixel * 340))
}

export function kmbCacheKey(lng: number, lat: number, zoom: number): string {
  return `${lng.toFixed(3)},${lat.toFixed(3)},${Math.round(kmbReachMetres(zoom, lat) / 50)}`
}

export function isListedKmbRow(row: { eta_seq?: number; route?: string }): boolean {
  return row.eta_seq === 1 && Boolean(row.route?.trim())
}
