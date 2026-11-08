# Review implementation — 8 November 2026

This records the local implementation of [`review.md`](../review.md). The review's source observations describe commit `82f2f5c`; this record describes the subsequent working-tree changes. A commit, push and deployment were requested after this record was written; the deployment outcome depends on the repository's workflows and target credentials.

## Changes by finding

| Finding | Implemented change |
| --- | --- |
| R1 release order | Each production workflow now has one target-wide concurrency group. A final `main` SHA check skips a superseded automatic revision before publication. Manual Pages dispatch remains an intentional rollback route. |
| R2 tram viewport | Tram request identity now includes the zoom coverage gate and rounded map coordinates, so a new area can cancel an obsolete consumer and load its own sample. |
| R3 incident time | Missing, malformed and invalid publication dates stay unknown. Undated notices sort after dated ones; incident cards omit a nonexistent publication time. Retrieval time remains separate. |
| R4 original feed demand | The seven browser-direct feeds poll only when enabled or needed by Search/selected details. Visible, online checks use 120 s flow/incidents, 180 s parking, 600 s rainfall and 300 s inventory cadences, with provider caches still governing upstream requests. |
| R5 selected rail station | The opened MTR or Light Rail station is sent to the hosted endpoint and gets one due slot within the existing 16/12-request slice. Background rotation continues. |
| R6 geometry recovery | Failed active route geometry retries with per-route backoff and resumes on reconnect or foreground return; manual Retry remains available. |
| R7 snapshot age | A 30 s display clock advances the age warning while a photo is retained after refresh failure. Missing source time remains unknown. |
| R8 tram provenance | Nearby tram cards now show live or scheduled arrivals, stale status, or published-only stop information as appropriate. Stale countdowns are suppressed. |
| R9 geometry work | Route catalogue and filtered feeds derive from transport data, rather than unrelated request-status changes. Dynamic vehicle countdown snapshots no longer rebuild path arrays. The native renderer updates traffic and transport sources independently. |
| R10 map density | Both renderers skip offscreen vehicle markers with a margin. Overview destination labels are hidden below zoom 13, while selected and keyboard-focused labels remain accessible. |
| R11 browser release gate | Pinned Playwright/Chromium runs deterministic startup, 2D/3D transport controls, mobile layouts, refresh recovery and a failed-geometry reconnect fixture in `npm run verify:browser`. Verify CI runs it after deterministic checks and Worker build, uploading failure screenshots. |
| R12 unused UI | Removed 60 unreferenced `components/ui` modules, the unused mobile hook and 16 direct dependencies; kept the popover and its dependencies. Lockfile and lint configuration were updated. |

The improvement proposals in the review are broader than these changes. The monitor and map components remain large; no whole-application scheduler or shared presentation-state model was introduced. An opened bus route already has a focused detail request, but no additional cross-operator prioritization was added. Production latency, frame times, provider traffic, bundle size and physical-device accessibility have not been measured. The new browser gate exercises the local development runtime; it does not smoke-test deployed Vercel, Worker or Pages URLs. Those are follow-up measurements and release checks, not claims of a verified speedup.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` | Passed locally: ESLint, TypeScript, 253 deterministic tests. |
| `npm run verify:browser` | Passed locally: 5 startup cases, desktop/mobile 2D and mobile 3D route controls, route geometry reconnect, and refresh recovery. |
| `npm run build` | Passed locally for the Cloudflare Worker bundle. |
| `next build` | Passed locally for hosted Next.js. |
| `npm run build:static` | Passed locally; the script restored and verified all 23 API files. |
| Deploy eligibility helper | Current remote `main` SHA returned `eligible=true`; an older synthetic SHA returned `eligible=false`. No production deploy race was run. |

The local smoke fixture uses intercepted data, so it establishes application behavior under those cases rather than current external-provider availability. The deploy eligibility rule has not been exercised by overlapping real production runs. Any future deployment still depends on the repository's verification workflow and target credentials.
