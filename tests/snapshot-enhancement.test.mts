import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotAdjustments, neutralAdjustments } from '../lib/snapshot-enhancement.ts';

const pixels = (values: number[]) => new Uint8ClampedArray(values.flatMap(value => [value, value, value, 255]));
test('snapshot analysis brightens a dim scene and increases low contrast within safe bounds', () => {
  const adjustments = snapshotAdjustments(pixels(Array.from({ length: 100 }, (_, i) => 30 + i)));
  assert.ok(adjustments.brightness > 1 && adjustments.brightness <= 1.25);
  assert.ok(adjustments.contrast > 1 && adjustments.contrast <= 1.35);
});
test('empty, transparent and flat images are left neutral; broad contrast is not amplified', () => {
  assert.deepEqual(snapshotAdjustments(new Uint8ClampedArray()), neutralAdjustments);
  assert.deepEqual(snapshotAdjustments(new Uint8ClampedArray([50, 50, 50, 0])), neutralAdjustments);
  assert.deepEqual(snapshotAdjustments(pixels([100, 100, 100])), neutralAdjustments);
  assert.equal(snapshotAdjustments(pixels(Array.from({ length: 256 }, (_, i) => i))).contrast, 1);
});
