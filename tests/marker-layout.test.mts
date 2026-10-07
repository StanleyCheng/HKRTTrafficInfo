import assert from 'node:assert/strict';
import { markerOffsets } from '../lib/marker-layout.ts';

const points = Array.from({ length: 40 }, (_, index) => ({ id: `point-${index}`, x: 80, y: 120, size: 32 }));
const placed = markerOffsets(points);
assert.equal(placed.size, points.length, 'crowding never removes a record');
assert.deepEqual(placed, markerOffsets([...points].reverse()), 'order is stable across refreshes');
assert.ok([...placed.values()].every(offset => Math.hypot(offset.x, offset.y) <= Math.hypot(34, 34)));
assert.equal(new Set([...markerOffsets(points.slice(0, 9)).values()].map(offset => `${offset.x}:${offset.y}`)).size, 9, 'nine co-located markers each have an individual slot');
const pair = markerOffsets(points.slice(0, 2));
assert.notDeepEqual(pair.get('point-0'), pair.get('point-1'), 'co-located points separate when space permits');
assert.deepEqual(markerOffsets([{ id: 'alone', x: -300, y: 0, size: 32 }]).get('alone'), { x: 0, y: 0 });
assert.ok(points.every(point => point.x === 80 && point.y === 120), 'layout never changes source coordinates');
