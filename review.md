# HKRTTrafficInfo review and improvement plan

> **Implementation update, 8 November 2026:** The user subsequently requested implementation of this plan. The review below remains the baseline evidence and proposal, so its planning-only statements describe the original review session. Current changes, validation and remaining limits are recorded in [the implementation record](docs/review-implementation-2026-11-08.md). A commit, push and deployment were requested after that record was written.

Reviewed on **8 November 2026 (Hong Kong time)** against commit **`82f2f5c`**. The working tree was clean when the review began.

**Original review scope: planning only.** At the time of this review, this report was the only repository change; no application code, dependencies, tests, configuration or deployment settings had been changed. The later implementation is recorded in the linked update above.

The app has a substantial reliability foundation. The best next step is a focused set of fixes for freshness, request prioritization, rendering work, and release verification. A rewrite is not warranted by this review. Faster polling everywhere would increase load without necessarily improving source accuracy.

## Evidence and limits

| Check | Result |
| --- | --- |
| Current source review | Reviewed the monitor, both map renderers, arrival/route hooks, feed adapters and caches, API handlers, search, snapshots, Nearby, PWA, dependencies and deployment workflows. |
| `npm run verify` | **Passed:** ESLint, TypeScript and **251 deterministic tests**; zero failures or skipped tests. |
| Impeccable source detector | Returned no findings for the nine inspected UI/CSS targets. This does not establish accessibility or performance compliance. |
| Local browser smoke check | The local development app rendered in 2D at narrow and desktop sizes; Map layers opened and closed with Escape; switching to 3D rendered successfully. Inspected 320 × 568 and 1440 × 900 viewports, plus the initial approximately 484 × 763 viewport. Vehicle-label overlap was visible in the territory overview. |
| Not performed | Production builds, the full browser regression suite, physical-device/touch tests, screen-reader audit, load testing, measured frame-time/bundle benchmarks, or independent reconciliation of every live provider response. |

The browser check used live network responses, but was not a provider-availability or latency benchmark. Source findings below describe reproducible code paths; deployment races and performance consequences are identified as risks where they were not reproduced. File references use repository-relative paths and line numbers at the reviewed commit.

## Overall assessment

**Implementation integrity: pass for a coherent traffic-map product, with targeted corrections needed.** The bilingual controls, map-layer organization, source explanations and two renderers form a consistent interface. Dense overview labels and inconsistent freshness presentation weaken that consistency. The automated design detector found no mechanical issues; the manual review found behavior it does not test.

The provisional Impeccable assessment is **14/20 — Good, with weak dimensions to address**. These are review scores, not measured service levels or a WCAG certification.

| Dimension | Score | Assessment |
| --- | --- | --- |
| Accessibility | 3/4 | Explicit control labels, focus handling and reduced-motion behavior exist. Full assistive-technology and text-zoom verification remains outstanding. |
| Performance | 2/4 | Bounded requests and lazy map loading help; unnecessary geometry replacement and offscreen vehicle work remain. |
| Theming | 3/4 | An intentional light theme and shared tokens exist; repeated literal colors and UI styles remain consolidation candidates. Dark mode is not a requirement of this review. |
| Responsive design | 3/4 | Main controls and panel layout adapt to small viewports; overlapping vehicle labels impair overview readability. Actual touch gestures remain untested. |
| Implementation integrity | 3/4 | Product-specific behavior is well developed, with gaps in freshness labels and substantial unused UI scaffolding. |

There are **12 prioritized action items: one P1 and eleven P2**. This includes confirmed defects, verification gaps and explicitly identified improvement opportunities. No P0 blocker was identified within this review's scope. P1 means address the release risk first; P2 means a targeted follow-up, generally with an existing workaround or bounded impact.

## Prioritized findings

### R1 — P1: Production publishing is not ordered across different commits

**Evidence:** `.github/workflows/deploy-vercel.yml:18–20`, `.github/workflows/deploy-cloudflare.yml:20–22`, and `.github/workflows/deploy-pages.yml:24–26` use concurrency groups containing the triggering SHA. They check out that SHA, but have no final check that it is still the intended production revision.

