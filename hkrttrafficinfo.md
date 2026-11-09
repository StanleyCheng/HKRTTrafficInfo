# HKRTTrafficInfo — Technical Specification

Engineering handover document. Some older sections retain historical architecture notes; the current feed and release behavior is summarized in the November 2026 implementation note below and in `README.md`.

### Review implementation (8 November 2026)

The original traffic feeds now refresh when a layer, Search or selected detail needs them, using source-specific checks while the page is visible and online. Tram requests follow the viewport and zoom gate. Opened MTR and Light Rail stations receive one due slot within the existing bounded provider budget. Incident publication time stays unknown when absent or invalid; retained snapshot age advances on a display clock; Nearby tram cards distinguish live, scheduled and stale arrival information. Route geometry errors retry with backoff and on reconnect. Transport geometry derives from feed data rather than unrelated request status or the display clock, and both renderers limit offscreen vehicle work and dense overview labels. Production workflows serialize each target and skip superseded commits; the Verify workflow adds deterministic Chromium smoke checks. See `docs/review-implementation-2026-11-08.md` for scope and validation.

## 1. Overview

HKRTTrafficInfo (`package.json` name `hk-rt-traffic-info`, version 0.1.0) is a responsive bilingual (zh-HK / en-HK) map application with 23 traffic, transport, weather and access layers. The seven original layers cover camera inventories, snapshots, road speeds, incidents, parking and rainfall. Additional layers cover journey times, works, tolls, boundary queues, warnings, rail and bus arrivals, ferries, MTR buses, trams, accessible facilities/connections and taxi stands (`README.md`, `lib/traffic.ts`). No application authentication or API keys are required. Production layers use published official records and do not fabricate source observations.

Live/deployed URLs (`README.md` "Live site"):
- GitHub Pages static export: `https://stanleycheng.github.io/HKRTTrafficInfo/` (served under the `/HKRTTrafficInfo` sub-path; see `next.config.ts` `basePath`).
- Vercel: `https://hkrttrafficinfo.vercel.app/` — standard Next.js build, auto-deployed from `main` (`.vercel/project.json` projectName `hkrttrafficinfo`).

i18n: two languages, `zh` (Traditional Chinese, default) and `en`, implemented in `lib/i18n.ts`. Language choice persists in `localStorage` key `hk-traffic-language-v1` with a cross-tab storage subscription and an in-memory fallback. Server snapshot is `'zh'`; `<html lang>` is `zh-HK` statically (`app/layout.tsx`) and updated client-side on toggle.

The app is also a PWA: `public/site.webmanifest` (name `HK RT Traffic Info`, short name `HK RT Traffic`, `display: standalone`, theme `#08244d`), icons in `public/` (`hkrttrafficinfo-logo.png` is the 1254px source art the rasters are cut from), wired in `app/layout.tsx` metadata (title `HK RT Traffic Info · 香港實時交通資訊`; the in-app brand reads `HK RT Traffic Info` in English and `香港實時交通資訊` in Chinese, compacting to `HK RT Traffic` and `香港實時交通` in the mobile top bar).

### Bus route zoom and refresh resilience (31 October 2026)

Every bus route listed in a stop popup has a bilingual Zoom to route action, including routes without arrivals. It loads geometry separately from ETA polling, enables the route and fits its available path in either renderer; the existing Show route action still selects tracked arrival estimates (`app/item-details.tsx`, `app/traffic-monitor.tsx`).

Failed bus-layer, route-position and route-stop requests use bounded exponential delays of 30, 60, 120, 240 and 300 seconds (`lib/refresh-backoff.ts`). Healthy requests remain eligible after 30 seconds; five-second client checks enforce that freshness without doubling the effective interval. Viewport request keys match cache cells or rounded coordinates. Stable route identities prevent successful layer refreshes from restarting pending geometry and vehicle requests. Geometry failures now retry with bounded backoff and on reconnect. Failed upstream stop/route keys cool independently in KMB, Citybus, GMB, NLB and MTR Bus adapters; MTR Bus partial failures retain healthy boards and completeness metadata. Both renderers share `app/use-bus-stop-arrivals.ts`, retaining unexpired arrivals with a stale warning after failures and clearing them after a healthy empty response. Retention preserves the original observation clock and three-minute expiry. Manual retry and reconnect reset client cooldowns; provider/server limits remain in force. Review and reproducible validation: `docs/bus-layer-refresh-review-2026-10-31.md`.

### Bus position estimates (15 October 2026)

The selected bus route uses `lib/bus-route.ts` to load operator-specific stops and ETAs in both directions. ETA rank is local to a stop, so chronological matching permits ranks to change after a bus passes a stop. Live and scheduled observations are kept separate. A newly appearing earlier downstream arrival is bounded by the preceding stop; sparse observations use an approximate approach speed. `lib/bus-route-motion.ts` follows the complete matched timeline between refreshes, including congested segments, and `lib/bus-route-state.ts` preserves nearby marker identities and unexpired trajectories during failures. The two map renderers consume the same calculation. Individual stop/row failures leave healthy observations visible; healthy empty boards clear estimates. Retained data never extends a vehicle's original observation lifetime.

These are ETA-derived estimates, not vehicle GPS or a complete fleet inventory. They can differ from the rider's GPS and cannot identify the bus being ridden. KMB 115 regression evidence, partial-failure behavior and validation are documented in `docs/bus-motion-review-2026-10-15.md`.

### Unified map layer selector (25 October 2026)

The right-hand Layers popover has one persistent category dropdown for Road, Conditions & access, Buses & minibuses, Trains & Light Rail, Ferries, Trams and Taxis. All 23 layers have independent switches directly within these categories, including operator switches above the transport route controls. Selecting a category only browses controls; it never enables or disables map layers. The bottom icon docks and category bar are removed on desktop and mobile, making the right-side panel the sole layer selector. The expandable Other map layers section is replaced by category-specific controls.

