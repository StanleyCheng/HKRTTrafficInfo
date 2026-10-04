# HKRTTrafficInfo — Technical Specification

Engineering handover document. All claims cite repository files; uncertain items are marked [INFERENCE].

## 1. Overview

HKRTTrafficInfo (`package.json` name `hk-rt-traffic-info`, version 0.1.0) is a responsive bilingual (zh-HK / en-HK) single-page map application showing seven Hong Kong government open-data layers: red-light camera junctions, speed-enforcement camera housings, traffic snapshot stills, live road-segment speeds, traffic incidents, car-park vacancy, and district hourly rainfall (`README.md`, `lib/traffic.ts` `LayerKind`). No application authentication, no API keys, no mock/fallback datasets (`README.md`).

Live/deployed URLs (`README.md` "Live site"):
- GitHub Pages static export: `https://stanleycheng.github.io/HKRTTrafficInfo/` (served under the `/HKRTTrafficInfo` sub-path; see `next.config.ts` `basePath`).
- Vercel: `https://hkrttrafficinfo.vercel.app/` — standard Next.js build, auto-deployed from `main` (`.vercel/project.json` projectName `hkrttrafficinfo`).

i18n: two languages, `zh` (Traditional Chinese, default) and `en`, implemented as a hand-rolled message table `messages: Record<Language, AppMessages>` in `lib/i18n.ts` (~315 lines, typed keys, function-valued formatters). Language choice persists in `localStorage` key `hk-traffic-language-v1` via a `useSyncExternalStore` subscription with cross-tab `storage` events and an in-memory fallback when storage is unavailable (`app/traffic-monitor.tsx` `getLanguageSnapshot`/`subscribeLanguage`). Server snapshot is always `'zh'`; `<html lang>` is `zh-HK` statically (`app/layout.tsx`) and updated client-side on toggle. No next-i18n/library; `next-themes` is a dependency but unused by app code (only referenced inside vendored `components/ui/sonner.tsx`).

The app is also a PWA: `public/site.webmanifest` (name `香港實時交通資訊`, `display: standalone`, theme `#130f0a`), icons in `public/`, wired in `app/layout.tsx` metadata.

## 2. Technical framework

### 2.1 Toolchain versions (`package.json`)

- Runtime: Node `>=22.13.0` (`engines`); `"type": "module"`.
- Framework: `next` 16.3.4, `react`/`react-dom` 19.2.6.
- Build: `vinext` 1.0.0-beta.5 (Next.js-on-Vite adapter), `vite` 8.0.13, `@vitejs/plugin-react` 6.0.2, `@vitejs/plugin-rsc` 0.5.26, `react-server-dom-webpack` 19.2.6.
- Cloudflare: `@cloudflare/vite-plugin` 1.37.1, `wrangler` 4.92.0, `@cloudflare/workers-types` 4.20260515.1.
- Styling: `tailwindcss` 4.2.1 via `@tailwindcss/postcss` 4.2.1, `tw-animate-css` ^1.4.0; shadcn new-york style (`components.json`).
- Lint/types: `eslint` 9.39.4 + `eslint-config-next` 16.3.4, `typescript` 5.9.3.
- Overrides: `miniflare.sharp` pinned to 0.35.4 (`package.json` `overrides`).

### 2.2 package.json scripts