**Trigger and impact:** Two revisions can pass verification and enter separate deployment groups. A slower older deployment can publish after a newer one, creating an unintended rollback. This is a configuration-supported race, not an observed production incident.

**Plan:** Serialize publishing per production target and reject superseded revisions immediately before promotion. Define the eligibility rule explicitly, preserving intentional rollback as a separate operation; do not rely on job queue order alone.

**Acceptance:** Delay an older revision while a newer revision completes. Confirm the older revision cannot replace the intended production revision on any target. Failed verification must still prevent automatic deployment.

### R2 — P2: Tram requests do not distinguish map areas or the ETA zoom threshold

**Evidence:** `lib/integration-client.ts:20–28` returns the same empty request key for every tram viewport. `lib/commuter-client.ts:30–32` sends viewport coordinates to the API, and `lib/tram-feed.ts:47–51` loads at most 12 stops within 2.5 km at zoom 13 or higher. The request guard at `app/traffic-monitor.tsx:455–466` depends on that key.

**Trigger and impact:** Pan to another district, or zoom from the overview into tram coverage while an earlier request is pending. The old-area response still passes the current-request check, and the new area can wait for the normal refresh interval. The underlying observations are not fabricated, but they are not the observations the user has just requested.

**Plan:** Include a suitably rounded tram viewport and the coverage threshold in its request identity. Cancel obsolete consumers without disrupting valid shared producer work.

**Acceptance:** Cover zoom 11 → 13, a long pan during a slow response, and rapid navigation back and forth. An obsolete response must not replace the current area's results; tiny movements should not cause a request storm.

### R3 — P2: Missing incident publication times are replaced with the current time

**Evidence:** `lib/traffic-client.ts:301–304` substitutes `new Date().toISOString()` when `ReferenceDate` is missing or unparseable. Lines 330–346 put it into the notice and camera update fields. `lib/intel.ts:35` uses the time for ordering; `app/traffic-monitor.tsx:884` displays it.

**Trigger and impact:** An unchanged incident with an unknown source timestamp appears newly updated after each retrieval and can outrank correctly dated notices. This undermines the distinction between “retrieved now” and “published now.”

**Plan:** Represent unknown publication time explicitly. Keep retrieval and source timestamps separate, validate actual calendar values, and define stable ordering for undated notices.

**Acceptance:** Test absent/malformed timestamps, valid morning/afternoon timestamps, invalid dates and repeated unchanged bulletins. Retrieval must never create a source update time or imply that an undated notice is the newest.

### R4 — P2: Original feeds poll without regard to demand, while some active feeds wait too long

**Evidence:** `app/traffic-monitor.tsx:408–428` fetches all seven original layers on mount, resume and reconnect. Flow polls every 120 seconds; all other original layers share a 300-second timer. `lib/traffic-client.ts:485` separately sets incident cache TTL to 120 seconds, parking to 180 seconds and rainfall to 600 seconds. `fetchLayer` has no offline guard.

**Trigger and impact:** Hidden, unneeded inventories still cause request/cache/parse/state work. Conversely, an active incident or parking layer normally waits five minutes for its timer even when its cache has expired. A cache TTL is not a refresh schedule. Cached calls may avoid network traffic, so do not count every scheduler invocation as an upstream request.

**Plan:** Define demand and cadence per feed, accounting for map layers, search, Nearby and intelligence consumers. Pause unneeded work, respect visibility/offline state, and use independent bounded retry policies. Preserve complete official inventories when they are requested.

**Acceptance:** With a fake clock and request counters, verify consumer activation, deactivation, backgrounding, offline operation and reconnect. Active incident/parking refreshes follow their chosen cadence; reconnect coalesces requests; unneeded feeds remain idle. Validate cadence against actual publisher updates and limits before tuning it.

### R5 — P2 improvement: Selected rail stations cannot jump ahead of background refresh work