The panel keeps detector visibility, incident messages, counts, loading/error and retry states, viewport notices and static-host restrictions. Transport categories retain route-label visibility, show/hide-all actions, bilingual search, independent route checkboxes and route-fit buttons (`app/transport-layers.tsx`); bus-stop visibility is in the bus category. The category dropdown remains above the scrolling content in narrow and short viewports.

`lib/transport-routes.ts` builds route choices and filters paths, stops, arrivals and moving rail/ferry payloads before either renderer receives them. MTR interchanges remain while any selected line serves them. Light Rail can be selected by service rather than as one network switch. Bus choices are operator-scoped and based on currently loaded stops; the panel states this coverage boundary. KMB and Citybus official road geometry is matched to the full ordered stop sequence, including repeated stops on circular services. Route 288 uses its Transport Department road shape; its former straight stop connections are suppressed. An unmatched KMB or Citybus direction does not draw a line or estimated vehicle. Citybus may use a route-specific OpenStreetMap relation when it passes the same checks. MTR Bus uses OpenStreetMap road relations matched to the operator's ordered stops; unmatched directions are omitted and identified in the interface. These community mappings are not authoritative service maps. Tram directions follow OpenStreetMap track relations matched to the ordered published stops; unmatched or outdated shapes are omitted. Ferry fairways retain their existing inferred geometry.

`/api/bus-route-paths` loads cached bus geometry without the selected-route ETA fan-out. Its client queue has two workers and aborts obsolete waits; failures remain explicit and retryable. `routeVisibility`, `layerCategory`, `transportMode` and `routeQuery` are validated saved-session fields. New sessions start in Road; saved transport modes migrate when no category was saved. Previous rail-line preferences remain effective until the new rail controls are changed, and a restored legacy rail popover opens Layers. Both renderers accept the same route-focus bounds. See `docs/transport-layers-review-2026-10-24.md` and `docs/layer-selector-review-2026-10-25.md` for validation.

### Selected-route vehicles and processing feedback (24 October 2026)

Selecting a bus or MTR Bus route starts a separate two-worker vehicle queue through `/api/route-vehicles`. Four bus operators reuse the existing route ETA inference and caches; MTR Bus uses its full route schedule and matched road geometry, with arrivals assigned by the operator's direction/variant identifier. No position is inferred for unmatched geometry. Fresh ETAs already loaded around the viewport seed direction- and service-matched bus estimates while the full request is pending. Selected routes can display moving miniatures in either renderer, with exact source expiry, retained estimates during brief failures, explicit empty results and per-route loading/error/retry feedback. A valid opposite bound remains available when the default bound is absent. Focused routes opened from a stop keep their existing tracking and share the panel's status display without duplicate markers.

Rail and ferry route selections trigger an immediate refresh while respecting their existing source coverage, shared caches and rate limits. GPS fixes and ETA estimates retain their existing distinctions; tram ETA support was added on 30 October 2026 as described below. A representative MTR Bus image is registered in `public/vehicles/prompts.json`. Native MapLibre markers use subpixel positions for smooth movement and resolve the registered ferry artwork correctly.

The shared activity counter now covers selected-route requests, focused-route and stop-arrival requests, and native map resource loading alongside existing feeds, snapshots and 2D resources. The bilingual Updating data indicator sits in the map workspace, so collapsing the header does not conceal ongoing processing. Abort and completion paths balance each activity. See `docs/selected-route-vehicles-review-2026-10-24.md` for local validation.

### Tram arrivals and position estimates (30 October 2026)

`/api/tram` provides bounded nearby arrivals at zoom 13+ and accepts `stop=<published-stop-id>` for every one of the 117 bundled stations. The 30-second refresh samples up to 12 stations within 2.5 km of the map centre. Open station popups refresh independently, including stations outside that sample. The operator mobile API is publicly reachable, but its contract is not officially documented; source changes can interrupt arrivals. `data/tram-eta-stations.json` records the checked station-code mapping and bilingual destination names from the operator's `/home` response.

The shared ETA queue and 30-second per-stop cache coalesce requests. Parser validation distinguishes scheduled departures, actual predictions, explicit empty boards and operator service notices. Short failures retain arrival rows with their original observation clocks, for at most three minutes; successful empty directions clear their rows. Shared Happy Valley boards avoid duplicate queries, and destination-based direction matching handles the common loop platforms. Unknown operator route identifiers remain visible in arrival boards without assigning a guessed track.

The Trams category has a persistent Tram stations switch, independent of route paths and vehicle icons in 2D and 3D. Station details show destination, direction, countdown, Hong Kong arrival time and live/scheduled status. Their Show route actions enable and fit the full matched published route. Live predictions produce representative green-and-cream tram miniatures on selected routes through `lib/tram.ts` and `selectedVehicleCameras`. Trajectories separate destinations, directions and any supplied fleet IDs, follow track distances and expire with the observations. Scheduled arrivals do not create moving tram icons. Estimates are local to loaded boards and do not imply full fleet coverage or GPS. The static export retains station, fare and track information with no ETA requests. Artwork provenance is in `public/vehicles/prompts.json`. See `docs/tram-eta-review-2026-10-30.md` for verification.

## 2. Technical framework

### 2.1 Toolchain versions (`package.json`)

- Runtime: Node `>=22.13.0` (`engines`); `"type": "module"`.
- Framework: `next` ^16.4.3, `react`/`react-dom` 19.3.0.
- Build: `vinext` ^1.1.0 (Next.js-on-Vite adapter), `vite` ^8.3.4, `@vitejs/plugin-react` 6.0.2, `@vitejs/plugin-rsc` 0.5.36, `react-server-dom-webpack` ^19.3.0.
- Cloudflare: `@cloudflare/vite-plugin` ^1.63.1, `wrangler` 4.92.0, `@cloudflare/workers-types` 4.20260515.1.
- Styling: `tailwindcss` 4.2.1 via `@tailwindcss/postcss` 4.2.1, `tw-animate-css` ^1.4.0; shadcn new-york style (`components.json`).
- Lint/types: `eslint` 9.39.4 + `eslint-config-next` ^16.4.3, `typescript` 5.9.3.
- Overrides: `miniflare.sharp` pinned to 0.35.4 (`package.json` `overrides`).

