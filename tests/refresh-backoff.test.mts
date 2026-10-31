import assert from 'node:assert/strict'
import test from 'node:test'
import { RefreshBackoff } from '../lib/refresh-backoff.ts'

test('repeated failures back off, cap the delay and leave healthy requests independent', () => {
  const retry = new RefreshBackoff()
  let now = 1_000
  for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
    assert.equal(retry.due('failed', now), true)
    retry.fail('failed', now)
    assert.equal(retry.due('failed', now + delay - 1), false)
    assert.equal(retry.due('healthy', now), true)
    now += delay
    assert.equal(retry.due('failed', now), true)
  }
})
test('successful recovery and explicit retry reset the failure history', () => {
  const retry = new RefreshBackoff()
  retry.fail('operator', 0); retry.fail('operator', 30_000)
  retry.reset('operator')
  assert.equal(retry.due('operator', 30_001), true)
  retry.fail('operator', 30_001)
  assert.equal(retry.due('operator', 60_001), true)
  retry.fail('another', 60_001)
  retry.reset()
  assert.equal(retry.due('another', 60_001), true)
})