**Evidence:** `lib/mtr-feed.ts:12–14,42–48` refreshes 16 boards per collection; `lib/lrt-feed.ts:11–13,41–44` refreshes 12 stations. The current network has 121 MTR boards and 68 Light Rail stations. `app/api/mtr/route.ts:12` and `app/api/lrt/route.ts:12` have no selected-station input. The browser cadence is 30 seconds, measured from completion (`app/traffic-monitor.tsx:482`).

**Trigger and impact:** On cold memory with one active client, a station in the last batch can wait roughly seven or five intervals—about 3.5 or 2.5 minutes, plus collection/scheduler time. Warm/shared caches and other clients can shorten that wait. Selecting the station does not give its arrival board priority. The bounded rotation is intentional rate-limit protection, not itself a defect.

**Plan:** Reserve part of the existing request budget for the opened station or selected line, retaining fair background rotation. Distinguish “not yet refreshed” from a successfully refreshed board with no departures. Apply the same priority principle to opened bus stops before background route estimates.

**Acceptance:** A late-order station on cold memory receives an early slot without increasing total permitted concurrency, starving other stations or defeating 429 backoff. Exercise rapid selection changes and concurrent clients.

### R6 — P2: Failed route geometry does not recover automatically after reconnect

**Evidence:** `app/use-route-paths.ts:21` excludes every route already in `loaded`; lines 31–32 store failures there. Only manual retry at line 39 clears the error entries. The hook has no reconnect listener or timed retry.

**Trigger and impact:** A temporary failure can leave an active route without geometry after connectivity returns. Toggling it off and on does not clear the stored error. Manual Retry is available, so the issue has a workaround. Successful route data from another path may also prime geometry, but recovery is not guaranteed by this hook.

**Plan:** Retry active failed routes on reconnect and with bounded per-route backoff. Retain successful geometry, preserve explicit retry, and distinguish unavailable geometry from a transport error.

**Acceptance:** Fail a geometry request, restore connectivity, and recover the visible route without a reload or manual retry. Keep the two-worker bound and avoid retrying structurally unavailable geometry indefinitely.

### R7 — P2: Retained snapshot age warnings do not advance

**Evidence:** `app/snapshot-image.tsx:102` computes staleness as `shot.fetchedAt - shot.updatedAt`. Both values remain fixed until the next successful download (lines 65–76).

**Trigger and impact:** A photo that was fresh when fetched never becomes age-stale while subsequent refreshes fail. An error overlay does appear; this is a missing age warning, not a completely silent failure.

**Plan:** Compare source update time with a current display clock. Preserve separate states for refresh failure, old source data and unavailable source timestamps.

**Acceptance:** Retain a successful photo, fail subsequent updates, and advance time beyond ten minutes. The old photo must acquire the age warning without a successful response. Missing source time must stay “unknown.”

### R8 — P2: Nearby tram cards suppress arrival provenance

**Evidence:** `app/nearby-panel.tsx:46–52` calculates the next arrival and freshness, but treats every tram as published-only information before choosing live, scheduled or stale wording. The detailed arrival board already distinguishes these states (`app/item-details.tsx:95–99`).

**Trigger and impact:** A tram countdown can appear next to “Published information,” hiding whether it is live, scheduled or retained during a failed update.

**Plan:** Use arrival availability, scheduled status and freshness to choose the card wording. Use published-only wording when the card contains static stop information alone. Share the provenance decision with details rather than duplicating it.

**Acceptance:** Verify fresh live, scheduled, expired, retained-after-failure and static-only tram cases in English and Traditional Chinese. Expired estimates must not remain actionable countdowns.

### R9 — P2: Unrelated request-state changes rebuild transport geometry

**Evidence:** `app/traffic-monitor.tsx:505–530` derives route feeds, catalogue, filtered feeds and paths from the entire state object. A loading/error change can recreate these values even when transport geometry has not changed. `app/traffic-map.tsx:797–809` removes and rebuilds the transport polyline group when `paths` changes; `app/traffic-map-3d.tsx:202–206` serializes and updates its traffic/transport sources together.

**Trigger and impact:** An unrelated layer refresh or clock-driven projection can cause repeated geometry work. The unnecessary replacement is visible in the source; its effect on frame rate and battery use was not measured.

