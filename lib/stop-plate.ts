export type StopPlate = {
  title: string
  lines: string[]
}

const PER_LINE = 3
const MAX_LINES = 4

export function stopPlate(name: string, routes: string[]): StopPlate {
  const seen = new Set<string>()
  const sorted: string[] = []
  for (const route of routes) {
    const trimmed = route.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    sorted.push(trimmed)
  }
  sorted.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const lines: string[] = []
  for (let index = 0; index < sorted.length && lines.length < MAX_LINES; index += PER_LINE) {
    lines.push(sorted.slice(index, index + PER_LINE).join(" "))
  }
  return { title: shortStopTitle(name), lines }
}

export function shortStopTitle(name: string): string {
  const level = name.match(/[上下]層/)
  if (level) return level[0]
  if (/upper level/i.test(name)) return "Upper"
  if (/lower level/i.test(name)) return "Lower"
  const head = name.split(/[,，]/)[0]?.trim() ?? ""
  return head.length > 18 ? `${head.slice(0, 17)}…` : head
}

export function stopPlateKey(plate: StopPlate): string {
  return `${plate.title}|${plate.lines.join("|")}`
}
