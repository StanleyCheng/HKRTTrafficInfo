// Greedy declutter for always-on bus stop labels. Pure and DOM-free: callers pass
// estimated label boxes in container pixels (see platePlacements in traffic-map.tsx)
// and get back the placement each visible stop should use. Each stop offers its
// candidate anchor positions in preference order; the first one that clears every
// already-placed label wins, so a stop that collides on the right can survive on
// the left. Placement is deterministic for a given input set: highest priority
// first, stop id as the pan/poll-stable tiebreak, candidate order as given.

export type StopLabelPlacement = {
  key: string
  x: number
  y: number
  w: number
  h: number
}

export type StopLabelItem = {
  id: string
  priority: number
  placements: StopLabelPlacement[]
}

export type StopLabelViewport = {
  x: number
  y: number
  w: number
  h: number
}

// Fixed estimates matching .stop-plate in globals.css: 10px/1.6 route lines, 9px/1.6
// title, 2px+2px padding and 1px+1px border. Width covers short titles and route
// lines without measuring the DOM.
export const STOP_LABEL_WIDTH = 150

export function stopLabelHeight(lines: number): number {
  return 21 + 16 * Math.min(Math.max(lines, 0), 4)
}

type Box = {
  x: number
  y: number
  w: number
  h: number
}

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const cell = 170

const cellRange = (box: Box): [number, number, number, number] => [
  Math.floor(box.x / cell),
  Math.floor((box.x + box.w) / cell),
  Math.floor(box.y / cell),
  Math.floor((box.y + box.h) / cell),
]

export function declutterLabels(items: StopLabelItem[], viewport?: StopLabelViewport): Map<string, string> {
  const ordered = [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const grid = new Map<string, Box[]>()
  const visible = new Map<string, string>()
  for (const item of ordered) {
    const options = viewport ? item.placements.filter(placement => intersects(placement, viewport)) : item.placements
    const chosen = options.find(placement => {
      const [x0, x1, y0, y1] = cellRange(placement)
      for (let gx = x0 - 1; gx <= x1 + 1; gx += 1) {
        for (let gy = y0 - 1; gy <= y1 + 1; gy += 1) {
          if (grid.get(`${gx}:${gy}`)?.some(other => intersects(other, placement))) return false
        }
      }
      return true
    })
    if (!chosen) continue
    visible.set(item.id, chosen.key)
    const [x0, x1, y0, y1] = cellRange(chosen)
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const key = `${gx}:${gy}`
        const list = grid.get(key)
        if (list) list.push(chosen)
        else grid.set(key, [chosen])
      }
    }
  }
  return visible
}