**Plan:** Separate request status from stable feed data; derive transport projections from relevant data and visibility revisions. Keep static geometry separate from changing observations, and update renderer sources independently. Retain renderer-specific lifecycle handling.

**Acceptance:** A rainfall loading/error transition causes zero transport-geometry replacements. A genuine route change still updates correctly. Compare geometry replacements, long tasks and interaction latency before and after with the same dense fixture.

### R10 — P2: Vehicle labels overlap, and offscreen vehicles still receive drawing work

**Evidence:** `lib/map-markers.ts:30` always emits a destination label. Static decluttering uses `markers.current` in `app/traffic-map.tsx:532–594` and `app/traffic-map-3d.tsx:254–285`, excluding the separate vehicle collection. Vehicle loops process the full active fleet (`app/traffic-map.tsx:981–1060`, `app/traffic-map-3d.tsx:300–356`). The 3D loop already throttles updates to approximately 32 ms; both renderers already support hidden-page/reduced-motion behavior.

**Trigger and impact:** At territory overview, especially on narrow screens, destination labels overlap station labels and each other. This was observed in the local browser. Processing offscreen vehicles adds work, but no frame-rate regression was measured.

**Plan:** Use zoom/density-aware vehicle labels, with priority for the selected/focused vehicle. Cull offscreen drawing with a small viewport margin while preserving the underlying observations and absolute-time positions. Keep list/search access to information hidden from the map.

**Acceptance:** Review a repeatable busy-map fixture at 320, 390, 768 and 1440 CSS pixels. Selected vehicles remain identifiable, keyboard focus remains visible, and vehicles entering the viewport appear at their current position. Record frame time rather than judging smoothness from screenshots.

### R11 — P2: Browser regressions are outside the release verification gate

**Evidence:** `.github/workflows/verify.yml:28–31` runs the deterministic verification command and Worker build. `package.json:20–21` excludes the 21 `*.browser.mjs` regression scripts; Playwright is not a declared dependency. Existing scripts such as `tests/startup-defaults.browser.mjs:9–15` depend on externally supplied tooling.

**Trigger and impact:** Green verification does not establish that map controls, mobile popups, keyboard focus, actual marker motion or browser reconnect behavior still work. Today's successful smoke check is narrower than a repeatable release check.

**Plan:** Select a small deterministic browser gate with pinned tooling and feed fixtures. Cover startup, route selection, 2D/3D switching, mobile controls, stale/partial responses, offline/reconnect and focus restoration. Test both hosted runtimes and a reduced static-export case; leave public-provider availability checks separate.

**Acceptance:** Deliberately broken controls and reconnect fixtures fail the gate. Document one reproducible local/CI command and retain failure screenshots/traces. Verify that each deployment target has appropriate build and smoke coverage.

### R12 — P2 cleanup opportunity: Most bundled UI source has no application callers

**Evidence:** There are 61 `components/ui/*.tsx` files totaling 7,334 lines. The application's only direct import into that directory is the popover at `app/traffic-monitor.tsx:17`; its local dependency is `lib/utils.ts` (`components/ui/popover.tsx:4–6`). The other 60 files total 7,245 lines and were not reachable from the inspected application import paths.

**Impact:** Extra source and dependency maintenance, lint/typecheck work and review noise. This is not evidence that all those modules ship to the browser: unreachable modules may already be excluded from production bundles.

**Plan:** Confirm generator, registry and example requirements, then remove or relocate unused UI source in a dedicated cleanup change. Audit dependency ownership and regenerate the lockfile. Keep the actual popover, `radix-ui`, `clsx`, `tailwind-merge` and required ambient type packages.

**Acceptance:** Reference audit, deterministic verification, Next/Worker/static builds and popover focus/mobile checks remain green. Compare install size, build time and emitted bundle size separately; report only measured savings.

## API freshness and responsiveness plan

These are configured timings, not guaranteed end-to-end latency. Queue time, response duration, retries, source publication frequency and scheduler checks all affect what a user sees.

