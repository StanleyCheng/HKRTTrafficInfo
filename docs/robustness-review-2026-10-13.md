# API and movement robustness review

Reviewed and implemented on 13 October 2026, Hong Kong time. Scope includes all 19 map layers, their shared request/cache infrastructure, bus place and selected-route APIs, and GPS/vehicle movement in both map renderers. Three parallel reviews covered upstream requests, transit collection and movement, with a separate review of client refresh lifecycle and normalization.

## Fixed findings

| Priority | Failure and consequence | Implemented correction |
| --- | --- | --- |
| P1 | Boundary queue validation required the retired LMC code, causing the current published inventory to return HTTP 502. | Accept the published inventory, support Huanggang/HGP at its official coordinates, and retain LMC only when the source includes it. Unknown queue statuses remain unavailable instead of appearing closed. |
| P2 | A shared cache read could complete after its cutoff and overwrite newer network data; a stalled response body could retain an in-flight producer. | Apply deadlines to cache lookup and body download, guard late writes, and clear completed/failed producers. HTTP errors are handled without waiting for their error-page bodies. |
| P2 | Malformed HTTP 200 responses could poison last-good caches or erase incidents, vacancies, arrival boards and inventories. | Validate advertised JSON before caching, require published array/collection shapes, distinguish valid empty boards from malformed responses, and retain prior valid data on failure. |
| P2 | Failed rail stations stayed never-read and repeatedly took the first refresh slots. Concurrent rail callers could see inconsistent failure reporting. | Record refresh attempts separately from successful observations, distribute station slices fairly, and coalesce identical snapshots. |
| P2 | Rail/ferry and selected-route calls could wait beyond their intended budget behind other operators or metadata requests. | Share the six-slot ETA queue, include queue waits in transit deadlines, bound selected-route and ferry timetable waits, and let protected metadata producers complete without blocking live arrivals. |
| P2 | Fresh neighbour/global timestamps could make retained bus stops or old vehicles appear current; frozen provider responses renewed their apparent age. | Keep per-stop clocks, use provider publication/generation timestamps, reject expired or implausibly future observations, expire past bus ETAs, and bound API fallback by both cache age and original observation age after the loader finishes. |
| P2 | Fortune's legitimate weekday no-service result appeared as a broken timetable; partial timetable successes delayed retries or renewed failed siblings. | Recognize the provider's explicit no-sailings page, retain same-day working directions with their own timestamps, retry failed directions, and expire retained Star sheets independently. |
| P2 | Optional incident geocoding could delay the entire feed, and a temporary lookup failure remained cached permanently. | Limit total geocoding work to five seconds, bound individual attempts and retry negative lookups after a short interval. All notices remain visible even without coordinates. |
| P2 | Reduced-motion mode froze vehicle positions between feed changes. | Update vehicles once per second without continuous animation. |
| P2 | Refresh corrections could restart from obsolete positions, cross route bends, reverse heading or replay a long background gap. Native 3D unsurveyed ferry GPS jumped between fixes. | Use shared route-aware interrupted corrections, follow directed geometry, reset obsolete or implausible corrections, and interpolate between confirmed unsurveyed GPS fixes. |
| P2 | Arrival-derived train and sailing IDs changed between polls, recreating otherwise continuous markers. | Reconcile nearby estimates one-to-one on the same directed route and destination. Preserve physical ferry GPS IDs. The continuity IDs do not identify real vehicles. |
| P2 | Invalid, duplicate or reordered user GPS fixes could move the map backward. | Validate coordinates, accuracy and strictly increasing fix timestamps before applying motion in either renderer. |
| P2 | Warning language changes reused a response in the previous language, and unmount cleanup left transit consumers running. | Include warning language in request identity, preserve bilingual transit requests during language changes, cancel integration consumers on actual unmount while preserving effect replay, and refresh enabled feeds immediately on reconnect. |

