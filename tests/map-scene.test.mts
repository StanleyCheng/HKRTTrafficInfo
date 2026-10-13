import assert from 'node:assert/strict';
import { nativeZoom, sharedZoom, trafficLines, transportLines } from '../lib/map-scene.ts';
import type { FlowSegment } from '../lib/traffic.ts';
import type { BusRouteResponse } from '../lib/bus-route.ts';

assert.equal(nativeZoom(16), 15, 'Native 512px tiles preserve the scale of the 256px Leaflet map');
assert.equal(sharedZoom(13), 14, 'The shared viewport still enables bus feeds at the same geographic scale');
assert.equal(sharedZoom(nativeZoom(15.375)), 15.375, 'Fractional zoom survives repeated renderer switches');
const segment: FlowSegment = { id: 'flow-segment-1', routeId: 1, name: 'Fixture Road', speedKmh: 30, speedLimitKmh: 50, level: 'slow', path: [[22.28, 114.15], [22.29, 114.16]] };
const roads = trafficLines([segment, { ...segment, id: 'invalid', path: [[NaN, 114.15], [22.29, 114.16]] }], segment.id);
assert.equal(roads.features.length, 1, 'Invalid geometry never reaches the GPU source');
assert.deepEqual(roads.features[0].geometry.coordinates, [[114.15, 22.28], [114.16, 22.29]], 'Latitude and longitude are converted for GeoJSON');
assert.equal(roads.features[0].properties?.width, 7.2, 'The selected road is emphasized');
const busRoute: BusRouteResponse = { ok: true, stale: false, observedAt: null, vehicles: [], reverse: [], route: { key: '1', operator: 'kmb', route: '1', stops: [], geometry: 'road', coordinates: [[114.16, 22.29], [114.17, 22.3]] } };
const transport = transportLines([{ id: 'mtr-test', color: '#318dbe', points: segment.path }], busRoute);
assert.deepEqual(transport.features[0].geometry.coordinates, roads.features[0].geometry.coordinates, 'Rail geometry uses the same coordinate conversion');
assert.deepEqual(transport.features[1].geometry.coordinates, busRoute.route!.coordinates, 'Bus geometry is already GeoJSON ordered and must not be reversed');
assert.equal(transportLines([], { ...busRoute, route: undefined }).features.length, 0, 'Clearing a bus route also clears its geometry');