### 2.2 package.json scripts

| Script | Command | What it does |
|---|---|---|
| `install:ci` | `node scripts/install-ci.mjs` | CI installer wrapper: requires npm, sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` unless sharp env is already set, branches on execution profile (managed-linux vs portable) (`scripts/install-ci.mjs`, companion `scripts/install-ci.sh`). |
| `prepare:maplibre` | `node scripts/prepare-maplibre-assets.mjs` | Copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` from `node_modules/maplibre-gl/dist` to `public/vendor/maplibre-gl/`; throws if missing. Output dir is gitignored (`.gitignore` `/public/vendor/maplibre-gl/`). |
| `predev` / `prebuild` / `prebuild:static` | `npm run prepare:maplibre` | npm pre-hooks ensuring the MapLibre worker assets exist before dev/build. |
| `dev` | `node scripts/run-framework.mjs dev` | Platform dispatch (`scripts/run-framework.mjs`): on Windows (`win32`) runs `next dev` directly (to avoid Vinext worker read failures on OneDrive-backed workspaces, per `README.md`); on `managed-linux` runs `vite dev`; otherwise runs `vinext dev`. Non-managed dev gets `--port 5173`. |
| `build` | `node scripts/run-framework.mjs build` | Same dispatch: `managed-linux` → `scripts/build-verified.sh` (runs `vinext build` under GNU `timeout`, default 3m); Windows/other → `vinext build`. |
| `build:static` | `node scripts/build-static.mjs` | GitHub Pages static export: copies aside and temporarily removes `app/api/` for the export build, then restores it on exit/signals. Output to `out/`. |
| `start` | `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 --inspector-port 0` | Previews the built Cloudflare Worker locally via Wrangler against `dist/server/wrangler.json` (produced by the Vinext build; `dist/` is gitignored and not currently present). `scripts/sites-env.mjs` redirects Wrangler/Miniflare state into `.sites-runtime/` and `chdir`s to the project root. |
| `lint` | `eslint .` with generated-output ignores | ESLint over the repo. |
| `typecheck` | `tsc --noEmit --pretty false --incremental false` | Type check; `examples/` excluded via `tsconfig.json`. |
| `test` | `node --experimental-strip-types --test tests/*.test.mts` | Deterministic Node test suite. |
| `verify` | `npm run lint && npm run typecheck && npm test` | Full local gate (also run in CI). |
| `verify:browser` | `bash scripts/run-browser-smoke.sh` | Deterministic Chromium startup, layer and refresh-recovery checks; also run in CI. |
| `verify:live` | `node --experimental-strip-types scripts/verify-live.mjs http://localhost:5173` | Optional live-source check against a running server; depends on public providers. |
| `db:generate` | `drizzle-kit generate` | Generates SQL migrations into `drizzle/` from `db/schema.ts` (currently a no-op: schema is empty). |

### 2.3 Key dependencies and roles

| Dependency | Version | Role |
|---|---|---|
| `leaflet` | ^1.9.4 | Map engine; dynamically imported in `app/traffic-map.tsx`. |
| `leaflet.markercluster` | ^1.5.3 | Marker clustering (maxClusterRadius 42). |
| `@maplibre/maplibre-gl-leaflet` + `maplibre-gl` | ^0.1.4 / ^6.11.0 | Optional Positron vector basemap inside Leaflet; worker assets served from `public/vendor/maplibre-gl/`. |
| `fast-xml-parser` | ^5.11.1 | Parses XML upstreams (snapshot inventory, speed feeds, special traffic news, ALS) in both `lib/traffic-client.ts` and `lib/traffic-server.ts`. |
| `lucide-react` | ^1.31.0 | All UI icons. |
| `radix-ui` | current lockfile | The map-layer, Nearby and Search popover in `components/ui/popover.tsx`. Other unused UI components were removed. |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 | Optional D1 database access (§2.5); schema empty. |
| `clsx`, `tailwind-merge` | current lockfile | `lib/utils.ts` `cn()` helper for the popover. |
| `playwright` | pinned dev dependency | Chromium browser smoke checks in `npm run verify:browser` and the Verify workflow. |

### 2.4 Config files

- `next.config.ts` — when `STATIC_EXPORT=1`: `output: 'export'`, `basePath: '/HKRTTrafficInfo'`, `assetPrefix: '/HKRTTrafficInfo/'`, `images.unoptimized`, `trailingSlash`, exposes `NEXT_PUBLIC_BASE_PATH`. Otherwise plain config (`agentRules: false`).
- `vite.config.ts` — Vinext production/dev pipeline: plugins `vinext()`, `sites({ mockAuth: false })` (vendored `build/sites-vite-plugin.ts`, from `@openai/sites-vite-plugin` 0.2.0 — local-auth middleware; disabled), and `cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] }, inspectorPort: false, config: localBindingConfig })`. `localBindingConfig` points the Worker entry at `vinext/server/fetch-handler`, sets `nodejs_compat`, and wires optional D1/R2 bindings from `.openai/hosting.json` (both currently `null`, with a placeholder database id). Sets Wrangler/Miniflare env vars (`.wrangler/` local state, metrics off). `managed-linux` profile binds `0.0.0.0`/`terminal.local`; macOS seatbelt sandbox switches to polling watch.
- `tsconfig.json` — strict, bundler resolution, path alias `@/* → ./*`, types `node` + `@cloudflare/workers-types`, excludes `examples/`.
- `eslint.config.mjs` — `eslint-config-next` core-web-vitals + typescript; the unused vendored UI rule exception was removed.
- `postcss.config.mjs` — `@tailwindcss/postcss` only.
- `components.json` — shadcn registry config (new-york, css `app/globals.css`, aliases `@/components`, `@/lib/utils`…).
- `drizzle.config.ts` — dialect `sqlite`, schema `./db/schema.ts`, out `./drizzle`.
- `vercel.json` — `framework: nextjs`, `buildCommand: node node_modules/next/dist/bin/next build` (plain Next build, not Vinext).
- `.openai/hosting.json` — `{ "d1": null, "r2": null, "project_id": "appgprj_6aaa077016688191b6a80c44ca5de4b7" }`; consumed by `vite.config.ts` for optional D1/R2 bindings.
- `cloudflare-env.d.ts` — declares `Cloudflare.Env` with optional `DB?: D1Database`, `BUCKET?: R2Bucket`.
- `.npmrc` — `audit=false`, `fund=false`, `update-notifier=false`.
- `build/sites-vite-plugin.ts` — vendored MIT-licensed Sites plugin (local mock auth, `/signin-with-chatgpt` etc. paths); loaded by `vite.config.ts` with `mockAuth: false`, so effectively inert.

