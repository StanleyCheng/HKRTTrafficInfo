// Each refresh has room for a few station calls. Take one waiting station from
// every line before any line gets a second, and give the spare calls to the
// lines with the most stations still waiting. A line at the end of the list,
// such as Tsuen Wan, is then read on the first pass.
export function fairLineReads<T extends { line: string }>(
  items: readonly T[],
  fetchedAt: (item: T) => number | null,
  now: number,
  staleMs: number,
  limit: number,
): T[] {
  if (limit <= 0) return []
  const dueByLine = new Map<string, T[]>()
  const lineOrder: string[] = []
  for (const item of items) {
    const at = fetchedAt(item)
    if (at != null && now - at < staleMs) continue
    const list = dueByLine.get(item.line)
    if (list) list.push(item)
    else {
      lineOrder.push(item.line)
      dueByLine.set(item.line, [item])
    }
  }
  for (const list of dueByLine.values()) {
    list.sort((left, right) => (fetchedAt(left) ?? -1) - (fetchedAt(right) ?? -1))
  }
  const lines = [...lineOrder].sort((left, right) => {
    const waiting = (dueByLine.get(right)?.length ?? 0) - (dueByLine.get(left)?.length ?? 0)
    return waiting || lineOrder.indexOf(left) - lineOrder.indexOf(right)
  })
  const chosen: T[] = []
  while (chosen.length < limit) {
    let took = false
    for (const line of lines) {
      if (chosen.length >= limit) break
      const next = dueByLine.get(line)?.shift()
      if (!next) continue
      chosen.push(next)
      took = true
    }
    if (!took) break
  }
  return chosen
}

export function oldestDue<T>(
  items: readonly T[],
  fetchedAt: (item: T) => number | null,
  now: number,
  staleMs: number,
  limit: number,
): T[] {
  const due: T[] = []
  for (const item of items) {
    const at = fetchedAt(item)
    if (at == null || now - at >= staleMs) due.push(item)
  }
  due.sort((left, right) => (fetchedAt(left) ?? 0) - (fetchedAt(right) ?? 0))
  return due.slice(0, Math.max(0, limit))
}
