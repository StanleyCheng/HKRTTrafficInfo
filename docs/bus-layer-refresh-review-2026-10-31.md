# Bus route zoom and refresh review — 31 October 2026

## Popup route controls

KMB/LWB, Citybus, GMB, NLB and MTR Bus stop details offer Zoom to route beside each route. The control also appears for routes without an arrival. Duplicate arrival ranks share one pair of route controls per route variant. Zoom loads available geometry, enables the route and fits the map without waiting for full-route ETAs. Existing geometry coverage checks and unavailable/approximate notices remain in force. Show route continues to select tracked bus estimates. Both actions work in Leaflet 2D and MapLibre 3D, in English and Traditional Chinese.

## Findings and changes

- Full-precision viewport keys made tiny map/GPS movements invalidate nearby bus requests. KMB/GMB now use the server reach-cell key; Citybus/NLB use rounded coordinates and integer zoom, matching the existing MTR Bus approach.
- Failed layers retried on a fixed cadence, and map or visibility changes could initiate more attempts. Bus operator cooldowns now survive those changes. Failed requests wait 30, 60, 120, 240 and at most 300 seconds. Success resets the delay. Offline or hidden pages do not issue scheduled bus requests.
- Upstream failures were not remembered independently of successful stop data. Each failed KMB/GMB stop, Citybus/NLB stop-route pair and MTR Bus route now has its own bounded cooldown. Healthy observations continue updating. These process-local controls supplement the existing shared queue, request deduplication and caches; they are not a cross-instance rate limiter.
- MTR Bus marked the entire nearby response stale for any failed route. Partial failures now preserve healthy boards and report incomplete/non-cacheable status. A total operator alert remains a failure even when the HTTP response is 200.
- Successful layer refreshes rebuilt route objects and restarted unchanged geometry and vehicle queues. The effects now depend on route request identities. Geometry failures remain cached until an explicit retry; retrying once no longer causes retries on every later catalogue change.
- Route-stop details had separate fetching behavior in each renderer, including an effect tied to the full bus-route response. A shared hook now caches by stop selection, validates observation clocks, polls independently and retains last-good rows during failure. Retained data keeps its original three-minute expiry and stale warning. A healthy empty board clears old rows.
- Combining a 30-second timer with a cache timestamp recorded at completion could skip a healthy update and produce a roughly 60-second interval. Five-second due checks now request only when the 30-second freshness interval or failure delay has elapsed.

Manual Retry and reconnecting clear client cooldowns and permit another API request. Server cooldowns and provider caches still apply. Re-enabling an operator also resets its client delay. These changes reduce repeated failed work; they cannot restore an unavailable provider. ETA-derived moving icons remain estimates rather than GPS positions.

## Validation

- `npm run verify`: lint, TypeScript and 244 deterministic tests, including per-key retry growth/reset, partial source failure, MTR Bus recovery and viewport-key stability.
- `npm run build`: production Worker build.
- `tests/bus-refresh.browser.mjs`: all five bus operators across desktop English 2D and mobile Chinese 3D; zoom while ETA requests fail; request counts under failures, map movement, visibility changes, manual retry, offline/reconnect, total MTR Bus alerts, slow pending requests and newly discovered routes.
- `tests/bus-route.browser.mjs`: focused-route and stop-popup behavior, including unexpired arrival retention after a failed update and clearing on healthy empty responses.
- `tests/route-vehicles.browser.mjs`: multiple selected route estimates in both renderers at desktop/mobile sizes.

This review records local implementation and fixture-based browser checks. It does not establish current live upstream availability or a production deployment.
