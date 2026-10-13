import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocationMotion, locationTransitionDuration, validLocationFix, type LocationPoint } from '../lib/location-motion.ts';

function fixture() {
  let now = 0, nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const rendered: LocationPoint[] = [];
  const motion = createLocationMotion(point => rendered.push(point), {
    now: () => now,
    request: callback => { frames.set(++nextId, callback); return nextId; },
    cancel: id => { frames.delete(id); },
  });
  const advance = (at: number) => {
    now = at;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(at);
  };
  return { motion, rendered, frames, advance, position: () => rendered.at(-1) };
}

test('location interpolates confirmed fixes and stops at the latest point without predicting travel', () => {
  const f = fixture();
  f.motion.moveTo([22, 114], 1000);
  assert.deepEqual(f.position(), [22, 114], 'The first fix is immediately visible');
  assert.equal(f.frames.size, 0);
  f.motion.moveTo([22.01, 114.02], 1000);
  assert.deepEqual(f.position(), [22, 114], 'Receiving a fix must not jump to the endpoint');
  f.advance(250);
  assert.deepEqual(f.position(), [22.0025, 114.005]);
  f.advance(500);
  assert.ok(Math.abs(f.position()![0] - 22.005) < 1e-10);
  assert.ok(Math.abs(f.position()![1] - 114.01) < 1e-10);
  f.advance(1000);
  assert.deepEqual(f.position(), [22.01, 114.02]);
  assert.equal(f.frames.size, 0);
  f.advance(20000);
  assert.deepEqual(f.position(), [22.01, 114.02], 'Travel never extrapolates beyond the confirmed fix');
});

test('a new fix interrupts from the displayed point and cannot revive cancelled frames', () => {
  const f = fixture();
  f.motion.moveTo([0, 0], 0);
  f.motion.moveTo([10, 10], 1000);
  f.advance(400);
  const cancelledFrame = [...f.frames.values()][0];
  f.motion.moveTo([0, 12], 600);
  assert.deepEqual(f.position(), [4, 4], 'Retargeting preserves the current on-screen point');
  assert.equal(f.frames.size, 1);
  cancelledFrame(700);
  assert.deepEqual(f.position(), [4, 4], 'An obsolete frame cannot apply the previous target');
  f.advance(700);
  assert.deepEqual(f.position(), [2, 8]);
  f.advance(1000);
  assert.deepEqual(f.position(), [0, 12]);
  assert.equal(f.frames.size, 0);
});

test('reduced motion or backgrounding settles the latest fix and clears animation work', () => {
  const f = fixture();
  f.motion.moveTo([0, 0], 0);
  f.motion.moveTo([10, 20], 1000);
  f.advance(300);
  f.motion.finish();
  assert.deepEqual(f.position(), [10, 20]);
  assert.equal(f.frames.size, 0);
  f.motion.moveTo([20, 30], 0);
  assert.deepEqual(f.position(), [20, 30], 'Hidden or reduced-motion updates are immediate');
  assert.equal(f.frames.size, 0);
});

test('stopping or unmounting cancels all work and prevents subsequent writes', () => {
  const f = fixture();
  f.motion.moveTo([0, 0], 0);
  f.motion.moveTo([10, 20], 1000);
  const pending = [...f.frames.values()][0];
  f.advance(100);
  f.motion.dispose();
  assert.equal(f.frames.size, 0);
  const rendered = f.rendered.length;
  pending(500);
  f.motion.finish();
  f.motion.moveTo([30, 40], 1000);
  f.advance(5000);
  assert.equal(f.rendered.length, rendered);
  assert.equal(f.frames.size, 0);
});

test('unchanged fixes do not run a stationary animation and delayed frames land exactly', () => {
  const f = fixture();
  f.motion.moveTo([22, 114], 0);
  f.motion.moveTo([22, 114], 1000);
  assert.equal(f.frames.size, 0);
  f.motion.moveTo([23, 115], 1000);
  f.advance(5000);
  assert.deepEqual(f.position(), [23, 115]);
  assert.equal(f.frames.size, 0);
});

test('GPS cadence bounds limit interpolation delay after fast or infrequent fixes', () => {
  assert.equal(locationTransitionDuration(50), 150);
  assert.equal(locationTransitionDuration(450), 450);
  assert.equal(locationTransitionDuration(1000), 1000);
  assert.equal(locationTransitionDuration(30000), 1000);
  assert.equal(locationTransitionDuration(Number.NaN), 1000);
});

test('malformed, duplicate and reordered GPS fixes cannot move the map back to an old sample', () => {
  const fix = (timestamp: number, overrides: Partial<GeolocationCoordinates> = {}) => ({ timestamp, coords: { latitude: 22.3, longitude: 114.2, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}), ...overrides } as GeolocationCoordinates });
  assert.equal(validLocationFix(fix(2000), 1000), true);
  assert.equal(validLocationFix(fix(1000), 1000), false);
  assert.equal(validLocationFix(fix(999), 1000), false);
  assert.equal(validLocationFix(fix(NaN)), false);
  for (const invalid of [{ latitude: NaN }, { latitude: 91 }, { longitude: 181 }, { accuracy: -1 }, { accuracy: Infinity }]) assert.equal(validLocationFix(fix(2000, invalid)), false);
  const f = fixture();
  f.motion.moveTo([22, 114], 0);
  f.motion.moveTo([23, 115], 1000);
  f.motion.moveTo([NaN, 114], 0);
  f.advance(1000);
  assert.deepEqual(f.position(), [23, 115], 'An invalid point cannot cancel a valid pending transition');
});
