export function arrivalPairs(
  stops: { id: string; routes: string[] }[],
  pairBudget: number,
): { stopId: string; route: string }[] {
  const pairs: { stopId: string; route: string }[] = []
  const seen = new Set<string>()
  const add = (stopId: string, route: string) => {
    const key = `${stopId}/${route}`
    if (seen.has(key) || pairs.length >= pairBudget) return
    seen.add(key)
    pairs.push({ stopId, route })
  }
  const closest = stops[0]
  if (closest) {
    for (const route of closest.routes.slice(0, 12)) add(closest.id, route)
  }
  const queues = stops.slice(1).map((stop) => ({ id: stop.id, routes: [...stop.routes] }))
  let added = true
  while (pairs.length < pairBudget && added) {
    added = false
    for (const queue of queues) {
      const route = queue.routes.shift()
      if (!route) continue
      add(queue.id, route)
      added = true
      if (pairs.length >= pairBudget) break
    }
  }
  return pairs
}
