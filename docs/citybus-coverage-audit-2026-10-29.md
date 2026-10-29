# Citybus route geometry coverage audit — 29 October 2026

This is a dated source comparison, not a promise that the road paths represent every current Citybus service or diversion. An ordered-stop match cannot establish the streets taken between sparse stops, and a route number and direction may include special services with different paths. OpenStreetMap paths are community-mapped; official and community data can be incomplete or stale. See [Citybus road geometry](citybus-road-geometry.md) for matching, attribution and provenance.

On 29 October 2026, the live Citybus route list contained 409 distinct route numbers. We queried both bound stop lists for each number, producing 818 lookups: 126 returned fewer than two stops, 692 returned a usable sequence, and none failed. Eight distinct stop IDs absent from the bundled Citybus catalogue were looked up from the operator's individual stop endpoint, as the application does. We also obtained all 852 distinct Citybus-containing Transport Department route records, in 50-record pages with no duplicates.

Of the 692 sequences, 447 matched Transport Department geometry and 47 more matched a Citybus-tagged OpenStreetMap relation. The remaining **198 sequences** had no accepted match: 494 of 692 usable sequences matched at least one source. A match uses every stop in published order within 65 m and rejects implausible detours, disconnected geometry and materially different candidate paths. This is coverage of route-number/bound stop sequences, not coverage of individual service variants. The [dated result file](citybus-coverage-audit-2026-10-29.json) lists each direction and its status.

Among the 198 unmatched sequences, 116 had candidates from both sources, 42 only from TD, two only from OpenStreetMap and 38 from neither. Candidate availability alone does not establish a valid match; stops, direction, continuity and variant ambiguity still have to be checked.

For a controlled comparison using the same sources and current ambiguity checks, the previous endpoint-based official matcher accepted 392 sequences; the clipped, ordered-stop official matcher accepted 447. It accepted 81 that the earlier matcher rejected and rejected 26 previously accepted, including candidates now excluded by the detour checks. These figures describe official geometry only and are not a measure of route correctness.

To repeat the audit deliberately, run:

```sh
node --experimental-strip-types scripts/audit-citybus-coverage.mjs /tmp/citybus-coverage.json
```

This opt-in command performs up to two operator stop-list requests for every current route, further requests for stop IDs missing from the local catalogue, and paginated government geometry queries. It uses at most three concurrent requests, a 300 ms pause per request and bounded retries. It does not poll or run during application use. A failed request is reported separately; missing or duplicate TD pages abort the audit. Source updates, network failures, changed matching rules, or refreshed bundled stop/OSM catalogues will change the result.