### 2.5 Drizzle / database

The database is **scaffolding only**. `db/schema.ts` is intentionally empty (`export {};` with a comment pointing to `examples/d1`). `db/index.ts` exports `getDb()` which requires a Cloudflare D1 binding `DB` (from `cloudflare:workers` env) and throws a descriptive error if absent. `drizzle/meta/_journal.json` has zero entries; no migrations exist. `examples/d1/app/api/notes/route.ts` is a reference implementation (GET/POST `/api/notes` using drizzle D1), but it is currently **broken**: it imports `examples/d1/db/schema.ts` which was deleted in commit `a2e2267` (git history), and `tsconfig.json` excludes `examples/` from typechecking.

## 3. Repository layout

| Path | Purpose |
|---|---|
| `app/` | Next.js app router root, client monitor, both map renderers, panels and CSS. `app/api/` contains hosted transit and infrastructure feed handlers. |
| `components/ui/` | The popover used by the map-layer, Nearby and Search controls. |
| `lib/` | `traffic.ts` (shared types, layer metadata, speed classification, freshness helpers, upstream URL constants); `traffic-client.ts` (browser data layer — the one actually used); `traffic-server.ts` (server-side mirror, currently unused); `traffic-parsing.ts` (CSV parser, CSDI PopupInfo HTML table parser, HK bounds check, period/route-number helpers); `traffic-view.ts` (stale-segment greying, segment→camera adapter, search); `i18n.ts` (zh/en message table); `utils.ts` (`cn`). |
| `hooks/` | The unused shadcn mobile helper was removed. |
| `db/`, `drizzle/` | Empty drizzle scaffolding + migration journal (§2.5). |
| `examples/d1/` | D1 reference route (broken import, §2.5). |
| `scripts/` | Build/dev/deploy helpers (§2.2), `verify-live.mjs` (§6.3), pnpm/install helpers for the Codex "Sites" managed environment (`install-pnpm.sh`, `pnpm-install.mjs`, `install-ci.*`, `sites-env.*`, `execution-profile.mjs`, `build-verified.sh`). |
| `tests/` | Deterministic `*.test.mts` suite plus browser regression scripts (§6.3). |
| `public/` | PWA icons/manifest, `images/layers*.png` (Leaflet assets), `vendor/maplibre-gl/` (generated, gitignored). |
| `vendor/` | `shadcn-tailwind-4.13.0.css` + LICENSE — a shadcn Tailwind 4 theme CSS. **Not imported anywhere** (grep: no references); dead weight. |
| `build/` | `sites-vite-plugin.ts` + LICENSE — vendored Vite plugin used by `vite.config.ts`. |
| `.github/workflows/deploy-pages.yml` | GitHub Pages CI (§6.4). |
| `.vercel/`, `.openai/` | Vercel project link and hosting config (§2.4). |

## 4. Architecture

### 4.1 Request flow

The original seven layers use the browser adapter in `lib/traffic-client.ts` to request published government sources directly; its per-layer cache and shared pending producers preserve source timestamps. Hosted transit and infrastructure layers use same-origin handlers under `app/api/`, with parsing and bounded provider access in `lib/*-feed.ts`. The GitHub Pages static export omits those handlers and explains unavailable live features in the interface. An opened stop or route can request details independently of the map-wide sample. Provider-specific backoff and the shared ETA queue bound upstream work; `fetchedAt` is separate from the provider observation clock.

The client monitor keeps enabled layers, source data, request status, selected details and viewport state. It derives route catalogues and geometry from feed data and visibility; the Leaflet and MapLibre renderers receive shared paths and camera observations. The two renderers update transport geometry only when their relevant inputs change. See `README.md` for the hosted/static capability table and `docs/review-implementation-2026-11-08.md` for the latest review-driven changes.

### 4.2 Caching

In-memory per-layer cache in `lib/traffic-client.ts` (identical pattern in `lib/traffic-server.ts`): `cached: Map<LayerKind, {expires, data}>` plus `pending: Map<LayerKind, Promise>` single-flight dedupe. TTLs (`cacheTtl`): redlight/speed/snapshot 300 000 ms (5 min), flow 90 000 ms, incident 120 000 ms, parking 180 000 ms, rainfall 600 000 ms. Road-segment geometry is cached separately for 24 h (`segmentGeometryTtl`) with its own single-flight refresh. Incident geocoding results are cached indefinitely in `geocodeCache` (`lib/traffic-client.ts`).

### 4.3 State management

Pure React state in `app/traffic-monitor.tsx`: `enabled` (per-layer on/off; defaults flow+incident+MTR when hosted), `states: Record<LayerKind, LayerState>` (`data`/`loading`/`error`), `selectedSnapshot`, and map/panel preferences. Original feeds load on demand from enabled layers, Search and selected details. While visible and online, flow and incidents check every 120 s, parking every 180 s, rainfall every 600 s, and camera/snapshot inventories every 300 s; provider caches can satisfy a check without an upstream request. Tram request identity follows the viewport and zoom coverage gate. An opened MTR/Light Rail station takes one due slot in its feed's bounded refresh slice. Route geometry failures use bounded retry and reconnect recovery. Snapshot images refresh every 120 s plus on selection/visibility (`SnapshotImage`, 55 s fetch timeout), while the display clock continues to age a retained photo after failure.

