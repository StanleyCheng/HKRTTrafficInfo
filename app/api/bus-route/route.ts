import { loadBusRoute, validBusSelection, type BusRouteSelection } from '../../../lib/bus-route.ts'

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const selection = Object.fromEntries(query) as unknown as BusRouteSelection
  if (query.has('routeSeq')) selection.routeSeq = Number(query.get('routeSeq'))
  if (query.has('stopSeq')) selection.stopSeq = Number(query.get('stopSeq'))
  if (!validBusSelection(selection)) return Response.json({ ok: false, error: 'Invalid bus route selection', vehicle: null, observedAt: null, stale: false }, { status: 400 })
  const result = await loadBusRoute(selection)
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
