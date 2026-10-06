# HKRTTrafficInfo — 香港實時交通資訊

Bilingual Traditional Chinese / English traffic map built with Leaflet, React and Next.js. The original seven layers are joined by harbour journey boards, road works, toll points, boundary queues, weather warnings, rail arrivals, bus arrivals and ferries. The ranked intelligence panel combines incidents, slow roads, warnings and feed faults.

## Run and validate

Node 22.13 or later:

```sh
npm ci
npm run dev             # Next.js on Windows, Vinext elsewhere; port 5173
npm run verify          # lint, TypeScript and Node tests
npm run build           # Vinext / Cloudflare Worker build
npm start               # local Worker preview
npm run build:static    # optional static export in out/ (limited feeds)
```

Use `npx next build` for standard hosted Next.js; Vercel uses this build. GitHub CI validates source and builds the Worker without publishing a Pages site. The optional static script backs up API routes under `node_modules/.cache`, restores them even after build failure, and verifies restored file hashes. `node scripts/build-static.mjs --check-routes` checks that move/restore operation without compiling.

```sh
npm run verify:live -- http://localhost:5173
node --experimental-strip-types scripts/verify-live.mjs http://localhost:5173 --only=health,boundary,warnings
node scripts/probe-cors.mjs
```

The live verifier imports the actual browser adapter for the original seven layers and calls new hosted API routes for integrations. It compares official inventories, speeds and road colours, fetches a JPEG, and checks road, boundary, weather and transit responses against upstream sources. Every failed source is reported independently; failure sets a nonzero exit code. It no longer targets the removed camera/snapshot proxy routes. Live network availability and changing publication times can affect acceptance checks; unit tests are deterministic.

## Hosted and static versions

