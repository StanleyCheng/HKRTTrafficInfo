# Railway alignment snapshot

`rail-geometry.json` contains WGS84 `[longitude, latitude]` paths between actual
on-track stop nodes. Both MTR and Light Rail keys are `LINE:FROM>TO`; opposite
directions retain their own platforms and tracks. The map and train interpolation
share these paths. No runtime geometry request is needed.

## Sources and licence

Track geometry: **© OpenStreetMap contributors**, available under
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The OSM-derived geometry database in `rail-geometry.json` is distributed under
that licence. [OSM attribution and copyright](https://www.openstreetmap.org/copyright).
The snapshot records each route relation's ID, version, modification timestamp,
and a SHA-256 fingerprint of its source node/way IDs, versions and coordinates.

Current service sequences are checked against MTR's official
[heavy rail stations](https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv),
[Light Rail stops](https://opendata.mtr.com.hk/data/light_rail_routes_and_stops.csv)
and [Light Rail schedule](https://www.mtr.com.hk/en/customer/services/schedule_index.html).
The schedule confirms evening 751P services between Tin Shui Wai and Tin Yat,
and morning services from Tin Wing to Tin Shui Wai. The
[April 2026 Tin Wing announcement](https://www.mtr.com.hk/archive/corporate/en/press_release/PR-26-029-E.pdf)
confirms the northbound 751 platform change and additional morning 751P services.

The dataset covers the ten existing heavy rail lines, both East Rail northern
branches and the Racecourse diversion, the LOHAS Park branch, and existing
Light Rail services. It excludes proposed extensions and non-passenger depot
tracks. Circular 705/706 geometry includes the departure edge from Tin Shui Wai;
the estimation station sequences end there to keep the destination unambiguous.

## Rebuilding

Run `node scripts/generate-rail-geometry.mjs` from the project root. Acquisition
responses are cached in ignored `outputs/rail-osm/`; existing responses are reused,
so rebuilding from the same cache is deterministic. Missing responses download
from the main OpenStreetMap API. `--refresh` explicitly reacquires all relations;
review changes and rerun `node --experimental-strip-types --test tests/rail-geometry.test.mts`.
The raw cache is not duplicated in the published application.

The importer traverses only connected railway nodes in each directional route
relation. It fails on missing track paths and never connects nearby disconnected
tracks. Source corrections are explicit: Tin Wing's current northbound stop node
is inserted for 751/751P; 614P includes its existing Ferry Pier stop node; and
507's last terminal way is traversed towards Tin King despite its generic
preferred-direction tag. There is no undirected shortest-path fallback.

## Accuracy and checks

Geometry tests cover every published station hop and branch, exact continuity
at station boundaries, proximity to the intended station, and interpolation on
the same rendered path. Long straight source edges remain straight; adding
synthetic curves would invent alignment.

OSM provides geographic alignment, including tunnels, rather than a survey-grade
guarantee. Underground geometry and changes not yet mapped may have positional
uncertainty. The CEDD railway query suggested in the research returned an ArcGIS
query error during this update, so it was not used to claim government validation
or redistribute government geometry. MTR arrival-based train positions remain
estimates, not published train GPS coordinates.
