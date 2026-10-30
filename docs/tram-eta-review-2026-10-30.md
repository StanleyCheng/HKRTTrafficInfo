# Tram arrivals and estimated positions

Local implementation and review on 30 October 2026. No commit or deployment was made.

## Behavior

- All 117 published tram stops can request their own arrival board. Popups show destination, direction, minutes remaining, Hong Kong arrival time and live or scheduled status. Each recognized route has a Show route button that enables and fits its complete matched published track. Routes remain available when no tram is approaching.
- The Trams category has a separate Tram stations switch. It defaults on and persists through reloads and 2D/3D changes. Turning it off removes station icons while leaving route lines and moving tram icons visible. Nearby tram markers follow the same switch.
- Actual predictions place representative green-and-cream tram miniatures along the selected routes' matched OpenStreetMap tracks. Scheduled calls remain labelled in arrival boards and do not generate moving icons. Destination, direction and any supplied fleet number separate inference groups. Unknown route keys do not receive a guessed track.
- At zoom 13 or above, a refresh samples at most 12 stations within 2.5 km of the map centre. Map arrivals and an open station board refresh every 30 seconds while visible. Opening a stop outside the sample requests that specific board. This does not represent complete fleet coverage.
- Requests share the existing six-slot ETA queue, a 30-second per-stop cache and request coalescing. A 20-second stop deadline includes queue time. Failed directions retain only their own observations for at most three minutes. Healthy empty boards clear those calls. Expiry follows the original observation clock. Stations and tracks remain available through ETA failures. The tram loader reads JSON error bodies within its request deadline because the operator supplies service notices with HTTP 503.
- The static export keeps the catalogue, fares, route display and station switch. It makes no tram ETA requests and explains that arrivals require the hosted app.

## Source checks

The operator's [station dictionary](https://api.hktramways.com/api/v1/home) and [arrival endpoint](https://api.hktramways.com/api/v1/tram-eta/76W/westbound) returned successful live responses during implementation. `data/tram-eta-stations.json` records station codes, direction queries and bilingual destinations checked against the bundled TD catalogue. Every station matched within 100 metres, with east/west constraints for named directional stops. Stop coordinates and existing matched tracks were retained.

The prior conversation linked the [community OpenAPI specification](https://github.com/ByteLandTechnology/hktramways-openapi). Its documentation is unofficial. Integration uses the operator endpoint directly, with no added SDK, authentication key or embedded secret. The operator has not published a stable integration contract here, so response changes can interrupt arrivals.

Observed exceptions are handled explicitly. Route key `R1_WKT_to_WM` maps to the published Shau Kei Wan–Western Market route. Happy Valley shared platforms return the same board for either direction query, so stops 105–111 and HVT use one query and derive travel direction from the route and destination. Tin Lok Lane 112 still queries both directions because they branch to different destinations. The live Shek Tong Tsui response reported suspended service with Hill Road as the alternative; operator notice text is rendered as text in the station popup.

## Verification

- `npm run verify`: lint, TypeScript and 238 deterministic tests pass, including eight new tram tests for parsing, clock conversion, station mapping, filtering, expiry, outage retention, independent direction failures, empty boards, bounded fan-out and cache coalescing.
- `npm run build`: production Vinext build passes. It retains the existing informational warning about static classification of some API routes.
- `tests/tram-track.browser.mjs`: existing matched-track and route-selection scenarios pass in 2D/3D at desktop English and mobile Chinese sizes.
- `tests/tram-eta.browser.mjs`: arrival popups, full-route actions, vehicle artwork, independent station hiding, reload persistence and renderer switching pass at 1440 px English and 390 px Chinese, starting in either map mode. These scenarios use deterministic same-origin ETA fixtures and block unrelated feeds.
- Rendered desktop and mobile popups were inspected in both map modes. The Impeccable detector returned no findings for the five changed TSX components.
- Live same-origin `/api/tram` returned the complete station catalogue and 12 nearby arrival boards. Live operator responses confirmed actual and scheduled calls, the route alias, the shared loop boards and the service notice.
- A static-mode runtime check returned all 117 stations and 12 matched directional paths without making a network request.
- `git diff --check` passes.

Browser scenarios require an external Playwright installation, as elsewhere in this repository. For example, set `PLAYWRIGHT_MODULE` to that installation's `playwright/index.mjs`, run the local app, then execute:

```sh
node --experimental-strip-types tests/tram-eta.browser.mjs http://localhost:5173 /tmp/hkrt-tram-eta
```

The built-in image generation tool created `public/vehicles/tram.webp`, a transparent 192 px asset under 8 KB, following the existing vehicle set's front-down orientation. Its prompt, original output filename and source reference are recorded in `public/vehicles/prompts.json`. It depicts a representative tram and does not identify the vehicle approaching a stop.