### 4.4 Theming

No dark mode. Single light theme via CSS custom properties in `app/globals.css` (`color-scheme: light`). Per-layer colours in `lib/traffic.ts` `layers` (`#e15d69` redlight, `#d49b25` speed, `#318dbe` snapshot, `#1f9d63` flow, `#e8842c` incident, `#7b5fc9` parking, `#5a8fd6` rainfall) and `speedLevelColors` (free `#1f9d63`, moderate `#d49b25`, slow `#e15d69`, unknown `#8a9aa5`). Basemap toggle (OSM raster vs OpenFreeMap Positron vector) is a map-style switch, not a theme.

### 4.5 Map stack

`app/traffic-map.tsx`: Leaflet dynamically imported (with `leaflet.markercluster` side-effect import), map fixed to HK centre `[22.355, 114.13]` zoom 11, minZoom 10 / maxZoom 19. Markers are `divIcon`s with inline SVG glyphs per layer (rotation applied for flow detectors). Flow segments are canvas-rendered polylines (weight 4.8, selected 7.2). Basemaps: `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (maxZoom 19) or OpenFreeMap Positron via `maplibre-gl-leaflet` with style `https://tiles.openfreemap.org/styles/positron` and worker URL `<base>/vendor/maplibre-gl/maplibre-gl-worker.mjs`. Tile/style errors surface a retryable `map-error` overlay.

## 5. Data layers

All seven layers share the same pipeline: `TrafficMonitor.fetchLayer(kind)` → `getCameraData(kind)` (`lib/traffic-client.ts`) → upstream fetch/parse/validate → `CameraData` (`lib/traffic.ts`). Server route paths: **none in the current tree** (see §4.1); the deleted routes were `/api/cameras/<kind>` for every layer below and `/api/snapshot/<id>` for snapshot images. Client cache TTLs and error UI are uniform (§4.2, §5.8 pattern: per-layer `layer-error` block with retry button; previously displayed data retained with the "update failed" label — `layerUpdateFailed` vs `dataLoadFailed` in `lib/i18n.ts`).

### 5.1 Red-light camera junctions (`redlight`)

- **Function**: markers for junctions with red-light camera systems; details show Chinese/English site description, remarks, last-updated date.
- **UI**: Road category layer card in `app/traffic-monitor.tsx`; marker SVG in `app/traffic-map.tsx` (`symbols.redlight`); detail note `copy.layerDetail.redlight` (`lib/i18n.ts`). Naming: no browser `title` (so no delayed native tooltip on any form factor); the instant hover tooltip is bound only when `hoverCapable` (desktop pointer with room), and a click or tap opens the details popup on its own (`hoverTooltipKinds` in `app/traffic-map.tsx`).
- **Client access**: `loadEnforcement('redlight')` in `lib/traffic-client.ts` (mirror: `lib/traffic-server.ts`).
- **Server route**: none (deleted `/api/cameras/redlight`).
- **Upstream**: CSDI FeatureServer layer 0, base URL built by `featureService('redlight')` (`lib/traffic.ts`): `https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1671693287017_1644/FeatureServer/0`, queried as `<base>/query?where=1%3D1&returnIdsOnly=true&f=json`, `<base>/query?where=1%3D1&returnCountOnly=true&f=json`, then `<base>/query?objectIds=…&outFields=*&returnGeometry=true&outSR=4326&f=json` in batches of 150. Format: Esri JSON. Publisher: Transport Department via CSDI; dataset page `https://data.gov.hk/tc-data/dataset/hk-td-tis_25-junctions-with-rlc`.
- **Refresh**: client polls every 300 s; cache TTL 300 s.
- **Parsing**: full ID inventory is cross-checked against the independent `returnCountOnly` total; each feature's `PopupInfo` HTML table is parsed by `popupFields()` (`lib/traffic-parsing.ts`) into `RLC_ID`, `SITE_DESC_CHI`, `SITE_DESC_ENG`, `REMARKS`, `LAST_UPD_DATE`; geometry x/y (WGS84). `validate()` enforces exact count, unique ids, non-empty names, coords within lat 22–23 / lng 113–115; any mismatch throws (layer fails loudly, no partial display).
- **Failure**: 20 s timeout, 1 retry (`officialFetch`); error → per-layer error state, stale data retained.
- **Gotchas**: dataset identifies published junctions, not operational cameras (`README.md` "Source limitations"); no bbox/nearest/first-page shortcuts — completeness verification is a hard requirement an integrator must preserve.

### 5.2 Speed-enforcement housings (`speed`)

- **Function**: markers for speed-camera housing locations (not cameras themselves).
- **UI**: same layer-card/marker/detail pattern (`symbols.speed` in `app/traffic-map.tsx`), with the red-light naming contract: no native `title`, desktop-pointer hover tooltip only, details popup from click or tap.
- **Client access**: `loadEnforcement('speed')` — identical pipeline to §5.1.
- **Server route**: none (deleted `/api/cameras/speed`).
- **Upstream**: `https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1671693428549_89372/FeatureServer/0` (same query URLs). Esri JSON; TD via CSDI; dataset `https://data.gov.hk/tc-data/dataset/hk-td-tis_26-locations-of-sec`. Source id uses `SEC_ID` from PopupInfo.
- **Refresh/parsing/failure**: identical to §5.1 (TTL 300 s).
- **Gotchas**: inventory excludes government tunnels and control areas (`README.md`); housings ≠ live cameras.

### 5.3 Traffic snapshots (`snapshot`)

