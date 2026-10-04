import { fetchUpstream } from "./upstream.ts"
import { EMPTY_CONDITIONS, parseWarnsum, type HkoLang } from "./warnings.ts"
import type { WarningsResponse } from "./types.ts"
export { parseWarnsum, parseConditions, weatherBar } from "./warnings.ts"

/** Conditions already arrive through the rainfall layer; do not duplicate rhrread. */
export async function loadWarnings(lang: HkoLang = "tc"): Promise<WarningsResponse> {
  const response = await fetchUpstream(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=${lang}`, 60_000, { timeoutMs: 20_000 })
  if (response.status !== 200) throw new Error(`HTTP ${response.status} from the Observatory`)
  const payload: unknown = JSON.parse(new TextDecoder().decode(response.body))
  return { ok: true, observedAt: response.fetchedAt, fetchedAt: response.fetchedAt, warnings: parseWarnsum(payload, lang), conditions: EMPTY_CONDITIONS }
}
