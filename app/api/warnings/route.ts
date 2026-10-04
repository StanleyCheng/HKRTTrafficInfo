import { loadWarnings } from "@/lib/weather-warnings"
import { EMPTY_CONDITIONS } from "@/lib/warnings"
import { cachedFeed } from "@/lib/route-cache"
import type { WarningsResponse } from "@/lib/types"
export const dynamic = "force-dynamic"
const failure = (error: unknown): WarningsResponse => ({ ok: false, error: error instanceof Error ? error.message : "Weather warnings failed", observedAt: null, warnings: [], conditions: EMPTY_CONDITIONS })
const english = cachedFeed(60_000, () => loadWarnings("en"), failure)
const traditional = cachedFeed(60_000, () => loadWarnings("tc"), failure)
export function GET(request: Request) { return new URL(request.url).searchParams.get("lang") === "en" ? english() : traditional() }
