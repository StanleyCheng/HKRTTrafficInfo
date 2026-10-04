import assert from "node:assert/strict"
import test from "node:test"
import { GET } from "../app/api/nlb/route.ts"
import { GET as places } from "../app/api/nlb/places/route.ts"
import type { NlbPlacesResponse, NlbResponse } from "../lib/types.ts"

test("hosted NLB handler forwards valid zoom and returns boards for every catalogue pole", async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests += 1; return Response.json({ estimatedArrivals: [{ estimatedArrivalTime: "2099-10-04 12:30:00" }] }) }
  try {
    const query = "?lng=113.94&lat=22.29&zoom=15"
    const inventory = await places(new Request(`https://example.test/api/nlb/places${query}`)).json() as NlbPlacesResponse
    assert.equal(inventory.stops.length, 6, "regression fixture must contain actual Lantau poles")
    const response = await GET(new Request(`https://example.test/api/nlb${query}`))
    const body = await response.json() as NlbResponse
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.stops.map((stop) => stop.id), inventory.stops.map((stop) => stop.id))
    assert.ok(body.stops.some((stop) => stop.calls.length > 0))
    assert.ok(requests > 0 && requests <= 24)
    const before = requests
    const invalid = await GET(new Request("https://example.test/api/nlb?lng=113.94&lat=22.29"))
    assert.equal(invalid.status, 400)
    const outside = await GET(new Request("https://example.test/api/nlb?lng=114.18&lat=22.3&zoom=15"))
    assert.deepEqual((await outside.json() as NlbResponse).stops, [])
    assert.equal(requests, before)
  } finally { globalThis.fetch = originalFetch }
})