- **Function**: markers for Transport Department traffic cameras; selecting one shows the latest JPEG, refreshed immediately and every 120 s while visible, with `Last-Modified` shown as the official image update time; images older than 10 min flagged; explicit "no update time" and "No Service" JPEG handling (`SnapshotImage` in `app/traffic-monitor.tsx`).
- **UI**: markers (`symbols.snapshot`), `SnapshotImage` component in the Details tab.
- **Client access**: `loadSnapshots()` (`lib/traffic-client.ts`); images fetched **directly from the browser** (`fetch(camera.imageUrl)`, blob → object URL).
- **Server route**: none (deleted `/api/snapshot/[id]` proxy, §4.1).
- **Upstream**: inventory XML `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml` (authoritative) and optional `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml` (joined by `key`; failure tolerated). Image URLs are taken verbatim from the inventory's `url` field, host `https://tdcctv.data.one.gov.hk/` (`README.md`). Format: XML (`image-list/image` rows with `key`, `description`, `district`, `region`, `latitude`, `longitude`, `url`). Publisher: TD; dataset `https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images`.
- **Refresh**: inventory poll 300 s / TTL 300 s; image 120 s + on visibility.
- **Parsing**: `fast-xml-parser` (`ignoreAttributes`, `parseTagValue: false`); trailing `[…]` bracket suffix stripped from descriptions; English rows merged by key for `nameEn`/`districtEn`/`regionEn`; `validate()` against row count.
- **Failure**: malformed Tc XML → hard error; malformed En XML → silently ignored (Tc remains authoritative). Image fetch: 55 s timeout, error state with manual reload button; HTTP-200 "No Service" JPEGs shown with explanatory note (README; `snapshotNote` string).
- **Gotchas**: stills, not live video; per-camera outages are normal; the old proxy's 10 MB cap/host allowlist is gone — the browser now trusts the inventory URL as-is.

### 5.4 Live road-speed segments + detectors (`flow`)

- **Function**: colour-coded polylines over major-road segments (free/moderate/slow/unknown by official speed-limit-aware thresholds), plus optional detector point markers (`showDetectors` toggle). Segments with stale (>10 min) or invalid readings render grey "unknown" (`displayFlowSegments` in `lib/traffic-view.ts`, re-evaluated every 30 s client-side).
- **UI**: polylines in `app/traffic-map.tsx`; legend/status in `app/traffic-status.tsx` (mapped vs expected coverage); detail panel shows speed, level badge, route number/speed limit; coverage warning when `segmentsComplete === false` (`traffic-monitor.tsx`).
- **Client access**: `loadFlow()` + `loadSegmentSpeeds()` + `getSegmentGeometry()` (`lib/traffic-client.ts`).
- **Server route**: none (deleted `/api/cameras/flow`).
- **Upstream** (all TD / CSDI):
  - Detector inventory CSV: `https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/traffic_speed_volume_occ_info.csv`
  - Raw per-detector lane speeds XML: `https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml`
  - Segment route-number CSV: `https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/speed_segments_info.csv`
  - Processed segment speeds XML: `https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml`
  - Road network geometry (IRN CENTERLINE, Road Network 2nd Gen): `https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/FeatureServer/10/query` (where `ROUTE_ID IN (…)`, outFields `ROUTE_ID,STREET_ENAME,STREET_CNAME,TRAVEL_DIRECTION`, `outSR=4326`, batches of 150)
  - Speed limits: `https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/FeatureServer/2/query` (where `ROAD_ROUTE_ID IN (…)`, outFields `ROAD_ROUTE_ID,SPEED_LIMIT`, no geometry)
  - Dataset page: `https://data.gov.hk/en-data/dataset/hk-td-sm_4-traffic-data-strategic-major-roads`
- **Refresh**: poll 120 s; cache TTL 90 s; segment-geometry cache 24 h.
- **Parsing**: latest `period` chosen by `pickLatestPeriod`; official publication timestamp built by `officialHongKongTimestamp(date, time)` (strict `YYYY-MM-DD`/`HH:MM:SS` → `+08:00`); readings accepted only if feed fresh (≤10 min old, ≤5 min future — `isLiveTrafficDataFresh`), `valid === 'Y'`, finite ≥ 0; per-detector speed = mean of valid lanes. Segments joined: `segment_id` → `ROUTE_ID` geometry (longest path of `paths`, coords rounded to 5 dp) and minimum signed `SPEED_LIMIT` per route (a route counts as ≥70 km/h major road only if all sections qualify); route numbers 1–10 from the CSV (`parseSegmentRouteNumbers`); unnamed roads (`-99`/`－９９`) fall back to `N號幹線`/`Route N` or generic `路段`/`Road segment`. Classification `speedLevel(speed, speedLimit)` (`lib/traffic.ts`): urban (<70 limit) slow ≤15, free >30; major (≥70) slow ≤25, free >50. Duplicate segment ids, empty feeds, or zero matched geometries → hard error.
- **Failure**: upstream feed stale → all readings become `null`/unknown (never shown as free-flowing); segment IDs missing from the road network are skipped with a `console.warn` and surfaced via `segmentsComplete=false`/`segmentsExpectedCount`.
- **Gotchas**: `speedLimitKmh` defaults to HK's 50 km/h when the CSDI lookup has no entry; detectors (`cameras[]`) and segments (`segments[]`) are two independent sub-feeds in one `CameraData`; completeness = detector rows all mapped AND all segment ids matched.

### 5.5 Traffic incidents (`incident`)

