import assert from 'node:assert/strict';
import test from 'node:test';
import { retainBusRoute } from '../lib/bus-route-state.ts';
import type { BusRouteResponse } from '../lib/bus-route.ts';

const now = 1_000_000;
const good: BusRouteResponse = {
  ok: true, stale: false, observedAt: new Date(now).toISOString(), reverse: [],
  route: { key: 'kmb:115:O', operator: 'kmb', route: '115', geometry: 'stops', stops: [], coordinates: [[114, 22], [114.01, 22]] },
  vehicles: [{ id: 'bus', fromDistance: 0, toDistance: 1000, departureAt: now - 60_000, arrivalAt: now + 60_000, validUntil: now + 180_000 }],
};

test('route refresh failure keeps the original unexpired trajectory and cannot extend its lifetime', () => {
  const failed: BusRouteResponse = { ok: false, vehicles: [], reverse: [], observedAt: null, stale: true };
  const held = retainBusRoute(good, failed, now + 30_000);
  assert.equal(held.stale, true);
  assert.deepEqual(held.vehicles, good.vehicles);
  assert.equal(held.observedAt, good.observedAt);
  assert.deepEqual(retainBusRoute(held, failed, now + 180_000).vehicles, []);
});

test('a partial route response retains its own trajectory but clears on healthy no-service data', () => {
  const partial = { ...good, vehicles: [], stale: true };
  assert.deepEqual(retainBusRoute(good, partial, now + 20_000).vehicles, good.vehicles);
  assert.deepEqual(retainBusRoute(good, { ...partial, stale: false }, now + 20_000).vehicles, []);
  const other = { ...partial, route: { ...good.route!, key: 'kmb:115:I' } };
  assert.deepEqual(retainBusRoute(good, other, now).vehicles, [], 'Another direction cannot inherit a bus');
  const changedGeometry = { ...partial, route: { ...good.route!, coordinates: [[114.1, 22], [114.2, 22]] as [number, number][] } };
  assert.deepEqual(retainBusRoute(good, changedGeometry, now).route, good.route, 'Retained distances keep their original geometry');
});

test('healthy forward and failed reverse directions retain and expire independently', () => {
  const previous = { ...good, reverse: [{ route: { ...good.route!, key: 'reverse' }, vehicles: [{ ...good.vehicles[0], id: 'reverse-bus' }] }] };
  const next = { ...good, vehicles: [], reverse: [{ ...previous.reverse[0], vehicles: [], stale: true }] };
  const held = retainBusRoute(previous, next, now + 30_000);
  assert.deepEqual(held.vehicles, [], 'The healthy forward no-service result is authoritative');
  assert.equal(held.reverse[0].vehicles.length, 1);
  assert.equal(held.reverse[0].stale, true);
  assert.deepEqual(retainBusRoute(held, next, now + 180_000).reverse[0].vehicles, []);
});

test('a changed stop/rank keeps nearby marker identities one-to-one on the same direction', () => {
  const next = { ...good, vehicles: [
    { ...good.vehicles[0], id: 'new-rank', fromDistance: 100, toDistance: 1100 },
    { ...good.vehicles[0], id: 'other-rank', fromDistance: 300, toDistance: 1300 },
  ] };
  const continued = retainBusRoute(good, next, now);
  assert.equal(continued.vehicles[0].id, 'bus');
  assert.equal(continued.vehicles[1].id, 'other-rank');
  assert.equal(new Set(continued.vehicles.map(vehicle => vehicle.id)).size, 2);
});
