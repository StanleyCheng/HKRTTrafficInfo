# Citybus road geometry

The Transport Department's [Bus Route dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_23-routes-fares-geojson/resource/e9900c0d-bfb3-4a33-a2c7-8e3fdf301798) provides road-aligned shapes for franchised bus services. The app checks Citybus route shapes against the operator's ordered stops before using them. A shape that does not sufficiently match is not treated as confirmed. The published geometry and the operator's stop data can differ, and neither necessarily represents a temporary diversion.

If no official shape matches, the app can check an OpenStreetMap route relation for the same Citybus route. The bundled community candidates were extracted from the [Geofabrik Hong Kong snapshot dated 28 October 2026](https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf). Candidate relations identify Citybus or Cityflyer, including joint operations tagged with the exact `CTB` operator code, and match a route number in the bundled Citybus stop catalogue. Their ordered road members must be continuous and respect one-way tags. The matcher checks every operator stop in order within 65 metres, rejects implausible detours and refuses conflicting matched alignments; it clips the result to the first and last stop. **A stop match cannot prove the bus uses every intervening street, and OSM data may be incomplete or outdated.** Community-derived paths are identified in the app and never called official. When neither source passes the checks, road geometry is unavailable rather than invented.

The snapshot includes candidates for 238 of 398 Citybus route numbers in the bundled stop catalogue. This is an upper bound, not the number of routes or directions that will match today's stops. A [29 October 2026 audit](citybus-coverage-audit-2026-10-29.md) found matches for 494 of 692 usable direction lists; the remainder were unavailable. In spot checks, 11 outbound, A11 inbound and 118 inbound matched; 5B in both directions and the other directions in that sample did not. The route-11 outbound regression fixtures preserve the Citybus stop sequence and TD shape checked on 29 October 2026.

**© OpenStreetMap contributors.** OSM data and derived geometry are available under the [Open Database License](https://opendatacommons.org/licenses/odbl/); see [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). Candidate relations and versions are retained in the data for traceability.

## Regeneration

Install `osmium` (pyosmium), download the dated PBF and run:

```sh
curl -fL https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf -o /tmp/hkrt-hong-kong.osm.pbf
python3 scripts/extract-citybus-osm.py /tmp/hkrt-hong-kong.osm.pbf /tmp/hkrt-citybus-relations.json --source https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf
python3 scripts/build-citybus-osm-geometry.py /tmp/hkrt-citybus-relations.json
node --experimental-strip-types --test tests/citybus-osm-geometry.test.mts
```

The data is split into 16 route-prefix shards for on-demand loading, totalling about 14.4 MB uncompressed or 3 MB compressed. An individual shard is approximately 4–605 KB compressed. Review additions, removals, route identity, directional coverage, attribution and ambiguous matches when refreshing the sources. No shortest-road route is substituted for a missing relation.
