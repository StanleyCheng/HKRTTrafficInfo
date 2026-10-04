export const KMB_MIN_ZOOM = 13
// Green minibuses stay at the nearest 24. That circle still holds more than 24 until the map is this close.
export const GMB_MIN_ZOOM = 17
export const KMB_POLL_MS = 60_000
export const PLACE_POLL_MS = 12 * 60 * 60 * 1000

export function kmbViewKey(lng: number, lat: number, zoom: number): string {
  if (zoom < KMB_MIN_ZOOM) return "far"
  return `${lng.toFixed(3)},${lat.toFixed(3)}`
}