- **Function**: bilingual Special Traffic News — an expandable text list per layer card (always, even with zero located items) plus approximate map pins for notices whose English text yields a geocodable road name.
- **UI**: `incident-notices` details element in `app/traffic-monitor.tsx`; markers (`symbols.incident`); detail shows full notice text with `incidentApproxNote` disclaimer.
- **Client access**: `loadIncidents()` (`lib/traffic-client.ts`).
- **Server route**: none (deleted `/api/cameras/incident`).
- **Upstream**: XML `https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml` (`body/message` rows: `msgID`, `ChinText`, `EngText`, `ChinShort`, `EngShort`, `ReferenceDate`). Geocoding: Address Lookup Service `https://www.als.gov.hk/lookup?q=<road>&n=1` (JSON or XML accepted). Dataset `https://data.gov.hk/en-data/dataset/hk-td-tis_19-special-traffic-news-v2`.
- **Refresh**: poll 300 s; TTL 120 s.
- **Parsing**: up to 3 unique road-name candidates extracted from English text by the `roadPattern` regex (Road/Street/Avenue/… suffixes), geocoded in order until one scores ≥ 50 and lands in HK bounds; result cached in `geocodeCache`. `ReferenceDate` parsed from `YYYY/M/D 上/下午 h:mm:ss` to `+08:00` ISO (`parseNewsTime`); unparseable → current time. Unlocated notices stay list-only (`located: false`, `incidentNoLocation`).
- **Failure**: geocoding is best-effort (errors swallowed per road); whole-feed failure → layer error state.
- **Gotchas**: pin positions are approximate (`remarks: '≈ <road>'`); zero-incident state is normal (`incidentEmpty`); `expectedCount` = total notices, `count` = located ones.

### 5.6 Parking vacancy (`parking`)

- **Function**: car-park markers listing the spaces available and the spaces the car park has for every vehicle type it publishes, plus height limit, opening status and address.
- **UI**: markers (`symbols.parking`); the marker tooltip and the detail panel both list `parkingTypeLabel` rows as `available / total` in the current language, tooltip bordered in the layer colour; no details popup opens from the marker (search selection still shows it).
- **Client access**: `loadParking()` (`lib/traffic-client.ts`).
- **Server route**: none (deleted `/api/cameras/parking`).
- **Upstream**: DATA.GOV.HK one-stop API, base `https://api.data.gov.hk/v1/carpark-info-vacancy`, three requests: `?data=info&lang=en_US`, `?data=info&lang=zh_HK` (optional, failure tolerated), `?data=vacancy&lang=en_US`. Format: JSON `{results: [...]}`. Dataset `https://data.gov.hk/en-data/dataset/hk-dpo-datagovhk1-carpark-info-vacancy`.
- **Refresh**: poll 300 s; TTL 180 s.
- **Parsing**: info rows filtered to HK bounds; both endpoints read per vehicle type (`privateCar`, `LGV`, `HGV`, `CV`, `coach`, `motorCycle`); `parkingSpaces` joins `space` with the live `vacancy` where `vacancy_type` is `A` (B reports availability without a count, C reports closure); a type with no spaces recorded and no live count, or with `space: 0`, is dropped so only the types the car park offers are listed; Chinese name/address preferred when present; newest `lastupdate` normalized `YYYY-MM-DD HH:mm:ss` → `+08:00` ISO; `heightLimits[0].height` numeric.
- **Failure**: empty/malformed English info feed → hard error; zh feed failure → English names retained.
- **Gotchas**: `parkingNoLive` still covers a car park whose every type was dropped; `opening_status` passed through raw (English feed values even in zh UI).

### 5.7 District rainfall (`rainfall`)

- **Function**: 18-district hourly rainfall markers (mm in past hour).
- **UI**: markers (`symbols.rainfall`); detail live-figure mm; `rainfallNote` disclaimer; `remarks: 'M'` marks gauges under maintenance (`main === 'TRUE'`).
- **Client access**: `loadRainfall()` (`lib/traffic-client.ts`).
- **Server route**: none (deleted `/api/cameras/rainfall`).
- **Upstream**: HKO open-data API `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en` and `&lang=tc` (optional), JSON. Dataset page `https://data.gov.hk/en-data/dataset/hk-hko-rss-rainfall-in-the-past-hour`.
- **Refresh**: poll 300 s; TTL 600 s.
- **Parsing**: readings joined to a hard-coded `districtReferencePoints` table (lat/lng + zh name for all 18 districts — comment: HKO publishes no station coordinates, these are reference points solely for map placement); `max` numeric required; zh place names taken from the tc feed by array index, falling back to the curated table; `dataUpdated` = `rainfall.endTime`. Unknown district names silently skipped.
- **Failure**: empty/malformed en feed → hard error; tc feed failure → curated names retained.
- **Gotchas**: markers are NOT gauge locations (README + code comment); index-based zh/en join assumes both feeds return rows in the same order [INFERENCE from code: `zhPlaces[index]`].

### 5.8 Uniform validation / failure model

`officialFetch` (client): 20 s `AbortSignal.timeout`, 2 attempts, non-2xx → throw; Traditional-Chinese error messages. Server mirror additionally enforces HTTPS + host allowlist with manual redirect following (max 3). `validate()` for inventory layers: exact expected count, unique ids, name present, coords in HK box. `CameraData.complete` is `false` when anything mapped incompletely; UI surfaces this (`completeInventory`, `flowCoverage`, amber badge via `traffic-status.tsx` "partial-update" states). No fabricated fallback data anywhere (README + absence of mock code).

## 6. Cross-cutting

### 6.1 Env vars / secrets

- `STATIC_EXPORT=1` — set by `scripts/build-static.mjs` to trigger the GitHub Pages branch in `next.config.ts`.
- `NEXT_PUBLIC_BASE_PATH` — `/HKRTTrafficInfo` for static export; consumed in `app/traffic-monitor.tsx` (brand icon) and `app/traffic-map.tsx` (MapLibre worker URL).
- `.env.local` — exists (gitignored pattern `.env*`); contains a Vercel OIDC token created by the Vercel CLI (`VERCEL_OIDC_TOKEN`, value not reproduced here). No application secrets: all upstream APIs are keyless.
- Tool env set in code (`vite.config.ts`, `scripts/sites-env.mjs`): `CLOUDFLARE_CF_FETCH_ENABLED=false`, `WRANGLER_SEND_METRICS=false`, `WRANGLER_WRITE_LOGS=false`, `WRANGLER_LOG_PATH`, `WRANGLER_REGISTRY_PATH`, `MINIFLARE_REGISTRY_PATH`.
- Optional bindings: D1 `DB` / R2 `BUCKET` via `.openai/hosting.json` (both null).