Entry points: [upstream requests](/Users/stanley/projects/HKRTTrafficInfo/lib/upstream.ts), [original feeds](/Users/stanley/projects/HKRTTrafficInfo/lib/traffic-client.ts), [boundary queues](/Users/stanley/projects/HKRTTrafficInfo/lib/control-points.ts), [transit clocks](/Users/stanley/projects/HKRTTrafficInfo/lib/place-arrivals.ts), [client refresh](/Users/stanley/projects/HKRTTrafficInfo/app/traffic-monitor.tsx), [normalization and continuity](/Users/stanley/projects/HKRTTrafficInfo/lib/integration-client.ts), [motion corrections](/Users/stanley/projects/HKRTTrafficInfo/lib/vehicle-motion.ts), [GPS motion](/Users/stanley/projects/HKRTTrafficInfo/lib/location-motion.ts).

## Validation

The final combined check passed with clean lint, TypeScript and 179 deterministic tests. Results are recorded in [verification log](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-verify.log). Build logs cover [Cloudflare Worker](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-build.log), [hosted Next.js](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-next-build.log), and [static export](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-static-build.log), including restoration of all 18 API files after export.

Browser verification passed 49 cases: 28 GPS, eight movement, seven 3D/responsive/fallback, five transit refresh and one refresh recovery. Cases cover interrupted GPS fixes, changed upstream vehicle IDs, continuous route movement, native ferry GPS smoothing, reduced motion, language changes, viewport churn, delayed responses, automatic recovery and reconnect. The marker identity regression uses the complete surveyed rail route.

Browser evidence: [GPS results](/Users/stanley/projects/HKRTTrafficInfo/outputs/robustness-gps/gps-browser-results.json), [movement results](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-motion/map-motion-results.json), [3D results](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-3d/map-3d-results.json), [transit refresh results](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-transit/transit-refresh-results.json).

## Live source observations

Live samples exercised all layers and the bus places endpoints. These are point-in-time observations, with changing source availability recorded instead of treating a request trigger as evidence of healthy data.

| Sources | Observed result |
| --- | --- |
| Red-light, speed, snapshots | Complete published inventories: 230, 164 and 1,013 records; real snapshot JPEG verified. |
| Road speeds and smart lampposts | 4,502 of 4,525 speed segments mapped; 20 lamppost detectors verified. The 23 missing segment geometries remain explicitly counted as unmapped. |
| Incidents, parking, rainfall | Six incident notices, four located; 585 car parks; 18 rainfall records. Unlocated notices remain available. |
| Works, tolls, crossing boards | Seven works, eight valid toll locations, eight active boards from nine published board locations. The toll verifier now excludes four mid-crossing overview points when plazas are published. |
| Boundary and warnings | Current eight-point boundary inventory recovered, including HGP; warnings were successfully fetched, with no active warnings in the sampled response. |
| KMB/LWB, Citybus, GMB, NLB | Nearby place/arrival inventories verified at eligible viewports: 40, six, 24 and six respectively. |
| MTR, Light Rail | The final MTR sample returned 16 boards and 35 train estimates with no stale/error flag. Light Rail station requests failed intermittently in another sample; their retained data remained marked stale and retried. Rail coverage advances in bounded slices rather than claiming an immediate complete network snapshot. |
| Ferries | The latest direct sample returned 26 vessels, including three operator GPS fixes, and correctly showed no weekday Kai Tak sailing. Star timetable retrieval was intermittent in another hosted sample; working directions were retained and the failure reported. |

Evidence: [original sources](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-original-live.log), [initial hosted samples](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-integration-live.log), [tolls and crossing boards](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-road-integrations-live.log), [boundary recovery](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-boundary-live.log), [fresh ferry sample](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-transit-live.json), [final MTR sample](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-mtr-final-live.json), [later hosted sample](/Users/stanley/projects/HKRTTrafficInfo/outputs/api-review-recovery-live.log).

The Huanggang change is supported by the [government opening announcement](https://www.info.gov.hk/gia/general/202610/09/P2026100900281.htm) and [Immigration's facility map](https://www.map.gov.hk/mapviewer/map.do?gmid=myvo5nnWd6&lg=en). Fortune's weekday service pattern is documented in its [official timetable](https://www.fortuneferry.com.hk/assets/uploads/infos/kmw1xSCp-organized%20(5).pdf).

Train, bus and timetable ferry motion remains explicitly estimated from arrival/sailing data. Interpolation smooths confirmed information; it does not supply missing real-world GPS. Changes are local and have not been committed or deployed.
