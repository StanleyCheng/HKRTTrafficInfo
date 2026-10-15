# Bus position and movement review

Reviewed and repaired on 15 October 2026 (Hong Kong time), following a report of missing or misplaced bus icons while riding KMB 115. The shared route loader, inference, refresh lifecycle and both renderers were checked. Changes remain local, uncommitted and undeployed.

## Findings and repairs

| Priority | Finding | Repair |
| --- | --- | --- |
| P1 | ETA rank was treated as a vehicle identity across stops. On the recorded 115 outbound snapshot, rank changes at stops 3 and 13 produced five estimates, including duplicate estimates at the origin. | Match consecutive arrival boards in chronological order, allowing rank changes. Separate live and scheduled rows. The recorded case now produces three service estimates. These are inferred services, not a verified vehicle count. |
| P1 | Every new chain was projected back from the route origin. A bus newly appearing ahead of the previous stop's arrivals could therefore be placed behind a stop it had passed. | Bound that approach by the immediately preceding stop. Sparse observations without that evidence still use an approximate approach speed. |
| P1 | A single failed stop request, or one stale/malformed KMB row timestamp, discarded usable observations for the entire direction. Forward failure also erased the healthy reverse fleet. | Isolate stop and row failures, keep successful observations and track each direction independently. Partial data retains a warning. NLB now reads all published ranks instead of only the first. |
| P2 | Speeds below 0.5 m/s removed congested buses, and a 200 m proximity filter collapsed distinct bunched services. | Allow slow but forward travel and keep independently matched services. Ignore physically impossible arrival links without losing usable earlier evidence. |
| P2 | A trajectory ended at its first predicted stop, freezing the icon until the next poll. Changed ranks recreated markers. | Carry the complete matched stop timeline, interpolate through subsequent arrivals and reconcile nearby marker identities one-to-one on the same direction. These identities provide visual continuity only. |
| P2 | Any refresh failure immediately cleared otherwise unexpired markers. The newest timestamp in a chain could prolong an older anchor. | Keep previous trajectories with their original geometry and expiry during failure, use the oldest participating observation for expiry, clear healthy empty results, and suppress expired counts. |

Implementation: `lib/bus-route.ts`, `lib/bus-route-motion.ts`, `lib/bus-route-state.ts`, `app/traffic-monitor.tsx`. Both Leaflet and native MapLibre consume the shared motion calculation. Route details now explicitly explain the mismatch with a rider's GPS in English and Traditional Chinese.

## Evidence and verification

- Recorded public KMB 115 outbound snapshot: **15:18:02 HKT**, 15 October 2026. Regression fixture: `tests/fixtures/kmb-115-rank-shift.json`. It establishes feed rank changes and bounds, not physical bus locations.
- Fresh direct 115 route load: provider observation **15:27:17 HKT**, road geometry, 20 outbound stops and 22 inbound stops, three outbound and two inbound estimates, no stale flag. Evidence: `outputs/bus-review/kmb-115-repaired-live.json`.
- `npm run verify`: ESLint, TypeScript and **191 deterministic tests** passed.
- `npm run build` and `npm run build:static`: passed; static build restored and verified all 18 API files.
- Bus browser suite: **11/11** passed, covering all four bus operators plus LWB, both bounds, desktop/mobile, retained expiry, onward motion without another request, reduced motion, labels and cleanup. Evidence: `outputs/bus-review/browser/bus-route-results.json`.
- Native 3D browser suite: **7/7** passed, including bus geometry/vehicles, responsive layouts and renderer fallback. Evidence: `outputs/bus-review/3d/map-3d-results.json`.
- Live local-browser check against the actual KMB 115 API: provider observation **15:34:17 HKT**, five icons rendered (three outbound and two inbound) at desktop and mobile widths, road geometry, no stale flag or browser errors. Only the stop-picker seed and unrelated layers were isolated; `/api/bus-route` used live provider requests. Evidence: `outputs/bus-review/live-115-browser.json`, `live-115-desktop.png` and `live-115-mobile.png`.
- The static build reproduced the documented `.next/types/validator.ts` generated-type conflict. Removed only gitignored `.next/types` and reran the verification gate.
- Tests cover stale KMB rows, failed Citybus/GMB/NLB stops, all NLB ranks, congestion, bunched services, rank changes, invalid timelines, original-expiry retention and successful empty responses.

## Accuracy and coverage limits

The [official KMB dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb) provides route/stop information and arrival estimates, updated approximately once per minute. The [Citybus data dictionary](https://www.citybus.com.hk/datagovhk/bus_eta_data_dictionary.pdf) likewise describes stop coordinates and arrival estimates. These selected feeds do not supply physical bus coordinates or persistent vehicle identities. Smooth interpolation cannot guarantee alignment with a rider's phone GPS or identify the bus they are riding. Delays, missing boards, diversions and timetable-only predictions can still produce inaccurate or unavailable positions.

[Route 115 is jointly operated by Citybus and KMB](https://search.kmb.hk/TD_SS/115.pdf). A selected route uses that operator's feed; it is not a combined, guaranteed complete fleet inventory. No user GPS position is used to fabricate or move a public bus estimate.
