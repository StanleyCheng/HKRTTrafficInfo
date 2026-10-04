export const SUN_ROUTES: { code: string; from: string; to: string; fromTc: string; fromEn: string; destTc: string; destEn: string }[] = [
  { code: "CECC", from: "sun-central", to: "sun-cheung-chau", fromTc: "中環", fromEn: "Central", destTc: "長洲", destEn: "Cheung Chau" },
  { code: "CCCE", from: "sun-cheung-chau", to: "sun-central", fromTc: "長洲", fromEn: "Cheung Chau", destTc: "中環", destEn: "Central" },
  { code: "CEMW", from: "sun-central", to: "sun-mui-wo", fromTc: "中環", fromEn: "Central", destTc: "梅窩", destEn: "Mui Wo" },
  { code: "MWCE", from: "sun-mui-wo", to: "sun-central", fromTc: "梅窩", fromEn: "Mui Wo", destTc: "中環", destEn: "Central" },
  { code: "NPHH", from: "sun-north-point", to: "sun-hung-hom", fromTc: "北角", fromEn: "North Point", destTc: "紅磡", destEn: "Hung Hom" },
  { code: "HHNP", from: "sun-hung-hom", to: "sun-north-point", fromTc: "紅磡", fromEn: "Hung Hom", destTc: "北角", destEn: "North Point" },
  { code: "NPKC", from: "sun-north-point", to: "sun-kowloon-city", fromTc: "北角", fromEn: "North Point", destTc: "九龍城", destEn: "Kowloon City" },
  { code: "KCNP", from: "sun-kowloon-city", to: "sun-north-point", fromTc: "九龍城", fromEn: "Kowloon City", destTc: "北角", destEn: "North Point" },
  { code: "IIPECMUW", from: "hkkf-peng-chau", to: "sun-mui-wo", fromTc: "坪洲", fromEn: "Peng Chau", destTc: "梅窩", destEn: "Mui Wo" },
  { code: "IIMUWPEC", from: "sun-mui-wo", to: "hkkf-peng-chau", fromTc: "梅窩", fromEn: "Mui Wo", destTc: "坪洲", destEn: "Peng Chau" },
  { code: "IIMUWCMW", from: "sun-mui-wo", to: "sun-chi-ma-wan", fromTc: "梅窩", fromEn: "Mui Wo", destTc: "芝麻灣", destEn: "Chi Ma Wan" },
  { code: "IICMWMUW", from: "sun-chi-ma-wan", to: "sun-mui-wo", fromTc: "芝麻灣", fromEn: "Chi Ma Wan", destTc: "梅窩", destEn: "Mui Wo" },
  { code: "IICMWCHC", from: "sun-chi-ma-wan", to: "sun-cheung-chau", fromTc: "芝麻灣", fromEn: "Chi Ma Wan", destTc: "長洲", destEn: "Cheung Chau" },
  { code: "IICHCCMW", from: "sun-cheung-chau", to: "sun-chi-ma-wan", fromTc: "長洲", fromEn: "Cheung Chau", destTc: "芝麻灣", destEn: "Chi Ma Wan" },
  { code: "IICHCMUW", from: "sun-cheung-chau", to: "sun-mui-wo", fromTc: "長洲", fromEn: "Cheung Chau", destTc: "梅窩", destEn: "Mui Wo" },
  { code: "IIMUWCHC", from: "sun-mui-wo", to: "sun-cheung-chau", fromTc: "梅窩", fromEn: "Mui Wo", destTc: "長洲", destEn: "Cheung Chau" },
]

export function ferryBadge(code: string): { tc: string; en: string } {
  if (code === "天星") return { tc: "天星", en: "Star Ferry" }
  if (code === "富裕") return { tc: "富裕小輪", en: "Fortune Ferry" }
  if (code.startsWith("II")) return { tc: "橫水渡", en: "Inter-island" }
  if (SUN_ROUTES.some((route) => route.code === code)) return { tc: "新渡輪", en: "Sun Ferry" }
  if (/^[1-4]$/.test(code)) return { tc: "港九小輪", en: "HK & Kowloon Ferry" }
  return { tc: "渡輪", en: "Ferry" }
}

// A departure names where the boat is going. An arrival names where it came from.
// The route code stays off the card.
export function ferryLeg(call: {
  arriving?: boolean
  destTc?: string
  destEn?: string
  originTc?: string
  originEn?: string
}): { arriving: boolean; tc: string; en: string } | null {
  const tc = call.arriving ? call.originTc ?? "" : call.destTc ?? ""
  const en = call.arriving ? call.originEn ?? "" : call.destEn ?? ""
  if (!tc && !en) return null
  return { arriving: call.arriving === true, tc, en }
}
