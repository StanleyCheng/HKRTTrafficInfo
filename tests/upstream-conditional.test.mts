import test from "node:test"
import assert from "node:assert/strict"
import { fetchUpstream } from "../lib/upstream.ts"

const symbol = Symbol.for("vinext.fetchCache.originalFetch")

interface MockState {
  lastHeaders: Record<string, string> | null
  seenRequests: Array<{ url: string; headers: Record<string, string> }>
  handler: () => Response | Promise<Response>
  originalFetch: typeof fetch | undefined
}

async function withMock(handler: () => Response, etag?: { after?: string }): Promise<MockState> {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  const previousFetch = globalThis.fetch
  const state: MockState = { lastHeaders: null, seenRequests: [], handler, originalFetch: previousFetch }
  globalThis.fetch = (async () => { throw new Error("vinext wrapper must be bypassed in tests") }) as typeof fetch
  globals[symbol] = (async (input, init) => {
    const url = String(input)
    const headers: Record<string, string> = {}
    const h = (init as RequestInit | undefined)?.headers
    if (h instanceof Headers) h.forEach((v, k) => { headers[k.toLowerCase()] = v })
    else if (h && typeof h === "object") Object.entries(h as Record<string, string>).forEach(([k, v]) => { headers[k.toLowerCase()] = String(v) })
    state.seenRequests.push({ url, headers })
    state.lastHeaders = headers
    // Allow the test to dynamically swap etags between request 1 and 2.
    if (etag?.after && state.seenRequests.length === 2) {
      return new Response("", { status: 304, headers: { etag: etag.after } })
    }
    return handler()
  }) as typeof fetch
  return state
}

function restore(state: MockState) {
  const globals = globalThis as unknown as Record<symbol, typeof fetch | undefined>
  if (state.originalFetch) globalThis.fetch = state.originalFetch
  else delete (globalThis as { fetch?: typeof fetch }).fetch
  if (globals[symbol]) globals[symbol] = state.originalFetch
  else delete globals[symbol]
}

test("first fetch captures etag and last-modified from upstream response", async () => {
  let calls = 0
  const state = await withMock(() => {
    calls += 1
    return new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: `"v${calls}"`,
        "last-modified": "Wed, 09 Oct 2026 04:00:00 GMT",
      },
    })
  })
  try {
    const body = await fetchUpstream("https://example.test/etag", 60_000)
    assert.equal(body.status, 200)
    assert.equal(body.etag, `"v1"`)
    assert.equal(body.lastModified, "Wed, 09 Oct 2026 04:00:00 GMT")
    assert.equal(calls, 1)
  } finally { restore(state) }
})

test("second fetch within TTL is served from the in-memory cache without going upstream", async () => {
  let calls = 0
  const state = await withMock(() => {
    calls += 1
    return new Response("{}", { status: 200, headers: { "content-type": "application/json", etag: `"v${calls}"` } })
  })
  try {
    await fetchUpstream("https://example.test/etag-cached", 60_000)
    const body = await fetchUpstream("https://example.test/etag-cached", 60_000)
    assert.equal(body.status, 200)
    assert.equal(calls, 1, "Second call within TTL must hit the in-memory cache, not upstream")
  } finally { restore(state) }
})

test("after TTL expiry the upstream call carries If-None-Match and If-Modified-Since", async () => {
  const originalNow = Date.now
  let offset = 0
  Date.now = () => originalNow() + offset
  let calls = 0
  const state = await withMock(() => {
    calls += 1
    if (calls === 1) return new Response("{}", { status: 200, headers: { "content-type": "application/json", etag: `"v1"`, "last-modified": "Wed, 09 Oct 2026 04:00:00 GMT" } })
    // Second call: respond with 304 to test conditional reuse.
    return new Response(null, { status: 304, headers: { etag: `"v1"` } })
  })
  try {
    const first = await fetchUpstream("https://example.test/etag-conditional", 60_000)
    assert.equal(first.etag, `"v1"`)
    offset += 120_000 // expire TTL
    await fetchUpstream("https://example.test/etag-conditional", 60_000)
    assert.equal(calls, 2)
    const second = state.seenRequests[1]
    assert.equal(second.headers["if-none-match"], `"v1"`, "Conditional header must carry the previous etag")
    assert.equal(second.headers["if-modified-since"], "Wed, 09 Oct 2026 04:00:00 GMT")
  } finally {
    restore(state)
    Date.now = originalNow
  }
})

test("a 304 response reuses the cached body and surfaces it as a successful fetch", async () => {
  const originalNow = Date.now
  let offset = 0
  Date.now = () => originalNow() + offset
  let calls = 0
  const state = await withMock(() => {
    calls += 1
    if (calls === 1) return new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "content-type": "application/json", etag: `"v1"` } })
    return new Response(null, { status: 304, headers: { etag: `"v1"` } })
  })
  try {
    const first = await fetchUpstream("https://example.test/etag-reuse", 60_000)
    const originalBytes = first.body.byteLength
    offset += 120_000
    const second = await fetchUpstream("https://example.test/etag-reuse", 60_000)
    assert.equal(second.status, 200, "304 is normalised to a successful body for callers")
    assert.equal(second.body.byteLength, originalBytes, "Cached body is reused; no second transfer of bytes")
    assert.deepEqual(JSON.parse(new TextDecoder().decode(second.body)), { hello: "world" })
  } finally {
    restore(state)
    Date.now = originalNow
  }
})
