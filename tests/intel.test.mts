import assert from 'node:assert/strict';
import test from 'node:test';
import { currentCrossingPoints, intelBoard, RANKED_LIMIT } from '../lib/intel.ts';
import { isCameraDataStale, isFeedDataStale, type CameraData, type FlowSegment } from '../lib/traffic.ts';
import { normalizeIntegration } from '../lib/integration-client.ts';
import type { ApproachesResponse } from '../lib/types.ts';

const now = Date.parse('2026-10-03T12:00:00+08:00');
const timestamp = new Date(now).toISOString();
const data = (override: Partial<CameraData> = {}): CameraData => ({ cameras: [], count: 0, expectedCount: 0, fetchedAt: timestamp, sourceLastModified: null, source: '', complete: true, ...override });
const segment = (id: string, name = 'Test Road'): FlowSegment => ({ id, routeId: 1, name, nameEn: name, speedKmh: 10, speedLimitKmh: 50, level: 'slow', path: [[22.3, 114.1], [22.31, 114.1]] });

test('critical flow fault ranks before incidents and road congestion', () => {
  const board = intelBoard({ now, segments: [segment('road')], states: { flow: { loading: false, error: true }, incident: { loading: false, error: false, data: data({ notices: [{ id: 'incident', text: '封路', textEn: 'Road closed', time: timestamp, located: false }] }) } } }, 'en');
  assert.deepEqual(board.ranked.slice(0, 3).map(item => item.kind), ['fault', 'incident', 'jam']);
  assert.equal(board.ranked[1].camera, undefined);
  assert.equal(board.ranked[1].title, 'Road closed');
});

test('all incident notices remain ranked even without map coordinates; cap is twelve', () => {
  const notices = Array.from({ length: 20 }, (_, i) => ({ id: String(i), text: '交通消息', textEn: 'Traffic notice', time: timestamp, located: false }));
  const board = intelBoard({ now, segments: [], states: { incident: { loading: false, error: false, data: data({ notices }) } } }, 'zh');
  assert.equal(board.ranked.length, RANKED_LIMIT);
  assert.equal(board.ranked[0].title, '交通消息');
});

test('fresh fetch does not make old official crossing observations current', () => {
  const old = new Date(now - 86400000).toISOString();
  const crossing = data({ fetchedAt: timestamp, observedAt: old, cameras: [{ id: 'h1', sourceId: 'H1', kind: 'crossing', name: 'Board', lat: 22.3, lng: 114.1, intel: { score: 600020, urgent: true, tone: 'red' } }] });
  assert.equal(isFeedDataStale('crossing', crossing, now), true);
  const board = intelBoard({ now, segments: [], states: { crossing: { data: crossing, loading: false, error: false } } }, 'en');
  assert.equal(board.ranked[0].id, 'fault-crossing');
  assert.equal(board.roads.some(item => item.kind === 'crossing'), false);
});

test('fresh crossing board never freshens old or undated neighbour recommendations', () => {
  const old = new Date(now - 86400000).toISOString();
  const payload: ApproachesResponse = { ok: true, fetchedAt: timestamp, capturedAt: timestamp, points: [
    { id: 'old', name: 'Old', nameTc: '舊資料', coordinates: [114.1, 22.3], observedAt: old, legs: [{ code: 'CH', name: 'CH', colour: 'green', minutes: 1 }] },
    { id: 'fresh', name: 'Fresh', nameTc: '新資料', coordinates: [114.2, 22.3], observedAt: timestamp, legs: [{ code: 'CH', name: 'CH', colour: 'red', minutes: 20 }] },
    { id: 'undated', name: 'Undated', nameTc: '未有時間', coordinates: [114.3, 22.3], legs: [{ code: 'CH', name: 'CH', colour: 'green', minutes: 2 }] },
  ] };
  const crossing = normalizeIntegration('crossing', payload);
  assert.equal(crossing.cameras[0].dataUpdated, old);
  assert.equal(crossing.cameras[2].dataUpdated, undefined);
  assert.equal(isCameraDataStale(crossing.cameras[0], now), true);
  assert.equal(isCameraDataStale(crossing.cameras[1], now), false);
  assert.equal(isCameraDataStale(crossing.cameras[2], now), true);
  assert.deepEqual(currentCrossingPoints(crossing, now).map(point => point.id), ['fresh']);
  const board = intelBoard({ now, segments: [], states: { crossing: { data: crossing, loading: false, error: false } } }, 'en');
  assert.deepEqual(board.roads.filter(item => item.kind === 'crossing').map(item => item.id), ['crossing-fresh']);
  assert.equal(board.systems.some(item => item.id === 'fault-crossing'), true);
});

test('unnamed road segments remain independent congestion items', () => {
  const board = intelBoard({ now, states: {}, segments: [segment('a', 'Unnamed road'), segment('b', 'Unnamed road')] }, 'en');
  assert.equal(board.roads.length, 2);
});

test('boundary warnings and faults route to their specific tabs', () => {
  const board = intelBoard({ now, segments: [], states: { boundary: { loading: false, error: false, data: data({ cameras: [{ id: 'boundary-a', sourceId: 'a', kind: 'boundary', name: '口岸', nameEn: 'Boundary', lng: 114, lat: 22.5, intel: { score: 750000, urgent: true, tone: 'red' } }] }) }, mtr: { loading: false, error: true } } }, 'zh');
  assert.equal(board.boundary[0].title, '口岸');
  assert.equal(board.systems[0].id, 'fault-mtr');
  assert.equal(board.notes.length, 1);
});