| Script | Command | What it does |
|---|---|---|
| `install:ci` | `node scripts/install-ci.mjs` | CI installer wrapper: requires npm, sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` unless sharp env is already set, branches on execution profile (managed-linux vs portable) (`scripts/install-ci.mjs`, companion `scripts/install-ci.sh`). |
| `prepare:maplibre` | `node scripts/prepare-maplibre-assets.mjs` | Copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` from `node_modules/maplibre-gl/dist` to `public/vendor/maplibre-gl/`; throws if missing. Output dir is gitignored (`.gitignore` `/public/vendor/maplibre-gl/`). |
| `predev` / `prebuild` / `prebuild:static` | `npm run prepare:maplibre` | npm pre-hooks ensuring the MapLibre worker assets exist before dev/build. |
| `dev` | `node scripts/run-framework.mjs dev` | Platform dispatch (`scripts/run-framework.mjs`): on Windows (`win32`) runs `next dev` directly (to avoid Vinext worker read failures on OneDrive-backed workspaces, per `README.md`); on `managed-linux` runs `vite dev`; otherwise runs `vinext dev`. Non-managed dev gets `--port 5173`. |
| `build` | `node scripts/run-framework.mjs build` | Same dispatch: `managed-linux` → `scripts/build-verified.sh` (runs `vinext build` under GNU `timeout`, default 3m); Windows/other → `vinext build`. |
| `build:static` | `node scripts/build-static.mjs` | GitHub Pages static export: if `app/api/` exists it is copied aside to `.api-backup-<pid>` and deleted for the build (dynamic route handlers are incompatible with `output: 'export'`; copy+delete used because OneDrive denies renames), then runs `next build` with `STATIC_EXPORT=1`, always restoring `app/api` on exit/signals. Output to `out/`. Note: `app/api/` does not currently exist, so the script just logs "no app/api directory". |
| `start` | `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 --inspector-port 0` | Previews the built Cloudflare Worker locally via Wrangler against `dist/server/wrangler.json` (produced by the Vinext build; `dist/` is gitignored and not currently present). `scripts/sites-env.mjs` redirects Wrangler/Miniflare state into `.sites-runtime/` and `chdir`s to the project root. |
| `lint` | `eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern public/vendor` | ESLint over the repo. |
| `typecheck` | `tsc --noEmit --pretty false --incremental false` | Type check; `examples/` excluded via `tsconfig.json`. |
| `test` | `node --experimental-strip-types --test tests/*.test.mts` | Node built-in test runner over `tests/traffic.test.mts`. |
| `verify` | `npm run lint && npm run typecheck && npm test` | Full local gate (also run in CI). |
| `verify:live` | `node --experimental-strip-types scripts/verify-live.mjs http://localhost:5173` | Live acceptance check against a running server — see §6.3. **Targets `/api/cameras/:kind` and `/api/snapshot/:id` routes that no longer exist in the tree** (§4.1). |
| `db:generate` | `drizzle-kit generate` | Generates SQL migrations into `drizzle/` from `db/schema.ts` (currently a no-op: schema is empty). |

### 2.3 Key dependencies and roles