| Data family | Current policy | Planned treatment |
| --- | --- | --- |
| Flow | Poll 120 s; client cache 90 s | Retain source-age validation; measure age at display before changing cadence. |
| Incidents / parking | Poll 300 s; cache 120 / 180 s | Give active consumers an explicit feed-specific cadence; fix publication-time handling. |
| Enforcement / snapshot catalogue / rainfall | Poll 300 s; cache 300 / 300 / 600 s | Defer unneeded inventory work; keep full completeness checks when loading. |
| Rail / buses / trams | Normally 30 s, checked by a 5 s scheduler | Prioritize visible intent within current budgets; fix tram identity and geometry recovery. |
| Ferries / boundary / weather warnings | Normally 60 s | Preserve independent source results and source-specific stale/empty semantics. |
| Crossings / works / access / tolls / taxis | 120 s / 300 s / 300 s / 6 h / 24 h | Preserve distinct lifetimes; avoid treating static infrastructure as live operational status. |
| Open snapshot photo | 120 s; request timeout 55 s | Advance displayed age between successes; measure response/decode time before revising the timeout. |
| Building search | 500 ms debounce; 12 s timeout; bounded 15-minute memory cache | Preserve cancellation and bilingual results; include slow/failure/retry cases in browser coverage. |

References: `lib/integration-client.ts:40`, `lib/traffic-client.ts:485`, `app/traffic-monitor.tsx:408–428,498`, `app/snapshot-image.tsx:34–36,80–85`, `app/building-search.tsx:13–25`, `lib/building-search.ts:38–52`.

Keep the six-request ETA queue and collection deadline (`lib/polite-fetch.ts:59–62`), bus backoff of 30/60/120/240/300 seconds (`lib/refresh-backoff.ts`), original source-age retention limits, and independent caller cancellation. The queue is per isolate, not a provider-wide distributed rate limit. Measure aggregate provider traffic before deciding whether coordination across instances is needed.

Track source observation age separately from fetch latency, queue wait and cache age. Useful measurements are time to the selected stop's first usable result, source age at display, stale/partial response rate, canceled obsolete consumers, request counts per active feed, and 429 frequency. Never label a fast response as fresh solely because it arrived quickly.

## Exactly five constructive improvement proposals

| # | Proposal and user benefit | Concrete scope | Success criteria |
| --- | --- | --- | --- |
| **1** | **Make refreshes follow the user's current task.** Relevant arrivals appear sooner with less unnecessary work. | Address R2, R4, R5 and R6. Introduce shared typed refresh policy and consumer demand, while retaining operator-specific parsing, rate limits and fairness. Prioritize the opened stop/route before background estimates. | Current-area responses win; selected stations receive early bounded slots; inactive consumers generate no avoidable requests; reconnect recovers active work. |
| **2** | **Use one clear model for freshness and provenance.** Users can distinguish current observations, schedules, old data and unavailable information. | Address R3, R7 and R8. Separate source time from retrieval time. Standardize loading, live, scheduled, partial, stale, unavailable and healthy-empty presentation across cards, popups and status. Replace the partial-failure message regex at `app/traffic-monitor.tsx:475` with structured counts/status fields. | No invented source timestamps; old data ages while retained; identical observations receive consistent labels in both languages; wording changes cannot change retry behavior. |
| **3** | **Keep the map readable and reduce unnecessary rendering.** Pan, zoom and route selection should stay responsive as content grows. | Address R9 and R10. Preserve geometry identities, update only changed renderer sources, manage destination-label density and avoid offscreen drawing work. | Unrelated loading transitions cause zero geometry replacement. Use a proposed p95 local control-response target of 200 ms and a 33 ms frame-time budget for a named dense fixture on a named reference device; establish the baseline first. These are targets, not measured results. |
| **4** | **Remove unused scaffolding and give shared behavior clear ownership.** Future fixes become smaller and less likely to diverge between views. | Address R12. Prune proven unused UI/dependencies; extract focused refresh/projection/presentation responsibilities from the 950-line monitor and large map components. Consolidate duplicate cache policy only when semantics match. | All three build variants and behavior checks pass; actual source/dependency reductions are recorded; runtime gains are claimed only after bundle measurement. Avoid a large rewrite or abstraction that hides provider differences. |
| **5** | **Make reliability a repeatable release requirement.** Users consistently receive the intended revision with working core journeys. | Address R1 and R11. Order production publishing, add the small browser gate, and record freshness/performance measurements. Keep liveness separate from upstream freshness. | Delayed older builds cannot replace the intended release; broken core browser journeys fail verification; dashboards/log summaries distinguish provider outages from rendering and application failures. |