- [Full hosted version](https://hkrttrafficinfo.vercel.app/): new feeds use same-origin routes with shared caching.
- [Cloudflare Worker](https://hk-rt-traffic-info.stanley-it.workers.dev/): the full dynamic app with Workers-compatible server routes.

GitHub Pages deployment is retired because the full app depends on dynamic API routes. The optional static export remains available for limited browser-direct feeds.

The original seven layers fetch official data directly in both modes. New integrations use same-origin routes when hosted and direct adapters when static and CORS permits. `NEXT_PUBLIC_STATIC_EXPORT` is derived from `STATIC_EXPORT=1`. Server-only toggles explain their limitation in both languages and link to the hosted version; override that link with `NEXT_PUBLIC_HOSTED_URL`.

| Layer | Official source | New hosted route | Static support |
| --- | --- | --- | --- |
| Red-light junctions | TD / CSDI feature inventory | Existing browser adapter | Yes |
| Speed-enforcement housings | TD / CSDI feature inventory | Existing browser adapter | Yes |
| Snapshots | TD XML inventory and tdcctv JPEGs | Existing browser adapter | Yes |
| Road speeds / smart lampposts | TD speed XML, road network, SLP CSV/XML | Browser adapter | Yes |
| Incidents | TD special traffic news, ALS geocoding | Existing browser adapter | Yes |
| Parking vacancy | TD parking data | Existing browser adapter | Yes |
| Rainfall | HKO rhrread | Existing browser adapter | Yes |
| Harbour journey boards | HKeMobility WFS / getTextInfo | `/api/approaches` | Hosted only |
| Road works | HKeMobility road works WFS, EN and TC | `/api/works` | Hosted only |
| Toll points | HKeMobility toll WFS | `/api/tolls` | Hosted only |
| Boundary queues | ImmD resident / visitor queue files | `/api/control-points` | Hosted only |
| Weather warnings | HKO warnsum, TC and EN | `/api/warnings?lang=tc` | Yes |
| MTR | MTR Next Train and bundled geometry | `/api/mtr` | Hosted only |
| Light Rail | MTR Light Rail and bundled geometry | `/api/lrt` | Hosted only |
| KMB / LWB | KMB stop ETA and catalogue | `/api/kmb`, `/api/kmb/places` | Yes, zoom ≥ 13 |
| Citybus | Citybus stop/route ETA | `/api/citybus`, `/api/citybus/places` | Yes, zoom ≥ 13 |
| Green minibuses | GMB stop ETA | `/api/gmb`, `/api/gmb/places` | Yes, zoom ≥ 17 |
| New Lantao Bus | NLB stop/route ETA | `/api/nlb`, `/api/nlb/places` | Yes, Lantau only |
| Ferries | Sun Ferry, HKKF, Star Ferry, Fortune Ferry | `/api/ferry` | Hosted only |

Bus routes require `lng`, `lat`, and `zoom`. Server routes and direct adapters enforce gates, with NLB restricted to longitude 113.8–114.05 and latitude 22.18–22.34. Bus/ferry polling is 60 seconds while enabled; rail polls every 15 seconds. MTR backs off for 45 seconds after HTTP 429, shares observations across clients and refreshes a limited station slice. Vehicle positions interpolated from arrival boards are estimates; Sun Ferry GPS fixes are distinguished.

Bus stops are always drawn as individual unclustered icons with decluttered name/route labels (never a cluster count); clicking a stop label or icon opens a live bilingual ETA popup anchored at the label. Choosing “Show route” on an arrival in the popup (or in the sidebar details) draws its complete ordered route and an animated estimated bus approach. KMB/LWB, Citybus, GMB and NLB retain their direction and service identity. The selected route refreshes every 60 seconds through `/api/bus-route` (or official feeds in the static build). Official CSDI road geometry is checked against the ordered stops; unavailable or mismatched geometry is labelled as an approximate stop connection. The bus icon estimates one approaching service from fresh ETAs, without vehicle GPS or persistent vehicle identification. Scheduled, expired or unavailable estimates do not create a moving bus.

[CORS probe results](docs/cors-probe.md) record real GET status and headers. KMB, Citybus, GMB, NLB, HKO warnings and SLP return allow-origin `*`. Both ImmD queue files return HTTP 200 without allow-origin, so boundary queues require hosting. HKeMobility requires server requests; rail sharing and mixed ferry sources also require hosting.

## Caching and freshness

`lib/upstream.ts` provides memory caching, concurrent request coalescing, optional Cloudflare Cache API storage and a fallback without Cache API. Shared entries retain their original fetch timestamp and explicit expiry; standard browser caches cannot silently extend their TTL. The Vinext original-fetch symbol bypass prevents re-entering framework caching while writing to Cache API.

Parsed route caches retain successful responses on refresh failure, mark them stale and preserve their observation/retrieval timestamps. Sources fail independently. Warnings fetch only warnsum; the rainfall layer owns rhrread. Road speeds older than ten minutes become unavailable. Polling follows page visibility, and transit layers request data only while enabled.

## Interface and source limits

Layer groups cover roads, conditions, rail, buses and ferries. Bilingual search includes stops, stations, piers and boundary points. Details show queues, works and arrivals. The intelligence panel provides ranked, roads, boundary, weather, systems and notes tabs, with map selection for located items. Keyboard tabs, Escape dismissal, reduced motion and mobile layouts are supported.

On first load, the map requests browser location and zooms to the user's position when permission is granted. If location is denied, unavailable or times out, the Hong Kong overview remains and the GPS button below the centre control allows retry. MTR starts enabled alongside road speeds and incidents, showing arrival boards and moving estimated train positions. Users can switch it off for the session.

Enforcement records identify published junctions/housings, not operational cameras or current enforcement activity. Snapshots are still JPEGs; HTTP 200 can contain an official no-service image. Last-Modified is file-update time, distinct from embedded capture time. Arrival data can include scheduled calls; interpolated vehicles are estimates. Bundled transport catalogues contain published stop/route geometry rather than fabricated live arrivals.

No API keys or application authentication are required. OpenStreetMap and alternative basemaps are non-government sources. DEM terrain and Simplified Chinese/OpenCC are outside this integration.