| Dependency | Version | Role |
|---|---|---|
| `leaflet` | ^1.9.4 | Map engine; dynamically imported in `app/traffic-map.tsx`. |
| `leaflet.markercluster` | ^1.5.3 | Marker clustering (maxClusterRadius 42). |
| `@maplibre/maplibre-gl-leaflet` + `maplibre-gl` | ^0.1.4 / ^6.11.0 | Optional Positron vector basemap inside Leaflet; worker assets served from `public/vendor/maplibre-gl/`. |
| `fast-xml-parser` | ^5.11.1 | Parses XML upstreams (snapshot inventory, speed feeds, special traffic news, ALS) in both `lib/traffic-client.ts` and `lib/traffic-server.ts`. |
| `lucide-react` | ^1.31.0 | All UI icons. |
| shadcn stack (`radix-ui`, `@base-ui/react`, `@shadcn/react`, `cmdk`, `vaul`, `sonner`, etc.) | various | Vendored UI kit in `components/ui/` (55 files). **Only `tooltip` is actually imported by app code** (`app/traffic-monitor.tsx`); the rest is unused registry boilerplate. |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 | Optional D1 database access (§2.5); schema empty. |
| `clsx`, `tailwind-merge`, `class-variance-authority` | — | `lib/utils.ts` `cn()` helper for shadcn components. |
| `zod`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `date-fns`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels` | various | Present only to satisfy vendored `components/ui/` files; unused by app code. |

### 2.4 Config files

- `next.config.ts` — when `STATIC_EXPORT=1`: `output: 'export'`, `basePath: '/HKRTTrafficInfo'`, `assetPrefix: '/HKRTTrafficInfo/'`, `images.unoptimized`, `trailingSlash`, exposes `NEXT_PUBLIC_BASE_PATH`. Otherwise plain config (`agentRules: false`).
- `vite.config.ts` — Vinext production/dev pipeline: plugins `vinext()`, `sites({ mockAuth: false })` (vendored `build/sites-vite-plugin.ts`, from `@openai/sites-vite-plugin` 0.2.0 — local-auth middleware; disabled), and `cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] }, inspectorPort: false, config: localBindingConfig })`. `localBindingConfig` points the Worker entry at `vinext/server/fetch-handler`, sets `nodejs_compat`, and wires optional D1/R2 bindings from `.openai/hosting.json` (both currently `null`, with a placeholder database id). Sets Wrangler/Miniflare env vars (`.wrangler/` local state, metrics off). `managed-linux` profile binds `0.0.0.0`/`terminal.local`; macOS seatbelt sandbox switches to polling watch.
- `tsconfig.json` — strict, bundler resolution, path alias `@/* → ./*`, types `node` + `@cloudflare/workers-types`, excludes `examples/`.
- `eslint.config.mjs` — `eslint-config-next` core-web-vitals + typescript; relaxed rules for vendored `components/ui/**` and `hooks/use-mobile.ts` (vendored verbatim from shadcn@4.17.0 per comment).
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
| `app/` | Next.js app router root. `layout.tsx` (metadata/viewport/lang), `page.tsx` (renders `TrafficMonitor`), `traffic-monitor.tsx` (main client component, 658 lines), `traffic-map.tsx` (Leaflet map), `traffic-search.tsx` (search panel), `traffic-status.tsx` (freshness/legend block), `globals.css` (Tailwind 4 + Leaflet/markercluster/maplibre CSS imports + full app styling, 356 lines). **No `app/api/` directory exists.** |
| `components/ui/` | 55 vendored shadcn components; only `tooltip.tsx` used by the app. |
| `lib/` | `traffic.ts` (shared types, layer metadata, speed classification, freshness helpers, upstream URL constants); `traffic-client.ts` (browser data layer — the one actually used); `traffic-server.ts` (server-side mirror, currently unused); `traffic-parsing.ts` (CSV parser, CSDI PopupInfo HTML table parser, HK bounds check, period/route-number helpers); `traffic-view.ts` (stale-segment greying, segment→camera adapter, search); `i18n.ts` (zh/en message table); `utils.ts` (`cn`). |
| `hooks/` | `use-mobile.ts` — shadcn `useIsMobile` (768px breakpoint); unused by app code. |
| `db/`, `drizzle/` | Empty drizzle scaffolding + migration journal (§2.5). |
| `examples/d1/` | D1 reference route (broken import, §2.5). |
| `scripts/` | Build/dev/deploy helpers (§2.2), `verify-live.mjs` (§6.3), pnpm/install helpers for the Codex "Sites" managed environment (`install-pnpm.sh`, `pnpm-install.mjs`, `install-ci.*`, `sites-env.*`, `execution-profile.mjs`, `build-verified.sh`). |
| `tests/` | `traffic.test.mts` — unit tests (§6.3). |
| `public/` | PWA icons/manifest, `images/layers*.png` (Leaflet assets), `vendor/maplibre-gl/` (generated, gitignored). |
| `vendor/` | `shadcn-tailwind-4.13.0.css` + LICENSE — a shadcn Tailwind 4 theme CSS. **Not imported anywhere** (grep: no references); dead weight. |
| `build/` | `sites-vite-plugin.ts` + LICENSE — vendored Vite plugin used by `vite.config.ts`. |
| `.github/workflows/deploy.yml` | GitHub Pages CI (§6.4). |
| `.vercel/`, `.openai/` | Vercel project link and hosting config (§2.4). |

## 4. Architecture

### 4.1 Request flow — current tree (important for integrators)

The app has **no server routes**. `app/traffic-monitor.tsx` imports `getCameraData` from `@/lib/traffic-client` (line 8), which fetches every upstream government API **directly from the browser**; the file header states: "Browser-side data layer for the static (GitHub Pages) build… all upstream hosts send CORS allow headers" (`lib/traffic-client.ts:1-3`). A grep for route handlers (`export async function GET/POST`, `NextRequest`) finds matches only in `examples/d1`.

Git history shows this was recently changed: commit `a2e2267` ("Rename project to HKRTTrafficInfo…") **deleted** `app/api/cameras/[kind]/route.ts` and `app/api/snapshot/[id]/route.ts`, and git status is clean, so the deletion is committed. The deleted routes (from `git show a2e2267^:...`):

- `GET /api/cameras/[kind]` — validated `kind` against `kinds` (404 otherwise), called `getCameraData(kind)` from `lib/traffic-server.ts`, returned JSON with `Cache-Control: no-store`, 502 with the upstream error message on failure.
- `GET /api/snapshot/[id]` — proxied snapshot JPEGs: id validated against `/^[A-Z0-9_-]{2,30}$/` (400), looked up in the snapshot inventory (404), enforced an HTTPS host allowlist (`tdcctv.data.one.gov.hk` only, also after redirects), capped the stream at 10 MB via `TransformStream`, passed through `Last-Modified`, and added `X-Snapshot-Fetched-At` and `X-Content-Type-Options: nosniff`.

`lib/traffic-server.ts` (493 lines) is the server-side mirror those routes used and is **still in the tree but imported by nothing** (grep confirms). It differs from the client by: a manual redirect allowlist (`allowedRedirectHosts`, max 3 redirects), and an exported `officialFetch`. `scripts/build-static.mjs` still contains the machinery to move `app/api` aside during static export, and `scripts/verify-live.mjs` still targets `/api/cameras/:kind` and `/api/snapshot/:id` — i.e. **the repo is mid-cutover from a proxied architecture to browser-direct fetching, and README's "Local same-origin routes remove browser CORS limitations" paragraph is stale**.

Rendering model: the page is a full client component tree (`'use client'` at `traffic-monitor.tsx`, `traffic-map.tsx`, `traffic-status.tsx`, `traffic-search.tsx`). `app/page.tsx` and `app/layout.tsx` are server components, but all data fetching and interactivity happen client-side after hydration. Production builds: (a) `next build` static export → GitHub Pages; (b) plain `next build` → Vercel; (c) `vinext build` → Cloudflare Worker (`dist/server/wrangler.json`, entry `vinext/server/fetch-handler`) for local preview via `npm start`. Vinext's RSC environment (`rsc` + `ssr` child) is configured in `vite.config.ts`.

### 4.2 Caching

In-memory per-layer cache in `lib/traffic-client.ts` (identical pattern in `lib/traffic-server.ts`): `cached: Map<LayerKind, {expires, data}>` plus `pending: Map<LayerKind, Promise>` single-flight dedupe. TTLs (`cacheTtl`): redlight/speed/snapshot 300 000 ms (5 min), flow 90 000 ms, incident 120 000 ms, parking 180 000 ms, rainfall 600 000 ms. Road-segment geometry is cached separately for 24 h (`segmentGeometryTtl`) with its own single-flight refresh. Incident geocoding results are cached indefinitely in `geocodeCache` (`lib/traffic-client.ts`).

### 4.3 State management

Pure React state in `app/traffic-monitor.tsx`: `enabled` (per-layer on/off; defaults flow+incident on, rest off), `states: Record<LayerKind, LayerState>` (`data`/`loading`/`error`), `selectedSnapshot` (selected camera or `flow-segment-*` id), `showDetectors`, mobile panel state. Preferences (language, basemap, topbar/sidebar collapsed) use the `useSyncExternalStore` + localStorage pattern described in §1 (`hk-traffic-language-v1`, `hk-traffic-basemap-v1`, `hk-traffic-topbar-v1`, `hk-traffic-sidebar-v1`). Client polling (all gated on `document.visibilityState === 'visible'`): flow every 120 s, all other layers every 300 s, all layers refetched on visibility regain (`traffic-monitor.tsx` effect). Snapshot images refresh every 120 s plus on selection/visibility (`SnapshotImage`, 55 s fetch timeout). A 30 s `now` tick drives freshness re-evaluation.

### 4.4 Theming

No dark mode. Single light theme via CSS custom properties in `app/globals.css` (`color-scheme: light`). Per-layer colours in `lib/traffic.ts` `layers` (`#e15d69` redlight, `#d49b25` speed, `#318dbe` snapshot, `#1f9d63` flow, `#e8842c` incident, `#7b5fc9` parking, `#5a8fd6` rainfall) and `speedLevelColors` (free `#1f9d63`, moderate `#d49b25`, slow `#e15d69`, unknown `#8a9aa5`). Basemap toggle (OSM raster vs OpenFreeMap Positron vector) is a map-style switch, not a theme.

### 4.5 Map stack

`app/traffic-map.tsx`: Leaflet dynamically imported (with `leaflet.markercluster` side-effect import), map fixed to HK centre `[22.355, 114.13]` zoom 11, minZoom 10 / maxZoom 19. Markers are `divIcon`s with inline SVG glyphs per layer (rotation applied for flow detectors). Flow segments are canvas-rendered polylines (weight 4.8, selected 7.2). Basemaps: `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (maxZoom 19) or OpenFreeMap Positron via `maplibre-gl-leaflet` with style `https://tiles.openfreemap.org/styles/positron` and worker URL `<base>/vendor/maplibre-gl/maplibre-gl-worker.mjs`. Tile/style errors surface a retryable `map-error` overlay.

## 5. Data layers

All seven layers share the same pipeline: `TrafficMonitor.fetchLayer(kind)` → `getCameraData(kind)` (`lib/traffic-client.ts`) → upstream fetch/parse/validate → `CameraData` (`lib/traffic.ts`). Server route paths: **none in the current tree** (see §4.1); the deleted routes were `/api/cameras/<kind>` for every layer below and `/api/snapshot/<id>` for snapshot images. Client cache TTLs and error UI are uniform (§4.2, §5.8 pattern: per-layer `layer-error` block with retry button; previously displayed data retained with the "update failed" label — `layerUpdateFailed` vs `dataLoadFailed` in `lib/i18n.ts`).

### 5.1 Red-light camera junctions (`redlight`)

- **Function**: markers for junctions with red-light camera systems; details show Chinese/English site description, remarks, last-updated date.
- **UI**: layer card in `app/traffic-monitor.tsx` (Layers tab, desktop dock, mobile dock); marker SVG in `app/traffic-map.tsx` (`symbols.redlight`); detail note `copy.layerDetail.redlight` (`lib/i18n.ts`).
- **Client access**: `loadEnforcement('redlight')` in `lib/traffic-client.ts` (mirror: `lib/traffic-server.ts`).
- **Server route**: none (deleted `/api/cameras/redlight`).
- **Upstream**: CSDI FeatureServer layer 0, base URL built by `featureService('redlight')` (`lib/traffic.ts`): `https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1671693287017_1644/FeatureServer/0`, queried as `<base>/query?where=1%3D1&returnIdsOnly=true&f=json`, `<base>/query?where=1%3D1&returnCountOnly=true&f=json`, then `<base>/query?objectIds=…&outFields=*&returnGeometry=true&outSR=4326&f=json` in batches of 150. Format: Esri JSON. Publisher: Transport Department via CSDI; dataset page `https://data.gov.hk/tc-data/dataset/hk-td-tis_25-junctions-with-rlc`.
- **Refresh**: client polls every 300 s; cache TTL 300 s.
- **Parsing**: full ID inventory is cross-checked against the independent `returnCountOnly` total; each feature's `PopupInfo` HTML table is parsed by `popupFields()` (`lib/traffic-parsing.ts`) into `RLC_ID`, `SITE_DESC_CHI`, `SITE_DESC_ENG`, `REMARKS`, `LAST_UPD_DATE`; geometry x/y (WGS84). `validate()` enforces exact count, unique ids, non-empty names, coords within lat 22–23 / lng 113–115; any mismatch throws (layer fails loudly, no partial display).
- **Failure**: 20 s timeout, 1 retry (`officialFetch`); error → per-layer error state, stale data retained.
- **Gotchas**: dataset identifies published junctions, not operational cameras (`README.md` "Source limitations"); no bbox/nearest/first-page shortcuts — completeness verification is a hard requirement an integrator must preserve.

### 5.2 Speed-enforcement housings (`speed`)

- **Function**: markers for speed-camera housing locations (not cameras themselves).
- **UI**: same layer-card/marker/detail pattern (`symbols.speed` in `app/traffic-map.tsx`).
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

- **Function**: car-park markers with live private-car vacancy count, height limit, opening status, address.
- **UI**: markers (`symbols.parking`); detail live-figure vacancy, `heightLimitLabel`, `openingStatusLabel`, address as remarks.
- **Client access**: `loadParking()` (`lib/traffic-client.ts`).
- **Server route**: none (deleted `/api/cameras/parking`).
- **Upstream**: DATA.GOV.HK one-stop API, base `https://api.data.gov.hk/v1/carpark-info-vacancy`, three requests: `?data=info&lang=en_US`, `?data=info&lang=zh_HK` (optional, failure tolerated), `?data=vacancy&lang=en_US`. Format: JSON `{results: [...]}`. Dataset `https://data.gov.hk/en-data/dataset/hk-dpo-datagovhk1-carpark-info-vacancy`.
- **Refresh**: poll 300 s; TTL 180 s.
- **Parsing**: info rows filtered to HK bounds; joined to vacancy by `park_Id` (`privateCar[0]`); vacancy negative/missing → `null` (shown as "no live data", `parkingNoLive`); Chinese name/address preferred when present; `lastupdate` normalized `YYYY-MM-DD HH:mm:ss` → `+08:00` ISO; `heightLimits[0].height` numeric.
- **Failure**: empty/malformed English info feed → hard error; zh feed failure → English names retained.
- **Gotchas**: only `privateCar` vacancy is used; `opening_status` passed through raw (English feed values even in zh UI).

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

Current tree: none needed — the browser calls upstream hosts directly and the code comment asserts "all upstream hosts send CORS allow headers" (`lib/traffic-client.ts:3`). Previous architecture: same-origin proxy routes under `app/api/` (deleted, §4.1). An integrator merging server-side layers from another repo must decide which model wins; the static GitHub Pages deployment cannot support same-origin server routes.

### 6.3 Testing / validation

- `npm test` → `tests/traffic.test.mts`: 10 unit tests over pure functions — `speedLevel` bands (urban/major/invalid), `officialHongKongTimestamp` validation, `isLiveTrafficDataFresh` expiry/future tolerance, CSV/popup/route-number parsers, `pickLatestPeriod`, `displayFlowSegments` ageing to unknown, `searchTrafficItems` bilingual matching. No fixtures of live data.
- `npm run verify` = lint + typecheck + tests (run in CI before deploy).
- `npm run verify:live` → `scripts/verify-live.mjs` (header: "Independent acceptance check against live official inventories, never fixtures"). Compares the running app's `/api/cameras/{redlight,speed,snapshot,flow}` responses against independent official inventories — TD CSVs `https://www.td.gov.hk/datagovhk_td/junctions-with-rlc/resources/junctions_with_rlc.csv` and `https://www.td.gov.hk/datagovhk_td/locations-of-sec/resources/locations_of_sec.csv`, the snapshot XML, and `irnAvgSpeed-all.xml` (with ≤1 publication-interval skew tolerance); validates segment colour classification against HKeMobility WFS `https://www.hkemobility.gov.hk/api/drss/layer/map?service=WFS&version=1.0.0&request=GetFeature&typeName=DRSS%3AVW_IRN_AVG_SPEED_MAP&outputFormat=application%2Fjson&srsName=EPSG%3A4326&maxFeatures=5000` (≥90% of valid segments must match); fetches a real JPEG via `/api/snapshot/H106F` (JPEG magic bytes, `Last-Modified`, `X-Snapshot-Fetched-At`); checks 404/400 rejection of invalid routes. **As noted in §4.1 these routes no longer exist, so this script cannot pass against the current app** — it documents the intended contract for the proxy architecture. README records the last verified counts (2026-09-20): 230 red-light, 164 speed housings, 1 013 snapshots, 4 524 feed segments / 4 505 matched / 4 411 colour-matched.
- `.vercel/README.txt` present (deployment metadata).

### 6.4 Deployment targets

1. **GitHub Pages** — `.github/workflows/deploy.yml`: on push to `main` / dispatch → `npm ci` → `npm run verify` → `npm run build:static` → upload `out/` → `actions/deploy-pages`. This is the only CI in the repo.
2. **Vercel** — auto-deploy from `main` using `vercel.json` (plain `next build`), project linked in `.vercel/project.json`.
3. **Cloudflare Worker** — Vinext build (`npm run build` → `dist/server/wrangler.json`) previewed locally with `npm start` (Wrangler `--local`). No wrangler deploy script and no `wrangler.jsonc` at repo root; Worker deployment appears to be preview-only in-repo [INFERENCE].

## 7. Known issues and limitations

1. **Stale README / mid-cutover architecture**: README's "Local same-origin routes remove browser CORS limitations… Successful inventories are cached in memory for five minutes; manual reloads respect that server-side cache" describes the deleted `app/api/` proxy. Current app fetches upstream from the browser with a client-side cache of the same TTLs (§4.1, §4.2).
2. **`verify:live` is broken against the current app** — it requires `/api/cameras/:kind` and `/api/snapshot/:id` (§6.3).
3. **`lib/traffic-server.ts` is dead code** in the current tree (no importers) but is the ready-made server layer for re-introducing Worker/Next API routes.
4. **`scripts/build-static.mjs` app/api handling is currently inert** (no `app/api` directory) but will matter again if routes are restored.
5. **`examples/d1` is broken**: its route imports the deleted `examples/d1/db/schema.ts` (§2.5); excluded from typecheck so the breakage is invisible to `npm run verify`.
6. **Unused weight**: 54 of 55 `components/ui/` files, `hooks/use-mobile.ts`, most form/chart/carousel dependencies, and `vendor/shadcn-tailwind-4.13.0.css` are unused by the app.
7. **Upstream source limitations** (README "Source limitations", mirrored in UI notes): enforcement layers list published junctions/housings, not operational cameras or live feeds; speed housings exclude government tunnels/control areas; snapshots are periodically updated stills and individual cameras may serve an HTTP-200 "No Service" JPEG (availability cannot be inferred from HTTP status); incidents carry no official coordinates — pins are ALS-geocoded approximations; rainfall markers sit at curated district reference points, not gauges.
8. **Road segments lack district metadata**, so district search applies only to layers that publish it (README "Interface"; `searchTrafficItems` in `lib/traffic-view.ts`).
9. **Dev-server divergence on Windows**: `npm run dev` uses Next.js directly (Vinext worker read failures on OneDrive-backed workspaces, README), while production builds use Vinext — behaviour differences between dev and prod are possible.
10. **Snapshot image trust**: since the proxy deletion, image URLs from the XML inventory are fetched unvalidated by the browser (the deleted route enforced a host allowlist and 10 MB cap).
