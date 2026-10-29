# Tram track geometry

The tram routes use Hong Kong Tramways route relations from the [Geofabrik Hong Kong extract dated 28 October 2026](https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf), derived from OpenStreetMap. These are community-mapped tracks, not an official operating diagram; temporary diversions and later changes may not be reflected. **© OpenStreetMap contributors**, licensed under the [Open Database License](https://opendatacommons.org/licenses/odbl/); see [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

All 12 direction-specific routes in the bundled Transport Department tram catalogue have matched track geometry, including the Happy Valley loop. Each has a route-specific OSM relation, recorded with its version and timestamp. The matcher requires joined `railway=tram` members in relation order, respects the preferred direction where tagged, and checks every published stop in order within 25 metres. In this snapshot the largest stop-to-track distance is 13.6 metres. Paths are clipped to their first and last matched stops. A match cannot prove every intervening track segment or current service arrangement; it should be checked against Hong Kong Tramways' [eastbound](https://www.hktramways.com/images/googleMap/HK-tram-route-map-EB.pdf) and [westbound](https://www.hktramways.com/images/googleMap/HK-tram-route-map-WB.pdf) maps.

If a route's published stop sequence changes, its stored track is omitted until the match is regenerated. The app does not draw an unverified straight line. It does not provide live tram vehicle locations or departure times.

## Regeneration

Install `osmium` (pyosmium), download the dated extract and run:

```sh
curl -fL https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf -o /tmp/hkrt-hong-kong.osm.pbf
python3 scripts/extract-tram-osm.py /tmp/hkrt-hong-kong.osm.pbf /tmp/hkrt-tram-relations.json --source https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf
python3 scripts/build-tram-track-geometry.py /tmp/hkrt-tram-relations.json
```

The extraction rejects missing member ways or nodes. The matcher follows the explicitly reviewed relation IDs for each TD route and direction, rejects disconnected paths and checks stop order and implausible detours. Review changes in track direction, terminals and service routes and run `node --experimental-strip-types --test tests/tram-track-geometry.test.mts` after refreshing either input.
