import centerlinesJson from "../data/strategic-centerlines.json" with { type: "json" }
import roadPointsJson from "../data/road-points.json" with { type: "json" }

type CenterlineName = { roadEn?: string; roadTc?: string }
type RoadPointName = { en?: string; tc?: string }

const PHRASES: readonly [RegExp, string][] = [
  [/hard\s+shoulder/gi, "路肩"],
  [/slow\s+lane/gi, "慢線"],
  [/fast\s+lane/gi, "快線"],
  [/middle\s+lane/gi, "中線"],
  [/^slow$/i, "慢線"],
  [/^fast$/i, "快線"],
  [/lane\s+(\d+)/gi, "第$1線"],
  [/structure maintenance works/gi, "結構保養工程"],
  [/ramp\s+([A-Za-z0-9]+)/gi, "斜路$1"],
  [/kowloon\s+bound/gi, "九龍方向"],
  [/hong\s+kong\s+bound/gi, "香港方向"],
  [/east\s*bound/gi, "東行"],
  [/west\s*bound/gi, "西行"],
  [/north\s*bound/gi, "北行"],
  [/south\s*bound/gi, "南行"],
  [/\s+\bto\b\s+/gi, "往"],
  [/\s*&\s*/g, "及"],
]

const roadNames = buildRoadNames()

// The Chinese works feed is the first choice. When that copy is missing, the
// English road name is still one of the published names in the road lists.
export function fillWorksChinese(works: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: works.features.map((feature) => {
      const properties = feature.properties ? { ...feature.properties } : {}
      properties.roadTc = chineseField(text(properties.roadTc), text(properties.road))
      properties.placeTc = chineseField(text(properties.placeTc), text(properties.place))
      properties.laneTc = chineseField(text(properties.laneTc), text(properties.lane))
      properties.kindTc = chineseField(text(properties.kindTc), text(properties.kind))
      properties.statusTc = chineseField(text(properties.statusTc), statusChinese(text(properties.status)))
      return { ...feature, properties }
    }),
  }
}

function chineseField(traditional: string, english: string): string {
  if (hasHan(traditional)) return traditional
  const translated = translateWorksEnglish(english)
  return hasHan(translated) ? translated : traditional
}

function translateWorksEnglish(english: string): string {
  let textValue = applyRoadNames(english)
  for (const [pattern, traditional] of PHRASES) textValue = textValue.replace(pattern, traditional)
  if (hasHan(textValue)) textValue = textValue.replace(/,\s*/g, "，")
  return textValue.replace(/\s+/g, " ").trim()
}

function statusChinese(english: string): string {
  if (/in progress/i.test(english)) return "進行中"
  if (/preparation/i.test(english)) return "預備中"
  return english
}

function applyRoadNames(english: string): string {
  let textValue = english
  for (const road of roadNames) textValue = textValue.replace(road.pattern, road.traditional)
  return textValue
}

function buildRoadNames(): { pattern: RegExp; traditional: string }[] {
  const names = new Map<string, string>()
  const add = (english: string, traditional: string) => {
    const key = english.replace(/\s+/g, " ").trim().toUpperCase()
    if (!key || !hasHan(traditional) || names.has(key)) return
    names.set(key, traditional.trim())
  }
  for (const row of centerlinesJson as CenterlineName[]) add(row.roadEn ?? "", row.roadTc ?? "")
  for (const row of roadPointsJson as RoadPointName[]) add(row.en ?? "", row.tc ?? "")
  add("Cheung Tsing Bridge", "長青橋")
  return [...names.entries()]
    .sort((left, right) => right[0].length - left[0].length)
    .map(([english, traditional]) => ({
      pattern: new RegExp(`(?<![A-Za-z])${english.split(/\s+/).map(escapeRegExp).join("\\s+")}(?![A-Za-z])`, "gi"),
      traditional,
    }))
}

function hasHan(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
