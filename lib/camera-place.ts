type CardLocale = "zh-HK" | "en"

export type CameraPlace = {
  road: string
  bound: string
  near: string
  side: string
  towards: string
  reference: string
}

const EMPTY: CameraPlace = {
  road: "",
  bound: "",
  near: "",
  side: "",
  towards: "",
  reference: "",
}

const BOUND_WORD = String.raw`(?:(?:east|west|north|south)\s*bound|[東南西北东]行)`
const REFERENCE = /\s*\[([A-Za-z0-9]+)\]\s*$/
const NEAR_EN = /^(.*?)\s*(?:near|nr)\s*(.+)$/i
const BOUND = new RegExp(String.raw`^(.*?)(?:\s+|(?<=[\u4e00-\u9fff)）]))(${BOUND_WORD})\s*(\(\d+\))?\s*$`, "i")
const PEEL_BOUND = new RegExp(String.raw`^(.*?)(?:\s*[-–—]\s*|\s+)(${BOUND_WORD})\s*(\(\d+\))?\s*$`, "i")
const PORTAL_EN =
  /^(.*?(?:Tunnel|Crossing|Bridge|Highway))\s+((?:Northern|Southern|Eastern|Western)\s+Portal(?:\s*\(\d+\))?)$/i
const SIDE_EN = /^(.*?(?:Tunnel|Crossing|Bridge))\s+(.+\sSide)$/i
const PORTAL_TC = /^(.*?(?:隧道|大橋|大桥|公路|繞道|绕道|橋|桥))(.+[出入口])$/
const TOWARDS_EN = /^(.*\S)\s+to\s+(.+)$/i
const TOWARDS_TC = /^(.+?)至(.+)$/

export function standardHan(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim()
}

export function roadOf(description: string): string {
  const road = parsePlace(description).road.trim()
  return road || description.trim()
}

export function parsePlace(description: string): CameraPlace {
  const clean = repairBoundTypos(standardHan(description))
  if (!clean) return { ...EMPTY }
  const referenceMatch = clean.match(REFERENCE)
  const reference = referenceMatch?.[1] ?? ""
  const body = referenceMatch ? clean.slice(0, referenceMatch.index).trim() : clean
  const place = splitBody(body)
  return { ...place, reference }
}

export function facingWord(rotation: number, locale: CardLocale): string {
  const turn = ((rotation % 360) + 360) % 360
  const index = Math.round(turn / 45) % 8
  const compass = compassOf(locale)
  return compass[index] ?? compass[0]
}

function splitBody(body: string): Omit<CameraPlace, "reference"> {
  const near = takeNear(body)
  const head = near?.head ?? body
  const dash = takeDash(head)
  if (dash) {
    const dashedBound = isBound(dash.right) ? normalizeBound(dash.right) : ""
    return {
      road: tidyRoad(dash.left),
      bound: dashedBound || near?.bound || "",
      near: near?.near ?? "",
      side: dashedBound ? "" : dash.right,
      towards: "",
    }
  }
  const bound = takeBound(head)
  const afterBound = bound?.road ?? head
  const portal = takePortal(afterBound)
  const towards = portal ? null : takeTowards(afterBound)
  const road = portal?.road ?? towards?.road ?? afterBound
  return {
    road: tidyRoad(road),
    bound: bound?.bound || near?.bound || "",
    near: near?.near ?? "",
    side: portal?.side ?? "",
    towards: towards?.towards ?? "",
  }
}

function takeNear(body: string): { head: string; near: string; bound: string } | null {
  const tc = body.indexOf("近")
  if (tc > 0) return { head: body.slice(0, tc).trim(), ...peelBound(body.slice(tc + 1).trim()) }
  const en = body.match(NEAR_EN)
  if (!en?.[1] || !en[2]) return null
  return { head: en[1].trim(), ...peelBound(en[2].trim()) }
}

