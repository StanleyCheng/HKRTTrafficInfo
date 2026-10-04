export const dynamic = "force-dynamic"
export function GET() {
  return Response.json({ ok: true, mode: "hosted", timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } })
}
