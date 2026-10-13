import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeDistances } from '../lib/bus-route-motion.ts';
import { vehicleCorrection, vehicleFrame, type VehicleRoutePosition } from '../lib/vehicle-motion.ts';

const coordinates: [number, number][] = [[114, 22], [114.001, 22], [114.001, 22.001]];
const distances = routeDistances(coordinates);
const route = (distance: number, key = 'route'): VehicleRoutePosition => ({ key, distance, coordinates, distances });

test('a refreshed estimate follows its route through bends and settles at the latest distance', () => {
  const previous = { point: coordinates[0], route: { key: 'route', distance: 0 }, at: 1000 };
  const target = { point: coordinates[2], route: route(distances[2]) };
  const correction = vehicleCorrection(previous, target, 1000, false)!;
  assert.deepEqual(vehicleFrame(target, correction, 1000).point, coordinates[0]);
  for (let time = 1000; time <= 2000; time += 25) {
    const frame = vehicleFrame(target, correction, time);
    assert.ok(Math.abs(frame.point[1] - 22) < 1e-10 || Math.abs(frame.point[0] - 114.001) < 1e-10, 'Smoothing cannot cut across the inside of the route bend');
  }
  assert.deepEqual(vehicleFrame(target, correction, 2000).point, coordinates[2]);
  assert.equal(vehicleFrame(target, correction, 2000).active, false);
});

test('an interrupted correction starts at the displayed position without restarting from the old fix', () => {
  const target = { point: coordinates[2], route: route(150) };
  const first = vehicleCorrection({ point: coordinates[0], route: { key: 'route', distance: 0 }, at: 1000 }, target, 1000, false);
  const shown = vehicleFrame(target, first, 1250);
  const refreshed = { point: coordinates[2], route: route(190) };
  const next = vehicleCorrection({ point: shown.point, route: { key: 'route', distance: shown.distance! }, at: 1250 }, refreshed, 1250, false);
  assert.deepEqual(vehicleFrame(refreshed, next, 1250).point, shown.point);
});

test('changed routes, long background gaps and implausible offsets cannot replay stale movement', () => {
  const previous = { point: coordinates[0], route: { key: 'route', distance: 0 }, at: 1000 };
  assert.equal(vehicleCorrection(previous, { point: coordinates[2], route: route(150, 'reverse') }, 1100, false), undefined);
  assert.equal(vehicleCorrection(previous, { point: coordinates[2], route: route(150) }, 4000, false), undefined);
  assert.equal(vehicleCorrection(previous, { point: coordinates[2], route: route(2000) }, 1100, false), undefined);
  assert.equal(vehicleCorrection({ point: [114, 22], at: 1000 }, { point: [114.2, 22] }, 1100, true), undefined, 'A discontinuous GPS fix cannot animate a high-speed cross-city trip');
  const correction = vehicleCorrection(previous, { point: coordinates[2], route: route(150) }, 1000, false)!;
  const changed = { point: coordinates[2], route: route(150, 'reverse') };
  assert.equal(vehicleFrame(changed, correction, 1250).distance, 150, 'A retained correction cannot shift a different route');
});

test('an unsurveyed GPS update interpolates only to the confirmed fix and reduced motion keeps data current', () => {
  const previous = { point: [114, 22] as [number, number], at: 1000 };
  const target = { point: [114.002, 22.002] as [number, number] };
  const correction = vehicleCorrection(previous, target, 1000, true)!;
  assert.deepEqual(vehicleFrame(target, correction, 1000).point, previous.point);
  const mid = vehicleFrame(target, correction, 1500).point;
  assert.ok(mid[0] > previous.point[0] && mid[0] < target.point[0]);
  assert.deepEqual(vehicleFrame(target, correction, 5000).point, target.point, 'No unconfirmed GPS velocity is extrapolated');
  assert.deepEqual(vehicleFrame(target, undefined, 1000).point, target.point, 'A reduced-motion renderer applies the latest target immediately');
});
