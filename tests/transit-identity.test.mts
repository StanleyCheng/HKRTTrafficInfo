import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileTransitIdentities, type TransitIdentitySample } from '../lib/transit-identity.ts';

const now = 1_000_000;
const sample = (id: string, distance: number, overrides: Partial<TransitIdentitySample> = {}): TransitIdentitySample => ({ id, distance, key: 'TWL:A>B>C', destination: 'C', observedAt: now, ...overrides });

test('anchor and serial changes retain UI identities by directed route and projected distance', () => {
  const previous = [sample('old-leading', 1800), sample('old-following', 500)];
  const next = [sample('new-following-anchor', 520), sample('new-leading-anchor', 1820), sample('new-service', 3500)];
  assert.deepEqual(reconcileTransitIdentities(previous, next, now), ['old-following', 'old-leading', 'new-service']);
});

test('nearby estimates are matched one-to-one and route branches or destinations stay distinct', () => {
  assert.deepEqual(reconcileTransitIdentities([sample('one', 1000)], [sample('first', 1100), sample('second', 1020)], now), ['first', 'one']);
  const previous = [sample('branch', 100), sample('destination', 200)];
  const next = [sample('other-branch', 100, { key: 'TWL:C>B>A' }), sample('other-destination', 200, { destination: 'B' })];
  assert.deepEqual(reconcileTransitIdentities(previous, next, now), ['other-branch', 'other-destination']);
});

test('stale, invalid or distant estimates cannot revive a reused feed serial', () => {
  for (const before of [sample('reused', 500, { observedAt: now - 180_001 }), sample('reused', NaN), sample('reused', 500, { observedAt: now + 60_001 }), sample('reused', 5000)]) {
    const [id] = reconcileTransitIdentities([before], [sample('reused', 500)], now);
    assert.notEqual(id, 'reused');
  }
});

test('identities are unique even when an incoming serial collides with a matched prior ID', () => {
  const ids = reconcileTransitIdentities([sample('keep', 500)], [sample('feed-changed', 520), sample('keep', 4000), sample('keep', 6000)], now);
  assert.equal(ids[0], 'keep');
  assert.equal(new Set(ids).size, ids.length);
});
