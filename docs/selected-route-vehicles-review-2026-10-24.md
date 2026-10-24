# Selected-route vehicles and processing feedback

Selecting routes in Layers now starts vehicle requests as well as geometry requests. KMB/LWB, Citybus, GMB and NLB reuse the existing whole-route ETA inference, direction and service metadata, polite upstream queue and caches. The dedicated client queue has two workers, prioritises explicit selections, polls every 30 seconds while visible and aborts obsolete waits. MTR Bus uses its complete route schedule and approximate ordered-stop connections. A route whose default bound is absent can still display its available opposite bound.

Fresh viewport ETAs can seed bus positions before the complete vehicle response returns, once geometry is available. Seeding requires exact direction and service matches and original source clocks. Several selected routes render independently in Leaflet and native MapLibre. Hiding a route removes its moving icons immediately. Still-valid estimates survive temporary refresh failures without renewing their three-minute expiry; healthy empty data clears them. Cache-envelope errors remain visible even when a retained payload is available. Focused routes opened from arrivals share the panel's position status without duplicate markers.

Rail and ferry selections request an immediate refresh of their existing feeds. Their published coverage, station-slice limits and GPS/ETA distinctions remain effective. Trams explicitly state that no GPS or ETA feed is available. No source observation means no invented vehicle. MTR Bus artwork is representative, with the exact generation prompt recorded in `public/vehicles/prompts.json`; it is not evidence of a vehicle's identity. MapLibre markers use subpixel positioning for smooth motion, and ferry asset keys resolve through the shared icon registry.

The bilingual Updating data indicator remains visible over the map when the header is collapsed. The activity counter covers feed refreshes, route geometry and vehicles, focused-route and route-stop arrivals, snapshots and map resource loading. Each tracked request finishes its activity on completion, abort or error; local route rows distinguish loading, unavailable and no-current-estimate states and provide retry.

Validation:

- `npm run verify`: lint, TypeScript and 215 deterministic tests passed.
- Four new browser scenarios passed: English desktop and Traditional Chinese mobile in both 2D and 3D. They hold complete API responses pending, verify that fresh viewport ETAs already draw animated icons, keep processing visible with a collapsed header, check image decoding, multiple selections, deselection, MTR Bus icons, failure retention, retry and healthy empty results. All four completed without browser errors.
- All six transport-panel, 11 focused bus-route and eight commuter/session browser regression cases passed.
- `npm run build`: production Worker build passed.
- `npm run build:static`: static export and restoration of all 22 API route files checked separately.
- Rendered desktop 2D and mobile 3D screenshots inspected for loading-indicator placement and readable destination labels.
- A local API check using live upstream data returned KMB 115 road geometry, 20 forward stops and four usable position estimates across the returned directions. MTR Bus K12 returned 17 estimates, including 14 scheduled estimates, with an operator-alert stale flag preserved. These are samples, not fleet-coverage guarantees.

Browser fixtures isolate upstream variability while exercising both real renderers. The upstream checks validate the new local endpoint with actual operator responses. Changes remain local; no production deployment was performed.
