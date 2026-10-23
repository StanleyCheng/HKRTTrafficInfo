# Commuter layers, refresh resilience and saved sessions

The agreed scope adds all four commuter layers, Nearby departures grouped by mode, and persistent desktop/mobile sessions. English and Traditional Chinese, Leaflet 2D and native MapLibre 3D share the behavior.

## Refresh corrections

- Weather warning error envelopes cannot replace an active warning list with a false all-clear. An explicit empty object remains valid.
- KMB/Citybus, GMB and NLB validate operator arrival identities and nested arrays before cache insertion. Selected route estimates use the same boundary checks.
- Arrival API fallback checks original source and cache ages, including after a slow failed refresh. Displayed countdowns expire independently of the places they belong to.
- Open 3D route-stop details poll every 30 seconds, resume on visibility/reconnect and cancel on closure. Restoring them requests new arrivals.
- Ferry timetable and holiday bytes have short raw-cache lifetimes. Only successfully parsed timetables receive daily retention, allowing recovery from HTTP-200 maintenance pages.
- Harbour journey-board locations, optional translation and live detail requests run concurrently within a 45-second producer budget. Optional translation has a five-second wait.
- Existing route trajectory retention keeps each original expiry; healthy empty responses still clear estimates.

## Commuter information

The official bundled catalogues contain 675 unique MTR bus stop IDs from 855 route-stop rows, 117 tram stops and 12 directional route connections, facilities for 97 MTR stations, and 518 taxi stands. Provenance is in `data/commuter-sources.json`; `scripts/update-commuter-data.py` regenerates the catalogues using generator-only Python packages.

MTR bus schedules use the official POST API with shared bounded concurrency, route coalescing and the provider refresh hint. Scheduled services are identified and operator alerts remain stale/error states. No inferred MTR bus GPS markers are displayed.

Trams provide published fares and approximate connections between ordered stops, without live departures. Access station markers locate stations and list published exit/facility descriptions; they do not claim surveyed entrance coordinates or live lift availability. Local CSDI pedestrian samples are bounded to 1,000 segments. Teal means published wheelchair access without a recorded barrier; amber means a barrier or no wheelchair access; grey means unclassified. Samples and facility records do not constitute complete accessible routing. Taxi locations have no live availability or queue information.

Nearby uses a 500 m, 1 km or 2 km straight-line radius around the map centre. It loads eligible sources independently of the map switches and groups rail, buses, trams, ferries, accessibility and taxi options. Selecting an item enables its layer and opens details. Static exports support published-information layers; hosted-only modes have an explanation and link.

## Saved context

Versioned local storage restores map view, 2D/3D mode, tilt/bearing, GPS preference, selected route/place/route-stop, stop and route-label controls, dock group, open panels, intelligence tab, search and Nearby radius. Existing stores retain language, basemap, layers, topbar and rail filters. The saved route does not automatically refit the map after reopening. Invalid saved values are discarded; unavailable storage has an in-memory fallback. Storage is per browser or installed app, without cross-device synchronization.

Only context is saved. No arrival payloads, interpolated vehicle trajectories or snapshot images are persisted. Reopening obtains current source data, and expired live details remain hidden.

## Acceptance evidence

- `npm run verify`: lint, TypeScript and 200 deterministic tests.
- `tests/commuter-session.browser.mjs`: desktop English, mobile Traditional Chinese, desktop 3D and mobile 3D. Covers Nearby, departures, viewport containment, panel/radius restoration, independent popup polling and reopening a route with its prior camera and controls.
- Existing refresh recovery scenario and all five transit refresh browser scenarios.
- Eight movement scenarios, including vehicle details, GPS ferry correction, identity continuity, reduced motion and both renderers.
- Five startup/GPS scenarios, including desktop and mobile native location permission.
- Ten live existing-source checks passed: red-light, speed-camera and snapshot inventories, incidents, parking, rainfall, road works, tolls, boundary queues and warnings.
- New live samples returned MTR bus stops/arrivals with an operator alert correctly flagged stale, and a pedestrian sample capped at 1,000 paths with `complete:false`. These are point-in-time observations, not uptime guarantees.

The Worker, hosted Next.js and static export builds passed. The static build restored and hash-verified all 20 API source files. A static mobile browser check also confirmed the tram/access/taxi catalogues and Nearby load without same-origin API routes, with a link for hosted-only arrivals. A rendered check against the built hosted app loaded 35 real map tiles, 810 published markers and populated Nearby tram/access/taxi groups without browser errors. Browser fixtures exercise controlled failure/recovery; live checks remain subject to provider availability.
