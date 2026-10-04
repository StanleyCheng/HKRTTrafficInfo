export function readRouteStopList(payload: unknown, minimumStops: number): Record<string, string[]> | null {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return null
  const data = payload.data
  if (!Array.isArray(data)) return null
  const grouped = new Map<string, Set<string>>()
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue
    const record = row as Record<string, unknown>
    const stop = text(record.stop)
    const route = text(record.route)
    if (!stop || !route) continue
    const routes = grouped.get(stop) ?? new Set<string>()
    routes.add(route)
    grouped.set(stop, routes)
  }
  if (grouped.size < minimumStops) return null
  const stops: Record<string, string[]> = {}
  for (const [stop, routes] of grouped) {
    stops[stop] = [...routes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }
  return stops
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function routesWithoutArrival(routes: readonly string[], arrived: readonly string[]): string[] {
  const seen = new Set(arrived.map((route) => route.trim()).filter(Boolean))
  const pending: string[] = []
  const listed = new Set<string>()
  for (const route of routes) {
    const trimmed = route.trim()
    if (!trimmed || seen.has(trimmed) || listed.has(trimmed)) continue
    listed.add(trimmed)
    pending.push(trimmed)
  }
  pending.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return pending
}
