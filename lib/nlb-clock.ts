// New Lantao Bus publishes "2026-10-03 14:20:00" with no zone. That clock is Hong Kong time.
const HONG_KONG_OFFSET = "+08:00"

export function nlbArrivalMs(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return Number.NaN
  const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T")
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(iso)) return Date.parse(iso)
  return Date.parse(`${iso}${HONG_KONG_OFFSET}`)
}
