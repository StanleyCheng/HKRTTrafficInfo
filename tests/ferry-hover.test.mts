import assert from 'node:assert/strict';
import test from 'node:test';
import { ferryDepartures, normalizeIntegration } from '../lib/integration-client.ts';
import type { FerryCall, FerryResponse } from '../lib/types.ts';

test('ferry pier departures retain every destination, ignore arrivals and advance countdowns', () => {
  const now = Date.parse('2026-10-07T12:00:00+08:00');
  const call = (overrides: Partial<FerryCall>): FerryCall => ({ route: '天星', destTc: '中環', destEn: 'Central', originTc: '', originEn: '', arriving: false, eta: '12:01', minutes: 1, remarkTc: '', remarkEn: '', scheduled: true, firstFerry: '06:30', lastFerry: '23:30', ...overrides });
  const payload: FerryResponse = { ok: true, observedAt: new Date(now).toISOString(), vessels: [], piers: [{ id: 'pier', nameTc: '碼頭', nameEn: 'Pier', lng: 114.17, lat: 22.3, calls: [
    call({ eta: '12:10' }), call({}), call({ arriving: true, destTc: '碼頭', destEn: 'Pier' }),
    ...Array.from({ length: 13 }, (_, index) => call({ destTc: `目的地${index}`, destEn: `Destination ${index}`, eta: '', minutes: null, firstFerry: undefined, lastFerry: undefined })),
  ] }] };
  const pier = normalizeIntegration('ferry', payload).cameras[0];
  const departures = ferryDepartures(pier, now);
  assert.equal(departures.length, 14);
  assert.equal(departures[0].eta, new Date(now + 60000).toISOString());
  assert.equal(departures[0].minutes, 1);
  assert.equal(departures[0].firstFerry, '06:30');
  assert.equal(departures[0].lastFerry, '23:30');
  assert.equal(departures[13].eta, undefined);
  assert.equal(departures[13].firstFerry, undefined);
  assert.equal(departures[13].minutes, null);
  assert.equal(ferryDepartures(pier, now + 61000)[0].minutes, 9);
  const ended = ferryDepartures(pier, now + 11 * 60000)[0];
  assert.equal(ended.eta, undefined);
  assert.equal(ended.minutes, null);
  assert.equal(ended.lastFerry, '23:30');
});
