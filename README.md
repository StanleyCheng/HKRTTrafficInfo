# HKRTTrafficInfo — 香港實時交通資訊

HK RT Traffic Info. Responsive bilingual (zh-HK/en-HK) map with officially published red-light junctions, speed-enforcement housings, traffic snapshot locations, live road-speed segments, traffic incidents, parking vacancy and district rainfall. No application authentication, mock locations, static fallback datasets, or API keys.

## Live site

- [GitHub Pages](https://stanleycheng.github.io/HKRTTrafficInfo/) — static export under the repository sub-path.
- [Vercel](https://hkrttrafficinfo.vercel.app/) — standard Next.js build, auto-deployed from `main`.

## Run

Node 22.13 or later. Install with `npm ci`, then `npm run dev`. On Windows, the development script uses Next.js directly to avoid Vinext worker read failures on OneDrive-backed workspaces; production builds still use Vinext. Build with `npm run build`. Preview the built Cloudflare Worker with `npm start`. Run lint, type checks and tests with `npm run verify`.

Stack: React, TypeScript, Vinext/Vite, Cloudflare Worker API routes, Leaflet 1.9, Leaflet.markercluster, fast-xml-parser. OpenStreetMap supplies the basemap (non-government); all camera information comes from government sources.

## Interface

The desktop workbench has Layers, Search and Details tabs and can be collapsed. Selecting a map marker or road segment reopens Details. Search provides a keyboard-accessible alternative to the map, matches Chinese and English road names, route/segment identifiers and location districts, and displays 20 results per page. Road segments do not carry district metadata; district search applies to locations that publish it.

On mobile, four labelled shortcuts (road speeds, incidents, snapshots and parking) sit beside a permanently visible More/Details button. The sheet preserves the selected item when dismissed. Its tabs support arrow keys, and Escape closes the sheet and restores focus.

On desktop and mobile, traffic information starts minimized to a logo-sized Info button aligned below the HK logo, including when the top bar or workbench is collapsed. Click or tap it to expand or collapse the speed legend, official update age, mapped-segment coverage and partial-update status; Escape closes the block and restores focus. Stale data and failed updates add an amber badge without automatically expanding it. The bottom map-instruction hint is removed on all screen sizes. Fetch time is kept distinct from the official speed publication time. Retained road speeds older than ten minutes become unavailable/grey between refreshes. Map errors offer a retry action; the Sources dialog groups source details into expandable sections.

## Official sources

- [Red-light junctions dataset](https://data.gov.hk/tc-data/dataset/hk-td-tis_25-junctions-with-rlc): [CSDI FeatureServer](https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1671693287017_1644/FeatureServer/0?f=pjson).
- [Speed-enforcement housings dataset](https://data.gov.hk/tc-data/dataset/hk-td-tis_26-locations-of-sec): [CSDI FeatureServer](https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1671693428549_89372/FeatureServer/0?f=pjson).
- [Traffic snapshots dataset](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images): [complete Traditional Chinese XML inventory](https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml). Images use the exact URLs supplied by that inventory at `https://tdcctv.data.one.gov.hk/`.
- [Traffic data of strategic / major roads](https://data.gov.hk/en-data/dataset/hk-td-sm_4-traffic-data-strategic-major-roads): processed segment speeds are joined to the official road network and speed-limit layers. Invalid, malformed or stale readings are shown as unavailable rather than free-flowing.

The enforcement API first queries all object IDs and the independent official total, then fetches every ID in batches of 150, requesting WGS84 coordinates. Counts, identifiers, uniqueness and coordinates are verified before exposing a successful layer. It does not use a bounding box, nearest-camera limit, or just the first page. The complete XML supplies all snapshot locations. Invalid or incomplete sources produce an explicit error rather than silently dropping records.

Local same-origin routes remove browser CORS limitations. Source requests have timeouts and one retry. Successful inventories are cached in memory for five minutes; manual reloads respect that server-side cache to prevent an unauthenticated client from hammering official APIs. Failed refreshes retain any previously displayed real data, explicitly labelled as an unsuccessful update. Sources fail independently. No fabricated fallback is used.

The selected snapshot is fetched immediately and every two minutes while the page is visible. `Last-Modified` is labelled as the official image file update time, distinct from capture time printed within the image and from the local retrieval time. Missing timestamps are explicitly shown. Images more than ten minutes old are flagged. An official HTTP-200 “No Service” JPEG is preserved with an explanatory note; availability cannot reliably be inferred from JPEG HTTP status alone.

## Validation

Run `npm run verify:live` against a development server on port 5173. This independently compares source inventories, validates every displayed road segment against the processed-speed feed and HKeMobility colour classification, fetches a real JPEG and timestamp, and checks invalid route rejection.

Verified 2026-09-20: **230 red-light locations, 164 speed-enforcement housings and 1,013 snapshots with zero missing or duplicate IDs.** The live feed contained 4,524 road segments; 4,505 matched the current official road geometry, and all 4,411 comparable valid readings matched HKeMobility's colour classification. Counts are dynamic, not hardcoded into the application.

Browser checks covered individual layer counts, all-off state, restoring every layer, cluster expansion, marker details, snapshot loading, attribution dialog, desktop/mobile layout, and an aborted source request followed by recovery. Network-failure simulation is test-only; no mock data is delivered by the website.

## Source limitations

Enforcement sources identify published junctions/housings, not the number of operational cameras, enforcement activity, or live camera feeds. The speed-housing inventory excludes government tunnels and control areas. Snapshots are periodically updated still images, not live video; each upstream camera may temporarily stop serving. The website exposes those limitations in Traditional Chinese.

The local preview is available in the Codex browser panel. Sites hosting configuration is in `.openai/hosting.json`.
