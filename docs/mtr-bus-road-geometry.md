# MTR Bus and feeder-bus road geometry

The route shapes are derived from OpenStreetMap bus-route relations and checked against the ordered stops in the bundled MTR Bus catalogue. They are community-mapped road alignments, not official MTR route geometry. The stop sequence check helps reject mismatched variants; it cannot prove every intervening road is correct or reflect temporary diversions.

The source is the [Geofabrik Hong Kong extract dated 28 October 2026](https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf), which contains OpenStreetMap data. The extract contains candidate MTR Bus and feeder-bus relations for 19 of the 26 route numbers in the bundled catalogue. The matching process accepted 19 of the 56 published direction and variant groups. A candidate is not necessarily a match for every published direction or special service. Unmatched directions are omitted and the selector identifies partial or unavailable road geometry.

**© OpenStreetMap contributors.** OpenStreetMap data and the derived geometry are available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). See [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). Relation identity and version are retained with each accepted shape for review and reproducibility.

The Transport Department's [Bus Route dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_23-routes-fares-geojson) covers franchised bus routes. Its spatial service did not contain the MTR/feeder operator in the query performed for this work. The [MTR stop dataset](https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities/resource/f49a3cfc-3537-4c9a-ac0f-637ca09afdb4) supplies the ordered stop positions used for matching.

## Rebuilding

Download a dated Geofabrik Hong Kong PBF, and install `osmium` (pyosmium) in a Python environment. Pass the dated source URL so the output records its provenance. For the snapshot used here:

```sh
curl -fL https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf -o /tmp/hkrt-hong-kong.osm.pbf
python3 scripts/extract-mtr-bus-osm.py /tmp/hkrt-hong-kong.osm.pbf /tmp/hkrt-mtr-bus-relations.json --source https://download.geofabrik.de/asia/china/hong-kong-261028.osm.pbf
python3 scripts/build-mtr-bus-road-geometry.py /tmp/hkrt-mtr-bus-relations.json
```

The extraction retains relation members in their published order and includes their road-way coordinates. The matcher uses the reference and direction's complete ordered MTR stop list, requires road-way joins within 5 cm, respects one-way and member directions, and rejects stops over 65 metres from the path. It checks stop order and bounds implausible detours between stops. Review changes and rerun the geometry and commuter tests after refreshing either source. No shape is inferred for an unmatched route from a generic shortest-road path.
