// Download current OSM route relations once; the app uses only checked-in geometry.
// Rebuild from the acquisition cache with: node scripts/generate-rail-geometry.mjs
// Explicitly refresh that cache with: node scripts/generate-rail-geometry.mjs --refresh
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const cache = resolve(root, "outputs/rail-osm")
const sources = {
  AEL: [5317238, 5317239], DRL: [4709540, 4709541],
  EAL: [4248590, 4248592, 4248589, 4248591, 4250433, 4250435],
  ISL: [4432665, 4432666], KTL: [272125, 6452935],
  SIL: [6827211, 6827212], TCL: [5317704, 5317706],
  TKL: [9736611, 269672, 9736602, 9736610], TML: [6102298, 6102299],
  TWL: [269669, 9736530],
  "505": [3515354, 6481282], "507": [6481316, 3679916],
  "610": [6481420, 3680161], "614": [3680323, 6485194],
  "614P": [5955256, 5955257], "615": [3680520, 6481434],
  "615P": [5955258, 5955259], "705": [2941692], "706": [2941790],
  "751": [2926506, 6485218], "751P": [2929802, 6485219],
  "761P": [6485221, 2942633],
}
const load = async (path) => JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""))
const network = await load(resolve(root, "data/mtr-network.json"))
const lightRail = await load(resolve(root, "data/light-rail-routes.json"))
const lrtStations = (await load(resolve(root, "data/light-rail-stations.json"))).stations
const previousSnapshot = await load(resolve(root, "data/rail-geometry.json")).catch((error) => {
  if (error.code === "ENOENT") return null
  throw error
})
let retrievedAt = previousSnapshot?.source.retrievedAt ?? new Date().toISOString().slice(0, 10)
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 102_900, (a[1] - b[1]) * 111_200)
const point = (node) => [node.lon, node.lat]
const mtrNames = new Map(Object.entries(network.stations).map(([id, station]) => [station.en.toLowerCase(), id]))
const lrtNames = new Map([
  ...lrtStations.map((station) => [station.en.toLowerCase(), station.id]),
  ["locwood", "448"],
])

