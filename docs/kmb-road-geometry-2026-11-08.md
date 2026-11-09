# KMB route road geometry review — 8 November 2026

## Finding

KMB 288 is a circular outbound-only service. The [KMB route-stop feed](https://data.etabus.gov.hk/v1/transport/kmb/route-stop/288/outbound/1) lists 15 stops, with the upper Shui Chuen O terminus repeated at the end. The [Transport Department CSDI Bus Route dataset](https://portal.csdi.gov.hk/csdi-webpage/dataset/td_rcd_1638844988873_41214) publishes one detailed route 288 shape (`ROUTE_ID=8251`, `ROUTE_SEQ=1`): 14 continuous parts, 714 vertices, about 7.4 km. Both were checked on 8 November 2026 and retained as a deterministic test fixture.

The old `matchBusGeometry` algorithm chose the nearest later projection for each stop independently. On a loop, an early stop can be closer to its second pass. Choosing that second pass leaves later published stops behind, so the matcher rejected the valid official shape. The KMB fallback then connected stop coordinates directly, producing the line through buildings reported by the user.

## Correction

- KMB now uses the ordered whole-route matcher already used for Citybus official shapes. It considers repeated occurrences and selects a monotonic sequence that keeps every published stop near the road path. Disconnected parts, reversed direction, distant stops and ambiguous divergent candidates remain rejected.
- A KMB direction with no verified road shape still shows its stop information, but draws no stop-to-stop map line or ETA-derived vehicle marker. The interface marks road geometry as unavailable. This prevents a temporary source failure or changed route from being portrayed as an accurate road line.
- The change applies to the layer route picker, focused “Show route” path and both 2D and 3D renderers through the shared road-display check.

## Validation

The frozen route 288 fixture matches all 15 stops in published order. The chosen road path retains all 714 source vertices; the largest projected stop error is about 12 m, with about 5 m average. A mocked geometry-only request returns one outbound road route and no invented inbound variant. Tests also verify that a KMB stop-only fallback contributes no map line. A local browser check covers that unavailable-road behavior in both map modes. This checks the geometry and application data paths without relying on a live provider during CI.

A separate live adapter call on 8 November 2026 returned one outbound route with `geometry: "road"`, 714 vertices, 15 stops and about 7,385 m of road distance. This confirms that the current provider response takes the verified road path; it is a point-in-time observation, not a guarantee that the external feed will always be available.

The official dataset describes a road route, not live bus GPS. Provider revisions and temporary feed failures can change what is available; an unmatched direction will remain visibly unavailable until a matching road shape can be verified.
