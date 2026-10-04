# HKRTTrafficInfo — Integration Plan: absorbing HK Traffic Intelligence layers

Date: 2026-10-03
Source documents: `HKRTTrafficInfo/hkrttrafficinfo.md` (repo 1 spec), `hk-traffic-intelligence/hkrttrafficinfo.md` (repo 2 spec). All URLs, TTLs, and route paths below are quoted from those specs and were verified against code.

## 0. Locked decisions (from owner, 2026-10-03)

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Map stack | **Keep Leaflet** in repo 1. Port repo 2's data adapters, API routes, and intel engine (all map-agnostic); reimplement every new layer's map rendering as Leaflet markers/layers. No MapLibre migration. |
| D2 | Serving model | **Dual-mode everything.** Every new layer gets a same-origin `app/api/*` route (Cloudflare Worker / Vercel) AND a browser-direct adapter where CORS and upstream load allow. Static GitHub Pages export keeps working with whichever layers can run browser-direct; the rest are hidden with a notice in static mode. |
| D3 | Scope | **All four packs**: road intelligence, boundary + weather, rail, bus/ferry. Overlapping layers (cameras, traffic news, road speeds, rainfall) stay on repo 1's existing implementations. |
| D4 | Ticker | **Full intel panel** (marquee + expandable tabbed ranked panel) ported from repo 2, restyled to repo 1's light bilingual theme, with repo 1's existing layers included as scored inputs. |
| D5 | Languages | **zh-HK / en only.** No opencc-js, no zh-CN. All new strings hand-written into repo 1's `lib/i18n.ts` dictionary. |

## 1. Current-state findings that shape the plan

### Repo 1 (HKRTTrafficInfo) — facts
- **Mid-cutover architecture**: commit `a2e2267` deleted `app/api/cameras/[kind]` and `app/api/snapshot/[id]`; the browser now fetches all 7 layers directly (CORS-open government hosts). README's "same-origin routes" paragraph is stale.
- `lib/traffic-server.ts` (493 lines: redirect allowlist, 5-min cache, `officialFetch`) is dead code but is the ready-made server mirror for re-introducing routes.
- `scripts/verify-live.mjs` is **broken** — it targets the deleted `/api/*` routes.
- `scripts/build-static.mjs` still has the machinery to move `app/api` aside during static export — currently inert, becomes load-bearing again under D2.
- Layer registry: `lib/traffic.ts` (`LayerKind`, `layers` with per-layer colour/source, `CameraData`). All rendering in `app/traffic-map.tsx` (Leaflet `divIcon` markers, canvas polylines). State/polling in `app/traffic-monitor.tsx` (per-layer `enabled`/`states`, visibility-gated polling: flow 120 s, others 300 s). Bilingual dictionary: `lib/i18n.ts`.
- Theme: single light theme, CSS custom properties in `app/globals.css`; layer colours `#e15d69/#d49b25/#318dbe/#1f9d63/#e8842c/#7b5fc9/#5a8fd6`.
- Deployments: GitHub Pages (static, `NEXT_PUBLIC_BASE_PATH=/HKRTTrafficInfo`), Vercel (`next build`), Cloudflare Worker (Vinext build, local preview only — no deploy script).

### Repo 2 (HK Traffic Intelligence) — facts relevant to porting
- Server model: `src/app/api/*/route.ts` handlers, `export const dynamic = "force-dynamic"`, responses shaped `{ ok, ... }`.
- Shared edge cache: `src/lib/upstream.ts` `fetchUpstream(url, ttlMs)` = in-isolate memory + Cloudflare Cache API (`caches.default`), **deliberately bypassing Vinext's fetch cache** via `Symbol.for('vinext.fetchCache.originalFetch')` to avoid a documented deadlock. This helper is the single most important file to port correctly.
- Viewport-scoped feeds (`src/lib/view-cache.ts` `viewCachedGet`): KMB/Citybus zoom ≥ 13, GMB zoom ≥ 17, NLB only inside Lantau box (lng 113.8–114.05, lat 22.18–22.34), cache keys on rounded centre.
- MTR protection: 429 → 45 s global backoff; 16-station line-fair refresh slice, 4 concurrent; cross-isolate memory book at Cache API key `https://hktraffic-cache.invalid/mtr-board-memory`.
- `pngjs` is declared but never imported; `/api/dem` + `terrain-tile.ts` are dormant — **excluded from this plan**.
- README "KMB/LWB ~30 s" is stale docs; code says 60 s everywhere.