### 6.2 CORS approach

The original seven layers request published sources from the browser using `lib/traffic-client.ts`. Hosted transit and infrastructure integrations use same-origin `app/api/` handlers. The GitHub Pages export omits these handlers and exposes the supported static features and hosted-only notices described in `README.md`.

### 6.3 Testing / validation

- `npm run verify` runs ESLint, TypeScript and the deterministic `tests/*.test.mts` suite. It is the first CI release gate.
- `npm run verify:browser` starts the local app and uses pinned Playwright/Chromium with intercepted feed fixtures for startup, desktop/mobile 2D/3D route controls, refresh recovery and geometry reconnect. It is the second CI gate; failures upload screenshots under `outputs/browser-smoke/`.
- `npm run verify:live` is an optional independent check against current official providers and a running hosted app. Provider availability and publication timing can affect its outcome.
- `npm run build`, `next build` and `npm run build:static` validate Worker, hosted Next.js and reduced static outputs respectively. Local verification results for this change are in `docs/review-implementation-2026-11-08.md`.

### 6.4 Deployment targets

1. **GitHub Pages** — `.github/workflows/deploy-pages.yml` builds and uploads the reduced static export after a successful `Verify`, with a manual dispatch for intentional rollback.
2. **Vercel** — `.github/workflows/deploy-vercel.yml` builds and publishes the hosted Next.js app after successful `Verify`.
3. **Cloudflare Worker** — `.github/workflows/deploy-cloudflare.yml` publishes the Vinext Worker bundle after successful `Verify`.

Each automatic target has a target-wide concurrency group and checks the verified commit against current `main` before publication, skipping superseded runs. A failed Verify run triggers no automatic deployment.

## 7. Known issues and limitations

1. **Release measurements remain outstanding.** The local browser gate uses deterministic fixtures; production provider latency, frame time, physical-device gestures and deployed-target smoke checks have not been measured for this review implementation.
2. **Optional database scaffold.** D1 schema and binding examples remain as an unused extension point; see §2.5 before adopting them.
3. **Source limits.** Enforcement layers list published junctions/housings rather than operational cameras. Snapshots are still images and HTTP 200 can carry a “No Service” JPEG. Incident pins are approximate ALS geocodes because the official notice lacks coordinates. Rainfall markers represent districts, not sensor positions.
4. **Geometry coverage.** Unmatched or ambiguous transit routes remain explicitly unavailable rather than being shown as accurate paths. ETA-derived vehicle positions are estimates rather than GPS.
5. **Search geography.** Road segments lack district metadata, so district filtering applies only to records that publish it.
6. **Runtime variation.** Windows local development uses Next.js while the Worker build uses Vinext; both build targets require validation for changes to shared behavior.

## Commuter layers and session restoration, 23 October 2026

Four additions are implemented: MTR buses/feeder buses, tram stops/routes/fares, accessible station facilities and local pedestrian connections, and taxi stands. The Nearby panel groups transport options within a selectable straight-line radius of the map centre. It loads eligible feeds independently of map switches and distinguishes current departures from published information. Both renderers share the layers, bilingual details and selection behavior. There are 20 hosted API routes, including `/api/mtr-bus` and `/api/pedestrian`.

Nearby includes saved category checkboxes and a **Show nearby on map** switch, initially off. Selected categories filter the list and radius-filtered overlay in both renderers independently of normal layer and rail-line choices. The overlay deduplicates overlapping markers and keeps feeds refreshing while the panel is closed. Turning it off preserves the list and normal layers. Bus-stop and ferry-pier visibility controls also apply to nearby markers. Rail results in the panel remain available when the main rail layer is off.

Local session state restores view, mode, camera, GPS preference, layers, selected route/place/route-stop detail, label/stop/pier controls, layer category, panels, intelligence tab, search and Nearby radius and categories. Basemap, language, topbar and rail filters retain their persistent stores. No arrival payloads, vehicle trajectories or images are saved. Restoring a route fetches current data while preserving the saved map position. Storage is local to a browser or installed app, without cross-device synchronization.

Refresh fixes reject malformed weather and operator rows, bound bus fallback ages, filter expired displayed arrivals, poll open 3D route-stop details, retry bad ferry bytes before the daily parsed-cache lifetime, and fetch journey-board locations/translations/details concurrently within a producer deadline. Valid empty boards remain valid. Brief failures retain trajectories only until their original expiry. See `docs/commuter-refresh-and-session-2026-10-23.md` for validation and limitations.


## Snapshot controls, building search and PWA, 6 November 2026

SnapshotImage now exposes independent auto-enhance and auto-contrast toggles, initially on, and a 1×/2× photo zoom control, initially 1×. A small luminance sample determines bounded exposure and contrast adjustments for each successful refresh. Disabling both restores the original image. The doubled photo scrolls within its viewport, keeping its controls reachable on mobile and in map popups.

The current Search panel adds a Buildings category, persisted with the existing search scope. The government Address Lookup Service returns English/Chinese names and addresses with validated Hong Kong coordinates. Requests are debounced, abort on query replacement/unmount, time out, and use a bounded memory cache. No results and failures have separate messages, and failures provide retry. Selection draws a separate approximate-location pin in either renderer, stops GPS following, and retains the pin when switching renderers. Building results do not enable or masquerade as a traffic layer. They are available in the static build too.

Production includes a scoped webmanifest and service worker, a bilingual offline recovery page, an in-app offline indicator, and an install section in Sources. Offline caching is deliberately limited to the recovery page and app icons. Live feeds, images, tiles and search requests remain network-based. Root and GitHub Pages base paths are supported; development does not register a worker. Keep `public/sw.js` cache version in step when changing cached offline assets. Next.js supplies worker cache headers, and `public/_headers` supplies the equivalent Cloudflare asset headers. GitHub Pages uses registration with `updateViaCache: none`.

See `docs/snapshots-building-search-pwa-2026-11-06.md` for verification.