await mkdir(cache, { recursive: true })
const graphs = new Map()
const provenance = []
for (const [line, ids] of Object.entries(sources)) {
  const routes = []
  for (const id of ids) {
    const file = resolve(cache, `${id}.json`)
    let data
    if (!process.argv.includes("--refresh")) {
      try { data = await load(file) } catch (error) { if (error.code !== "ENOENT") throw error }
    }
    if (!data) {
      const response = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`, {
        headers: { "User-Agent": "HKRTTrafficInfo/rail-geometry (OpenStreetMap attribution included)" },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`OSM relation ${id}: HTTP ${response.status}`)
      data = await response.json()
      retrievedAt = new Date().toISOString().slice(0, 10)
      await writeFile(file, JSON.stringify(data))
    }
    const relation = data.elements.find((item) => item.type === "relation" && item.id === id)
    if (!relation || relation.tags.type !== "route") throw new Error(`Missing route ${id}`)
    const nodes = new Map(data.elements.filter((item) => item.type === "node").map((item) => [item.id, item]))
    const ways = new Map(data.elements.filter((item) => item.type === "way").map((item) => [item.id, item]))
    const members = relation.members.filter((member) => member.type === "way" && !member.role.includes("platform"))
      .map((member) => ({ member, way: ways.get(member.ref) }))
      .filter(({ way }) => ["subway", "rail", "light_rail"].includes(way?.tags?.railway))
    const stops = relation.members.filter((member) => member.type === "node" && member.role.startsWith("stop"))
      .map((member) => nodes.get(member.ref)).filter(Boolean)
    const names = /^\d/.test(line) ? lrtNames : mtrNames
    const stopCode = (node) => names.get(node.tags?.["name:en"]?.toLowerCase())
      ?? (/^\d+$/.test(node.tags?.ref ?? "") ? String(Number(node.tags.ref)) : node.tags?.ref)
    const stopList = stops.map((node) => ({ code: stopCode(node), node: node.id }))
    // Official MTR sequences now include the reprovisioned Tin Wing platform on northbound 751/751P.
    if ([6485218, 6485219].includes(id)) {
      stopList.splice(stopList.findIndex((stop) => stop.code === "455") + 1, 0, { code: "500", node: 4788509628 })
    }
    // MTR's published 614P service reaches the existing on-track Ferry Pier stop beyond Siu Hei.
    if (id === 5955256) stopList.push({ code: "1", node: 1723162796 })
    const adjacency = new Map()
    const add = (from, to) => {
      const neighbours = adjacency.get(from) ?? []
      neighbours.push({ node: to, length: metres(point(nodes.get(from)), point(nodes.get(to))) })
      adjacency.set(from, neighbours)
    }
    for (let index = 0; index < members.length; index += 1) {
      const { member, way } = members[index]
      const previous = members[index - 1]?.way.nodes
      const next = members[index + 1]?.way.nodes
      const start = way.nodes[0], end = way.nodes.at(-1)
      let direction = member.role || way.tags["railway:preferred_direction"]
      // The relation's last way enters Tin King's terminal against its generic preferred-direction tag.
      if (id === 3679916 && way.id === 436522000) direction = "backward"
      if (direction !== "forward" && direction !== "backward") {
        if (previous?.includes(start) || next?.includes(end)) direction = "forward"
        else if (previous?.includes(end) || next?.includes(start)) direction = "backward"
        else direction = metres(point(nodes.get(start)), point(stops[0])) < metres(point(nodes.get(end)), point(stops[0])) ? "forward" : "backward"
      }
      const path = direction === "backward" ? way.nodes.toReversed() : way.nodes
      for (let n = 1; n < path.length; n += 1) add(path[n - 1], path[n])
    }
    routes.push({ id, nodes, adjacency, stops: stopList })
    const sourceElements = data.elements.filter((item) => item.type === "node" || item.type === "way")
      .map((item) => [item.type, item.id, item.version, item.lon, item.lat, item.nodes])
    provenance.push({ id, line, version: relation.version, timestamp: relation.timestamp,
      sha256: createHash("sha256").update(JSON.stringify(sourceElements)).digest("hex") })
  }
  graphs.set(line, routes)
}

function routePath(graph, from, to) {
  // ponytail: O(n²) is bounded by a single offline railway relation; use a heap if imports become slow.
  const distances = new Map([[from, 0]]), previous = new Map(), pending = new Set([from])
  while (pending.size) {
    let nearest, distance = Infinity
    for (const node of pending) if (distances.get(node) < distance) { nearest = node; distance = distances.get(node) }
    pending.delete(nearest)
    if (nearest === to) {
      const path = [to]
      while (path[0] !== from) path.unshift(previous.get(path[0]))
      return path.map((node) => point(graph.nodes.get(node)))
    }
    for (const edge of graph.adjacency.get(nearest) ?? []) {
      const next = distance + edge.length
      if (next < (distances.get(edge.node) ?? Infinity)) {
        distances.set(edge.node, next); previous.set(edge.node, nearest); pending.add(edge.node)
      }
    }
  }
  return null
}

function segment(line, from, to) {
  for (const graph of graphs.get(line) ?? []) {
    for (let start = 0; start < graph.stops.length; start += 1) {
      if (graph.stops[start].code !== from) continue
      const end = graph.stops.findIndex((stop, index) => index > start && stop.code === to)
      if (end < 0) continue
      const path = routePath(graph, graph.stops[start].node, graph.stops[end].node)
      if (path) return path.map((coordinate) => coordinate.map((value) => Number(value.toFixed(7))))
    }
  }
  throw new Error(`No connected OSM service path for ${line}:${from}>${to}`)
}

const mtr = {}, lrt = {}
for (const route of network.routes) {
  for (let index = 1; index < route.stations.length; index += 1) {
    const from = route.stations[index - 1], to = route.stations[index]
    const key = `${route.line}:${from}>${to}`
    mtr[key] ??= segment(route.line, from, to)
  }
}
for (const [from, to] of [["SHT", "RAC"], ["RAC", "UNI"], ["UNI", "RAC"], ["RAC", "SHT"]]) {
  mtr[`EAL:${from}>${to}`] = segment("EAL", from, to)
}
for (const route of lightRail.routes) {
  for (let index = 1; index < route.stations.length; index += 1) {
    const from = route.stations[index - 1], to = route.stations[index]
    lrt[`${route.line}:${from}>${to}`] ??= segment(route.line, from, to)
  }
}
for (const [line, to] of [["705", "435"], ["706", "445"]]) lrt[`${line}:430>${to}`] = segment(line, "430", to)
await writeFile(resolve(root, "data/rail-geometry.json"), JSON.stringify({
  source: { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright",
    license: "ODbL-1.0", licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    retrievedAt, method: "Directional route-member railway ways between on-track stop_position nodes; no station chords or proximity joins.",
    relations: provenance }, mtr, lrt,
}) + "\n")
console.log(`Generated ${Object.keys(mtr).length} MTR and ${Object.keys(lrt).length} Light Rail directed track segments.`)
