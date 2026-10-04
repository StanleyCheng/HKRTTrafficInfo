export type ListedStop = { tc: string; en: string; lng: number; lat: number }

export function catalogueAccepts(count: number, bundled: number): boolean {
  return count > 0 && count >= Math.floor(bundled * 0.9)
}

// A published stop list is one JSON document. A short or shapeless body is not a new network.
export function readStopList(payload: unknown, minimum: number): Record<string, ListedStop> | null {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return null
  const data = payload.data
  if (!Array.isArray(data)) return null
  const stops: Record<string, ListedStop> = {}
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue
    const record = row as Record<string, unknown>
    const id = text(record.stop)
    const lng = coordinate(record.long, 113, 115)
    const lat = coordinate(record.lat, 22, 23)
    if (!id || lng == null || lat == null) continue
    stops[id] = { tc: text(record.name_tc), en: text(record.name_en), lng, lat }
  }
  if (Object.keys(stops).length < minimum) return null
  return stops
}

function coordinate(value: unknown, low: number, high: number): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < low || parsed > high) return null
  return parsed
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
