import { loadGmbPlaces } from "@/lib/gmb-feed"
import { readViewport, viewportAllowed } from "@/lib/view-cache"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  const view = readViewport(request)
  if (!view) return Response.json({ ok: false, error: "Viewport centre and zoom missing", stops: [] }, { status: 400 })
  const { lng, lat, zoom } = view
  if (!viewportAllowed("gmb", lng, lat, zoom)) return Response.json({ ok: true, stops: [] })
  try {
    return Response.json(loadGmbPlaces(lng, lat, Date.now(), zoom))
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Stops failed", stops: [] }, { status: 502 })
  }
}