function peelBound(value: string): { near: string; bound: string } {
  const match = value.match(PEEL_BOUND)
  if (!match?.[1] || !match[2]) return { near: value, bound: "" }
  const near = match[1].trim().replace(/\s*[-–—]\s*$/, "").trim()
  if (near.length < 1) return { near: value, bound: "" }
  return { near, bound: normalizeBound(`${match[2]}${match[3] ? ` ${match[3]}` : ""}`) }
}

function takeDash(body: string): { left: string; right: string } | null {
  const match = body.match(/^(.*?)\s*[-–—]\s+(.+)$/)
  if (!match?.[1] || !match[2]) return null
  const left = match[1].trim()
  const right = match[2].trim()
  if (left.length < 2) return null
  if (!isBound(right) && !isSideLabel(right)) return null
  return { left, right }
}

function takeBound(body: string): { road: string; bound: string } | null {
  const match = body.match(BOUND)
  if (!match?.[1] || !match[2]) return null
  const road = match[1].trim()
  if (road.length < 2) return null
  return { road, bound: normalizeBound(`${match[2]}${match[3] ? ` ${match[3]}` : ""}`) }
}

function normalizeBound(value: string): string {
  const match = value.match(new RegExp(String.raw`^(${BOUND_WORD})\s*(\(\d+\))?$`, "i"))
  if (!match?.[1]) return value.trim()
  const token = match[1].replace(/\s+/g, "")
  const english = token.match(/^(east|west|north|south)bound$/i)
  const word = english ? `${english[1].toLowerCase()}bound` : token
  return match[2] ? `${word} ${match[2]}` : word
}

function takePortal(body: string): { road: string; side: string } | null {
  const portal = body.match(PORTAL_EN)
  if (portal?.[1] && portal[2] && portal[1] !== body) return { road: portal[1].trim(), side: portal[2].trim() }
  const side = body.match(SIDE_EN)
  if (side?.[1] && side[2] && side[1] !== body) return { road: side[1].trim(), side: side[2].trim() }
  const tc = body.match(PORTAL_TC)
  if (!tc?.[1] || !tc[2] || tc[1] === body) return null
  if (tc[1].trim().length < 2 || tc[2].trim().length < 2) return null
  return { road: tc[1].trim(), side: tc[2].trim() }
}

function takeTowards(body: string): { road: string; towards: string } | null {
  const en = body.match(TOWARDS_EN)
  if (en?.[1] && en[2] && isRoadName(en[1]) && isRoadName(en[2])) return { road: en[1].trim(), towards: en[2].trim() }
  const tc = body.match(TOWARDS_TC)
  if (!tc?.[1] || !tc[2]) return null
  if (!isRoadName(tc[1]) || !isRoadName(tc[2])) return null
  return { road: tc[1].trim(), towards: tc[2].trim() }
}

function isRoadName(value: string): boolean {
  return /(?:Road|Highway|Tunnel|Bridge|Corridor|Bypass|路|公路|隧道|大橋|橋|走廊|繞道)/i.test(value.trim())
}

function isSideLabel(value: string): boolean {
  return /(?:side|portal)(?:\s*\(\d+\))?$/i.test(value.trim())
}

function repairBoundTypos(value: string): string {
  return value
    .replace(/nouthbound/gi, "northbound")
    .replace(/sorthbound/gi, "southbound")
    .replace(/souhtbound/gi, "southbound")
    .replace(/souththbound/gi, "southbound")
}

function isBound(value: string): boolean {
  return new RegExp(String.raw`^(?:${BOUND_WORD})(?:\s*\(\d+\))?$`, "i").test(value.trim())
}

function tidyRoad(road: string): string {
  return road.replace(/\s*\/\s*/g, "／").trim()
}

function compassOf(locale: CardLocale): readonly string[] {
  switch (locale) {
    case "en":
      return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
    case "zh-HK":
      return ["北", "東北", "東", "東南", "南", "西南", "西", "西北"]
    default: {
      const exhaustive: never = locale
      return exhaustive
    }
  }
}
