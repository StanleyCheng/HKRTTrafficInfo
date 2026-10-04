import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { GET as places } from "../app/api/kmb/places/route.ts"
import { GET as arrivals } from "../app/api/kmb/route.ts"
import type { KmbPlacesResponse, KmbResponse } from "../lib/types.ts"

test("KMB places never orphan catalogue I/O; ETA request awaits its own daily refresh", async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  const release: (() => void)[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (/\/(stop|route-stop)$/.test(url)) {
      await new Promise<void>((resolve) => release.push(resolve))
    }
    return Response.json({ data: [] })
  }
  try {
    const query = "?lng=114.17&lat=22.32&zoom=15"
    const inventory = await places(new Request(`https://example.test/api/kmb/places${query}`)).json() as KmbPlacesResponse
    await setImmediate()
    assert.equal(inventory.stops.length, 40)
    assert.equal(requests.length, 0, "synchronous places response must not leave background fetches tied to an ended Worker request")

    let completed = false
    const pending = arrivals(new Request(`https://example.test/api/kmb${query}`)).then((response) => { completed = true; return response })
    await setImmediate()
    assert.equal(release.length, 2, "ETA request owns both stop and route catalogue refreshes")
    assert.equal(completed, false, "owner request must remain alive until its catalogue I/O completes")
    release.forEach((resolve) => resolve())
    const body = await (await pending).json() as KmbResponse
    assert.equal(body.ok, true)
    assert.deepEqual(body.stops.map((stop) => stop.id), inventory.stops.map((stop) => stop.id))
    assert.equal(requests.filter((url) => url.includes("/stop-eta/")).length, 40)

    const spent = requests.length
    await arrivals(new Request(`https://example.test/api/kmb${query}`))
    places(new Request(`https://example.test/api/kmb/places${query}`))
    await setImmediate()
    assert.equal(requests.length, spent, "cached arrivals and catalogue places do not open extra fetches")
  } finally {
    release.forEach((resolve) => resolve())
    globalThis.fetch = originalFetch
  }
})