## Safe simplification boundaries

| Candidate | Evidence | Decision before future removal |
| --- | --- | --- |
| Unused dependency candidates | No references found for `@hookform/resolvers`, `date-fns` or `zod` in inspected source/config. Many UI libraries are referenced only by the unused UI modules. | Confirm generator/tooling and transitive requirements, then remove dependencies with their unused source. An import search alone does not prove ambient types or build dependencies are removable. |
| Repeated storage, refresh and cache plumbing | The monitor contains language/basemap/record/flag persistence and multiple refresh lifecycles; API wrappers have similar cache handling. | Extract only demonstrated common behavior. Preserve per-feed expiry, healthy-empty results, partial failure and shared-producer cancellation contracts. |
| Optional D1 scaffold | `db/schema.ts:1–4` is empty and `getDb()` has no application callers, but the hosting/build integration supports D1. | Decide whether the extension point is wanted; remove a complete unused path rather than isolated pieces. This is not a finding about an active production database. |
| Static build source mutation | `scripts/build-static.mjs:71–77` temporarily removes `app/api`; restoration and hash checks exist at lines 49–58. | Consider isolated staging for concurrent-build and uncatchable-termination safety. Preserve current restoration checks until the complete replacement is verified. No data loss was observed. |
| Design/documentation drift | The Impeccable surface brief still says to retain both bottom docks; current source and README describe their removal. | Update the brief when implementing the approved plan. Do not reintroduce obsolete controls. Update README, handover spec and relevant dated reviews alongside future behavior changes. |

## Delivery order and verification

These were the proposed implementation batches at review time. See the linked implementation record above for work subsequently completed. Effort is relative: small = localized behavior, medium = several consumers or a new regression scenario, large = cross-renderer/scheduler work.

| Order | Work | Effort | Completion gate |
| --- | --- | --- | --- |
| A | R1 deployment ordering | Small–medium | Overlapping-revision scenario proves the intended revision remains live. |
| B | R2, R3, R6, R7, R8 correctness and recovery | Medium | Targeted fake-clock, delayed-response and reconnect cases; bilingual presentation checks. |
| C | Establish R11 browser fixtures and rendering/request baselines | Medium | Reproducible smoke runs with failure artifacts, independent of public feed availability. |
| D | R4/R5 request prioritization and R9/R10 rendering | Large | Compare the same network and dense-map scenarios before/after; preserve source accuracy, fairness and focus. |
| E | R12 and selected cleanup candidates | Medium | Reference audit, dependency-lock consistency, all target builds and core smoke checks. |

For future changes, run `npm run verify` and the build variants affected by the change; shared dependency/build changes require Next, Worker and static-export checks. Test foreground/background, offline/reconnect, partial/total outage, valid empty service, stale/future/missing source clocks, rapid map movement, rapid route selection, and 2D/3D switching. Include narrow portrait, landscape, enlarged text, keyboard and reduced-motion cases. Use real touch devices before claiming gesture support.

Preserve the current strengths throughout: verified geometry stays distinct from approximate/unavailable paths; ETA-derived positions stay distinct from GPS; healthy empty responses clear obsolete estimates; failed responses do not renew their original lifetime; search remains bilingual; the PWA does not cache live feeds as offline truth.

For a later Impeccable-assisted UI pass, the relevant sequence is `$impeccable harden` for state presentation/recovery, `$impeccable optimize` for measured rendering work, `$impeccable adapt` for density and device behavior, `$impeccable audit` for reassessment, and `$impeccable polish` last. These are optional execution routes for the plan, not work performed in this review.