### Overlap matrix — what is actually new

| Repo 2 layer | Repo 1 status | Action |
| --- | --- | --- |
| Strategic-road speeds/grades + saturation WFS | **Have** (`flow`, same `irnAvgSpeed-all.xml`) | Keep repo 1's. Optionally surface repo 2's `ROAD_SATURATION_LEVEL` grade on segment details (P1, small). |
| Smart-lamppost detectors (SLP CSV/XML) | Missing | **Port** into `flow` as detector points (repo 1 already renders detector points). |
| Harbour-crossing journey times (`/api/approaches`) | Missing | **Port** (new layer `crossing`). |
| Traffic cameras (`/api/picture` + `/api/camera`) | **Have** (`snapshot`, same tdcctv source) | Keep repo 1's. Do not port `/api/camera`; repo 1's snapshot detail view already embeds images. |
| Road works (WFS `DRSS:VW_ROAD_WORK_*`) | Missing | **Port** (new layer `works`). |
| Toll points (WFS `DRSS:DRSS_TOLL_POINT`) | Missing | **Port** (new layer `toll`). |
| Special traffic news (`/api/incidents`) | **Have** (`incident`, same feed, ALS-geocoded — better placement than repo 2's road-name matching) | Keep repo 1's. Feed repo 1 incidents into the ticker. |
| Land boundary control points (`/api/control-points`) | Missing | **Port** (new layer `boundary`). |
| MTR next train (`/api/mtr`) | Missing | **Port** (new layer `mtr`). Server-only (see §4.8). |
| Light Rail (`/api/lrt`) | Missing | **Port** (new layer `lrt`). Server-only. |
| KMB/LWB ETA (`/api/kmb[+places]`) | Missing | **Port** (new layer `kmb`). |
| Citybus ETA (`/api/citybus[+places]`) | Missing | **Port** (new layer `citybus`). |
| GMB ETA (`/api/gmb[+places]`) | Missing | **Port** (new layer `gmb`). |
| NLB ETA (`/api/nlb[+places]`) | Missing | **Port** (new layer `nlb`). |
| Ferries ×4 (`/api/ferry`) | Missing | **Port** (new layer `ferry`). Server-only (HTML scrape leg). |
| HKO warnings (`warnsum`) | Missing (repo 1 has rainfall via `rhrread` only) | **Port** warnings into a new `weather-warning` layer + ticker input; keep repo 1 rainfall layer as-is. |
| Basemaps (OpenFreeMap bright/liberty, Esri satellite) | Have OSM raster + Positron | Optional add-on: Esri satellite basemap entry (browser-direct, no server). P5 nice-to-have. |
| DEM terrain | Dormant in repo 2 | **Exclude**. |
| Ticker / intel panel | Missing | **Port** (D4). |

## 2. Target architecture

```
Browser (Leaflet app, repo 1 shell)
 ├─ Worker/Vercel mode: fetch same-origin /api/<feed>  ──► app/api/<feed>/route.ts
 │                                                          └─ lib/upstream.ts (TTL + single-flight + Cache API)
 │                                                             └─ upstream government/operator APIs
 └─ Static (GitHub Pages) mode: browser-direct adapters lib/<feed>-direct.ts
    for CORS-open, low-rate feeds only; other layers hidden + notice
```

### 2.1 Files to port from repo 2 (adapted, not copied blindly)

| Repo 2 source | Repo 1 destination | Notes |
| --- | --- | --- |
| `src/lib/upstream.ts` | `lib/upstream.ts` | Keep the `vinext.fetchCache.originalFetch` bypass and `caches.default` usage; add a plain-memory fallback when `caches.default` is undefined (Vercel/plain next build, static dev). |
| `src/lib/view-cache.ts` | `lib/view-cache.ts` | Viewport-keyed cache for KMB/GMB/Citybus/NLB routes. |
| `src/lib/intel.ts` (+ `intel.test.ts`) | `lib/intel.ts` (+ `tests/intel.test.mts`) | Pure scoring engine; adapt input types to repo 1 feeds (§5). Convert tests to repo 1's `node --test *.test.mts` convention. |
| `src/lib/approaches.ts`, `crossings.ts` | `lib/crossings.ts` | Journey-time parsing + best-crossing pills. |
| `src/lib/picture.ts` (works/tolls parts only), `works-chinese.ts` | `lib/works.ts`, `lib/tolls.ts`, `lib/works-chinese.ts` | WFS parsers; drop camera parts (repo 1 has its own). |
| `src/lib/control-points.ts` | `lib/boundary.ts` | ImmD queue parsing + hardcoded point coordinates. |
| `src/lib/warnings.ts` | `lib/weather-warnings.ts` | `parseWarnsum`/`classify`/`weatherBar`; strip zh-CN `SHORT_NAME` table (D5). |
| `src/lib/mtr-schedule.ts`, `mtr-network.ts`, `mtr-run.ts`, `mtr-estimate.ts` | `lib/mtr-*.ts` | Schedule parsing, bundled network, train interpolation. |
| `src/lib/lrt-network.ts` + LRT parts of schedule lib | `lib/lrt-*.ts` | |
| `src/lib/kmb-catalogue.ts`, `kmb-routes.ts`, `place-arrivals.ts`, `arrival-pairs.ts`, `stop-plate.ts` | `lib/kmb-*.ts`, `lib/stop-plate.ts` | Shared by KMB/Citybus/GMB/NLB arrival pattern. |
| `src/lib/citybus-feed.ts`, `gmb-feed.ts`, `gmb-reach.ts`, `nlb-feed.ts`, `nlb-clock.ts` | `lib/citybus-feed.ts` etc. | |
| `src/lib/ferry-feed.ts`, `ferry-routes.ts`, `ferry-clock.ts`, `ferry-run.ts`, `fortune-timetable.ts` | `lib/ferry-*.ts` | 4 operators, 4 formats. |
| `data/*.json` (mtr-network, light-rail-routes/stations, kmb-network, kmb-routes, lwb-routes, citybus-network, gmb-network, nlb-network, ferry-piers) | `data/` (new dir in repo 1) | Bundled catalogues; KMB catalogue hot-swap refresh (24 h) comes with `kmb-catalogue.ts`. |

### 2.2 New/changed files in repo 1

| File | Change |
| --- | --- |
| `lib/upstream.ts`, `lib/view-cache.ts` | **New** (ported, §2.1). |
| `app/api/<feed>/route.ts` × 11 | **New**: `approaches`, `works`, `tolls`, `control-points`, `warnings`, `mtr`, `lrt`, `kmb`, `kmb/places`, `citybus`, `citybus/places`, `gmb`, `gmb/places`, `nlb`, `nlb/places`, `ferry`. All `force-dynamic`, `{ ok }` envelope, stale-on-failure. (Also restores the deleted-route pattern, so `verify-live.mjs` works again — see §6 Phase 0.) |
| `lib/traffic.ts` | Extend `LayerKind` + `layers` registry: `crossing`, `works`, `toll`, `boundary`, `weather-warning`, `mtr`, `lrt`, `kmb`, `citybus`, `gmb`, `nlb`, `ferry`. Proposed colours (repo 1 palette family): crossing `#c0392b`, works `#b57708`, toll `#6b7a8d`, boundary `#8e44ad`, weather-warning `#2e6da4`, mtr `#d43d2a`, lrt `#8a6d3b`, kmb `#c0392b`→use operator-neutral `#a33e1f`, citybus `#e6a817`, gmb `#2f8f5b`, nlb `#3b6ea5`, ferry `#1f7a8c`. Smart-lamppost detectors fold into existing `flow`. |
| `app/traffic-map.tsx` | Leaflet renderers per new layer (§3). |
| `app/traffic-monitor.tsx` | Layer state/polling for 12 new kinds; viewport-gated fetching for bus/GMB/NLB (map `moveend` → refetch with current centre/zoom); static-mode hiding. |
| `app/intel-panel.tsx` + `app/intel-panel.css` (or globals) | **New** ticker/panel UI (§5). |
| `app/traffic-status.tsx` | Surface new feed ages/failures in the info block (existing pattern). |
| `app/traffic-search.tsx` | Include new layer items (stops, stations, piers, control points) in bilingual search. |
| `lib/i18n.ts` | All new strings, zh-HK + en (D5). HKO lang param: zh-HK→`tc`, en→`en` only. |
| `scripts/verify-live.mjs` | Fix existing targets (P0); extend per pack (§6). |
| `scripts/build-static.mjs` | Verify the `app/api` move-aside machinery works again; static build must define which layers are static-capable (§4). |
| `README.md` | Update sources table, layer list, stale "same-origin routes" paragraph becomes true again. |
| `tests/*.test.mts` | Port `intel.test.ts`; add parser tests for works/tolls/boundary/warnings/ferry-clock/mtr-schedule (pure functions only). |

## 3. Leaflet renderer approach per new layer (D1)

All renderers follow repo 1's existing patterns: `divIcon` markers with inline SVG glyphs (like current layers), canvas polylines for linear features (like `flow`), `leaflet.markercluster` for dense point sets.

| Layer | Renderer |
| --- | --- |
| `crossing` | 9 journey-time board markers (divIcon with minutes + RAG colour from feed `cid`); header pills CH/EH/WH in the intel panel (§5). |
| `works` | Point markers, amber (preparation) / red-ish (in progress); popup with road, lane, bound, times, district. Clustered. |
| `toll` | Point markers at 4 toll plazas; `portal` vs `overview` scale → two zoom-dependent display modes (repo 1 already does zoom-dependent symbol size for snapshots). |
| SLP detectors | Extend existing `flow` detector rendering (`showDetectors`) with SLP points from `rawSpeedVol_SLP-all.xml`. |
| `boundary` | 8 control-point markers; popup = hall queue table (resident/visitor × arrival/departure) + approach-road speed joined from `flow` data (port `decorateControlPoints`, road needles per code). |
| `weather-warning` | No map markers — feeds the intel panel + status block (warnings are territory-wide). Keep rainfall markers as-is. |
| `mtr` | Line polylines from `data/mtr-network.json` (canvas, like flow segments); station markers; animated train markers via `L.marker` positions stepped on a 1 s timer from `estimateTrains` — replaces repo 2's MapLibre symbol-layer animation. Cluster stations off. |
| `lrt` | Same pattern, Tuen Mun/Yuen Long/Tin Shui Wai. |
| `kmb`/`citybus`/`gmb`/`nlb` | Stop markers (clustered; stop-plate labels at zoom ≥ 16.5 via divIcon text — port `stop-plate.ts`). Popup = up to 12 arrival calls. Viewport-gated (§4). |
| `ferry` | Pier markers + vessel markers interpolated along fairway paths (`ferry-run.ts` is pure geometry — ports cleanly; animate with `L.marker` + timer). Sun Ferry live GPS used when present. |

## 4. Dual-mode classification per feed (D2)

"Direct?" = browser-direct adapter planned. Verification step in Phase 0 confirms CORS headers with a probe script; any surprise flips that feed to server-only.

| Feed | Upstream host(s) | Direct? | Reason |
| --- | --- | --- | --- |
| `approaches` | `www.hkemobility.gov.hk` (WFS + `getTextInfo`, sends explicit `Referer` server-side) | **No (server-only)** | Referer-sensitive; repo 2 sets it explicitly — likely rejects foreign/no referer. Probe anyway. |
| `works`, `tolls` | `www.hkemobility.gov.hk` WFS | **No (server-only)** | Same. |
| SLP detectors | `static.data.gov.hk` + `resource.data.one.gov.hk` | **Yes** | Same hosts repo 1 already fetches browser-direct for `flow`. |
| `control-points` | `secure1.info.gov.hk` | **Verify** (likely yes — plain JSON GET) | Probe CORS in P0. |
| `warnings` | `data.weather.gov.hk` | **Yes** | Repo 1 rainfall already uses it browser-direct. |
| `mtr` | `rt.data.gov.hk` | **No (server-only)** | Even if CORS-open: per-client 120-station polling would trip the documented 429 rate limit; the shared edge cache is the whole point. |
| `lrt` | `rt.data.gov.hk` | **No (server-only)** | Same rate/sharing argument. |
| `kmb` | `data.etabus.gov.hk` | **Verify** (historically CORS-open) | If yes, dual-mode with 60 s poll + viewport gating; static-mode users share no cache, acceptable load (≤40 stops × 1 req/60 s per client). |
| `citybus` | `rt.data.gov.hk` | **Verify** | Same host family as MTR but per-stop+route ETA calls are light (≤24 pairs/60 s). Probe CORS; decide. |
| `gmb` | `data.etagmb.gov.hk` | **Verify** (designed for third-party apps) | Probe CORS. |
| `nlb` | `rt.data.gov.hk` | **Verify** | As citybus. |
| `ferry` | `www.sunferry.com.hk`, `www.hkkfeta.com`, `www.starferry.com.hk`, `www.fortuneferry.com.hk` | **No (server-only)** | Fortune Ferry is an HTML scrape; mixed private-host CORS unknown; CSV/JSON parsing centralized. |

Static-mode UX for server-only layers: layer toggle disabled with a bilingual note ("This layer needs the full hosted version" / 「此圖層需使用完整託管版本」) linking to the Vercel/Worker deployment. The toggle list is driven by a per-layer `serverOnly` flag in `lib/traffic.ts`.

## 5. Ticker / intel panel integration (D4)

**Port**: `lib/intel.ts` (pure, no I/O) + ticker JSX from repo 2 `ops-hud.tsx` (`IntelMarquee`, `IntelRow`, tab bar) + marquee CSS (`@keyframes intel-marquee`, hover-pause, `prefers-reduced-motion` → disable + hide duplicate).

**New file** `app/intel-panel.tsx`, rendered by `TrafficMonitor`:
- **Collapsed**: marquee strip fixed at map bottom (`position:absolute; inset-x:0; bottom:<above mobile layer strip>`), z-index below workbench/sheet. Duration `max(28, n×9)` s, list rendered twice for seamless loop, second copy `aria-hidden`.
- **Expanded**: floating card bottom-right on desktop (`w:min(22rem, 100%-1.5rem)`), full-width sheet on mobile (reuse repo 1's sheet pattern: arrow-key tabs, Escape closes + restores focus, selection preserved).
- Tabs: `ranked | roads | boundary | weather | systems | notes`; red dot on tabs containing urgent items; roving tabindex.
- Click item with coordinates → repo 1's existing "select + fly to" path (extend `selectedSnapshot` mechanism to generic `selectedItem`).

**Inputs** (`IntelInput` adapted; repo 1 sources in **bold**):
- **repo 1 `incident` layer** (ALS-geocoded) → incident items, `800 000 − index`.
- **repo 1 `flow`** → jam items from congested segments (score `400 000 + (30−speed)·1000 + lengthKm·10`), plus saturation grade when P1 adds it.
- **repo 1 layer failures/stale states** → fault items (repo 2's ladder: speed 1 000 000, incidents 640 000, …). Map repo 1's per-layer `error` states onto this.
- New: `crossing` (red 600 000+min), `works` (in progress 250 000), `boundary` (very busy hall 750 000), `weather-warning` (score from `classify`), transit feed faults (mtr 400 000, kmb 390 000, lrt 380 000, citybus 370 000, gmb 360 000, nlb 350 000, ferry 340 000).
- Ranked tab: concat + `byScore`, top 12 (`RANKED_LIMIT`).

**Styling** (repo 1 language): light card (`background: var(--card)` / white, `border: var(--border)`, existing shadow scale), system font (not IBM Plex Mono), tone colours aligned to repo 1 semantics: red `#e15d69`, amber `#d49b25`, green `#1f9d63`, none `#8a9aa5`. All strings via `lib/i18n.ts` (zh-HK/en).

## 6. Phasing

Each phase ends green on `npm run verify` (lint + typecheck + unit tests) plus its acceptance check. No phase ships dead toggles.

### Phase 0 — Infrastructure (no new user-visible layers)
1. Port `lib/upstream.ts` + `lib/view-cache.ts` with non-Worker fallback; unit-test TTL/single-flight/stale behaviour.
2. CORS probe script (`scripts/probe-cors.mjs`) hitting every §4 "Verify" host; record results in this plan as an amendment; finalize direct/server-only flags.
3. Restore `app/api` pattern: one health route + the move-aside check in `build-static.mjs`; prove static export still builds with routes present.
4. Fix `scripts/verify-live.mjs` for the current tree (it is broken today): point it at the restored routes or at the client data path; document which.
5. Port `lib/intel.ts` + tests, and `data/` directory scaffold.
**Acceptance**: `npm run verify` green; `build:static` green; probe results recorded; intel engine unit-tested.

### Phase 1 — Road intelligence pack + ticker shell
Layers: `crossing` (`/api/approaches`), `works`, `toll` (`/api/works`, `/api/tolls` or a combined `/api/picture` port — recommend split routes for independent failure), SLP detectors into `flow`; optional saturation grade on flow segments.
Ticker: `app/intel-panel.tsx` wired with Phase-0 intel engine; inputs = repo 1 incidents + flow + new works/crossing/boundary-absent stubs.
**Acceptance**: live smoke — boards show minutes with feed colours; works markers match HKeMobility list; ticker marquee scrolls, expands, keyboard-navigable, bilingual; static build hides the three server-only layers with notice.

### Phase 2 — Boundary + weather pack
Layers: `boundary` (`/api/control-points`, ImmD JSONs), `weather-warning` (`/api/warnings`, warnsum; `rhrread` already in repo 1 rainfall — share the fetch via upstream cache, don't duplicate).
Ticker: boundary + weather tabs fully populated; header pills (boundary glance, weather bar) added to repo 1 top bar or intel panel header.
**Acceptance**: 8 control points with hall tables; warnings appear in UI language; ticker ordering matches score ladder.

### Phase 3 — Rail pack
Layers: `mtr` (`/api/mtr` + `data/mtr-network.json`), `lrt` (`/api/lrt` + `data/light-rail-*.json`); 15 s polling only when layer enabled; train animation timer paused when tab hidden (repo 1 visibility convention).
**Acceptance**: trains interpolate along tracks; station popups show dest/platform/ttnt/delay; 429 backoff verified by simulation test (port repo 2's approach, not by hammering the live feed); server-only notice in static build.

### Phase 4 — Bus/ferry pack
Layers: `kmb`, `citybus`, `gmb`, `nlb` (viewport-gated: zoom ≥13, GMB ≥17, NLB Lantau box — gates enforced client AND server side) + `ferry` (4 operators).
Search: stops/stations/piers into `searchTrafficItems`.
**Acceptance**: stop popups show live ETAs with scheduled flags; viewport move refetches within cache rules; NLB inert outside Lantau; ferry boards show next sailings incl. Fortune Ferry scrape; vessels animate.

### Phase 5 — Hardening & docs
- Extend `verify-live.mjs` per pack (approaches boards vs WFS count; control points vs ImmD JSON; warnings shape; MTR sample station; KMB sample stop).
- Optional: Esri satellite basemap toggle (browser-direct, cheap win).
- README rewrite (sources table, layer list, architecture paragraph, static-mode limitation note).
- Cleanup: delete `examples/d1` (broken), decide `lib/traffic-server.ts` fate (superseded by new routes — likely delete), trim unused `components/ui` if desired (separate commit).

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| CORS assumptions wrong on "Verify" feeds | Phase-0 probe script before any adapter is written; fallback is always the server route (already built). |
| MTR 429 rate limiting | Server-only + port the 45 s backoff, 16-station slice, shared memory book unchanged. Never browser-direct. |
| Fortune Ferry HTML scrape breaks silently | Parser validates ≥1 clock extracted, else explicit error surfaced in ticker as feed fault; unit test with recorded HTML fixture. |
| Browser-direct KMB load from many static clients | 60 s poll + viewport gating + 40-stop cap preserved; etabus is a high-volume public API; monitor via ticker fault rate. |
| Static/Worker behaviour drift | Per-layer `serverOnly` flag drives both toggle UI and search inclusion; CI builds both targets (existing deploy.yml + add a vinext build check). |
| `build-static.mjs` move-aside machinery bit-rot | Phase-0 builds static with routes present — proves the path before 16 routes depend on it. |
| Vinext/Cache API deadlock (repo 2 documented) | Port the `originalFetch` bypass verbatim; add a code comment + test that `fetchUpstream` never routes through Vinext's cached fetch. |
| 12 new layers overload the mobile layer strip | Layer strip groups: existing 7 + new "Traffic" (crossing/works/toll), "Boundary", "Transport" (mtr/lrt/bus/ferry) groups — exact UX to be confirmed in Phase 1 implementation. |
| Windows dev divergence (README #9) | Verify each phase on `npm run dev` (next) AND `npm start` (worker preview) before closing. |
| i18n string volume (~200 new keys) | Translate per phase, not in one batch; `lib/i18n.ts` typed dictionary catches missing keys at typecheck. |

## 8. Validation strategy

- **Unit** (`tests/*.test.mts`): intel engine (ported), works/tolls/boundary/warnings parsers, ferry-clock, mtr-schedule, view-cache keys, `serverOnly` flag logic. Follow repo 1's existing pure-function style.
- **Live** (`verify-live.mjs`): fixed in P0, extended per phase; compares app output against independent official inventories (never fixtures) — same philosophy as the existing checks.
- **Smoke per phase**: run `npm run dev`, exercise toggles/popups/search/ticker on desktop + mobile viewport; then `npm start` worker preview for the `/api` path; then `build:static` for the reduced static build.
- **Regression**: repo 1's 7 existing layers must remain byte-identical in behaviour — their data path is untouched until Phase 5 cleanup.

## 9. Out of scope (explicit)

- DEM terrain (`/api/dem`, `terrain-tile.ts`, `pngjs`) — dormant in repo 2.
- zh-CN / opencc-js (D5).
- MapLibre GL migration (D1).
- Repo 2's dark HUD visual language, IBM Plex Mono, flyover camera, 3D buildings basemap.
- Cloudflare Worker production deploy plumbing (repo 1 currently previews only) — separate ops decision.
