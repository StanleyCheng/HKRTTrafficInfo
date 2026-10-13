import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busVehicleDistanceAtTime, routeDistances, routeHeadingAtDistance, routePointAtDistance } from '../lib/bus-route-motion.ts';
import type { BusVehicle } from '../lib/bus-route.ts';

test('bus motion follows route bends, repeated vertices and stops at path endpoints', () => {
  const path: [number, number][] = [[114, 22], [114.01, 22], [114.01, 22], [114.01, 22.01]];
  const distances = routeDistances(path);
  assert.ok(distances[1] > 1000 && distances[1] < 1100);
  assert.deepEqual(routePointAtDistance(path, distances, distances[1]), path[1]);
  const halfway = routePointAtDistance(path, distances, (distances[2] + distances[3]) / 2)!;
  assert.equal(halfway[0], 114.01);
  assert.ok(Math.abs(halfway[1] - 22.005) < 1e-8);
  assert.deepEqual(routePointAtDistance(path, distances, -100), path[0]);
  assert.deepEqual(routePointAtDistance(path, distances, Infinity), null);
  assert.deepEqual(routePointAtDistance(path, distances, distances[3] + 100), path[3]);
  assert.deepEqual(routePointAtDistance([], [], 0), null);
  assert.deepEqual(routePointAtDistance([[114, 22]], [0], 10), [114, 22]);
});

test('bus trajectory uses absolute time, holds before departure and suppresses expired movement', () => {
  const vehicle: BusVehicle = { id: 'bus', fromDistance: 100, toDistance: 500, departureAt: 1000, arrivalAt: 5000, validUntil: 6000 };
  assert.equal(busVehicleDistanceAtTime(vehicle, 3000), 300);
  assert.equal(busVehicleDistanceAtTime(vehicle, 5500), 500);
  assert.equal(busVehicleDistanceAtTime(vehicle, 999), 100, 'Before departure the bus holds at the segment start');
  assert.equal(busVehicleDistanceAtTime(vehicle, 6001), null);
  assert.equal(busVehicleDistanceAtTime({ ...vehicle, departureAt: Number.NaN }, 3000), null);
  assert.equal(busVehicleDistanceAtTime({ ...vehicle, fromDistance: NaN }, 999), null, 'Malformed pre-departure data cannot bypass validation');
  assert.equal(busVehicleDistanceAtTime({ ...vehicle, validUntil: NaN }, 999), null);
  assert.equal(busVehicleDistanceAtTime({ ...vehicle, toDistance: 50 }, 3000), null, 'A reversed distance interval cannot drive a bus backwards');
  assert.equal(busVehicleDistanceAtTime(vehicle, NaN), null);
  assert.equal(routePointAtDistance([[114, 22], [115, 23]], [0], 100), null, 'Mismatched route distances cannot crash marker updates');
});

test('route heading follows travel direction and clamps at the terminus', () => {
  const east: [number, number][] = [[114, 22.3], [114.01, 22.3]];
  const eastDistances = routeDistances(east);
  assert.ok(Math.abs(routeHeadingAtDistance(east, eastDistances, 0)! - 90) < 0.5);
  assert.ok(Math.abs(routeHeadingAtDistance(east, eastDistances, eastDistances[1] / 2)! - 90) < 0.5);
  // Past the end the epsilon cannot look ahead, so the final segment bearing holds.
  assert.ok(Math.abs(routeHeadingAtDistance(east, eastDistances, eastDistances[1] + 500)! - 90) < 0.5);

  const bend: [number, number][] = [[114, 22.3], [114.01, 22.3], [114.01, 22.31]];
  const bendDistances = routeDistances(bend);
  assert.ok(Math.abs(routeHeadingAtDistance(bend, bendDistances, bendDistances[1] / 2)! - 90) < 0.5);
  const northernLeg = (bendDistances[1] + bendDistances[2]) / 2;
  const northHeading = routeHeadingAtDistance(bend, bendDistances, northernLeg)!;
  assert.ok(northHeading < 1 || northHeading > 359);

  // Westbound and southbound point the glyph back the other way.
  const west: [number, number][] = [[114.01, 22.3], [114, 22.3]];
  assert.ok(Math.abs(routeHeadingAtDistance(west, routeDistances(west), 10)! - 270) < 0.5);
  const south: [number, number][] = [[114, 22.31], [114, 22.3]];
  assert.ok(Math.abs(routeHeadingAtDistance(south, routeDistances(south), 10)! - 180) < 0.5);

  // Degenerate routes have no bearing.
  assert.equal(routeHeadingAtDistance([], [], 0), null);
  assert.equal(routeHeadingAtDistance([[114, 22.3]], [0], 0), null);
  assert.equal(routeHeadingAtDistance([[114, 22.3], [114, 22.3]], routeDistances([[114, 22.3], [114, 22.3]]), 0), null);
  assert.equal(routeHeadingAtDistance(east, eastDistances, NaN), null);
});
