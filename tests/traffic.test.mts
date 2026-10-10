import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLiveTrafficDataFresh,
  liveTrafficMaxAgeMs,
  officialHongKongTimestamp,
  speedLevel,
} from '../lib/traffic.ts';
import { parseCsv, parseSegmentRouteNumbers, pickLatestPeriod, popupFields } from '../lib/traffic-parsing.ts';
import { cameraFromFlowSegment, displayFlowSegments, searchTrafficItems } from '../lib/traffic-view.ts';
import type { FlowSegment } from '../lib/traffic.ts';
import { getCameraData } from '../lib/traffic-client.ts';

test('speedLevel classifies urban-road traffic bands', () => {
  assert.equal(speedLevel(0), 'slow');
  assert.equal(speedLevel(15), 'slow');
  assert.equal(speedLevel(15.1), 'moderate');
  assert.equal(speedLevel(30), 'moderate');
  assert.equal(speedLevel(30.1), 'free');
});

test('speedLevel classifies major-road traffic bands from the speed limit', () => {
  assert.equal(speedLevel(25, 70), 'slow');
  assert.equal(speedLevel(25.1, 70), 'moderate');
  assert.equal(speedLevel(50, 70), 'moderate');
  assert.equal(speedLevel(50.1, 70), 'free');
});

test('speedLevel never treats missing or malformed readings as free flow', () => {
  assert.equal(speedLevel(null), 'unknown');
  assert.equal(speedLevel(Number.NaN), 'unknown');
  assert.equal(speedLevel(Number.POSITIVE_INFINITY), 'unknown');
  assert.equal(speedLevel(-1), 'unknown');
});

test('officialHongKongTimestamp accepts only real local date-times', () => {
  assert.equal(officialHongKongTimestamp('2026-09-20', '10:51:00'), '2026-09-20T10:51:00+08:00');
  assert.equal(officialHongKongTimestamp('2026-02-29', '10:51:00'), undefined);
  assert.equal(officialHongKongTimestamp('2026-09-20', '24:00:00'), undefined);
  assert.equal(officialHongKongTimestamp('20/09/2026', '10:51:00'), undefined);
  assert.equal(officialHongKongTimestamp(undefined, '10:51:00'), undefined);
});

test('isLiveTrafficDataFresh rejects expired and implausibly future readings', () => {
  const now = Date.parse('2026-09-20T11:00:00+08:00');
  assert.equal(isLiveTrafficDataFresh('2026-09-20T11:00:00+08:00', now), true);
  assert.equal(isLiveTrafficDataFresh(new Date(now - liveTrafficMaxAgeMs).toISOString(), now), true);
  assert.equal(isLiveTrafficDataFresh(new Date(now - liveTrafficMaxAgeMs - 1).toISOString(), now), false);
  assert.equal(isLiveTrafficDataFresh(new Date(now + 5 * 60 * 1000).toISOString(), now), true);
  assert.equal(isLiveTrafficDataFresh(new Date(now + 5 * 60 * 1000 + 1).toISOString(), now), false);
  assert.equal(isLiveTrafficDataFresh('not-a-date', now), false);
  assert.equal(isLiveTrafficDataFresh(undefined, now), false);
});

test('shared traffic parsers handle quoted CSV, route numbers and popup markup', () => {
  assert.deepEqual(parseCsv('id,name\r\n1,"Road, East"\r\n2,"A ""quoted"" road"'), [
    ['id', 'name'],
    ['1', 'Road, East'],
    ['2', 'A "quoted" road'],
  ]);
  assert.deepEqual([...parseSegmentRouteNumbers('irn_id,ucase(route)\n375,1\n1060,"ABERDEEN PRAYA ROAD"')], [[375, 1]]);
  assert.deepEqual(popupFields('<tr><th> SITE </th><td>Road &amp; Tunnel</td></tr>'), { SITE: 'Road & Tunnel' });
});

test('pickLatestPeriod is stable for single, missing and unordered periods', () => {
  assert.equal(pickLatestPeriod(undefined), undefined);
  assert.deepEqual(pickLatestPeriod({ period_to: '10:00:00' }), { period_to: '10:00:00' });
  assert.deepEqual(pickLatestPeriod([{ period_to: '10:02:00' }, { period_to: '10:01:00' }]), { period_to: '10:02:00' });
});

const segment: FlowSegment = {
  id: 'flow-segment-375', routeId: 375, routeNum: 1, name: '告士打道', nameEn: 'Gloucester Road',
  speedKmh: 48, speedLimitKmh: 50, level: 'free', path: [[22.28, 114.17], [22.281, 114.172]],
};

test('retained live readings become unavailable when they age out between refreshes', () => {
  const updated = '2026-09-20T11:00:00+08:00';
  const now = Date.parse(updated);
  const original = [segment];
  assert.equal(displayFlowSegments(original, updated, now + liveTrafficMaxAgeMs), original);
  const stale = displayFlowSegments(original, updated, now + liveTrafficMaxAgeMs + 1);
  assert.equal(stale[0].level, 'unknown');
  assert.equal(stale[0].speedKmh, null);
  assert.deepEqual(stale[0].path, segment.path);
  assert.equal(segment.level, 'free');
  assert.equal(displayFlowSegments(original, undefined, now)[0].level, 'unknown');
  assert.deepEqual(displayFlowSegments(undefined, updated, now), []);
});

test('traffic search matches both languages, district names and identifiers without inventing metadata', () => {
  const road = { camera: cameraFromFlowSegment(segment), segment };
  const parking = { camera: { id: 'parking-1', sourceId: '1', kind: 'parking' as const, name: '灣仔停車場', nameEn: 'Wan Chai Car Park', district: '灣仔', districtEn: 'Wan Chai', lat: 22.28, lng: 114.17 } };
  assert.deepEqual(searchTrafficItems([road, parking], '  GLOUCESTER 375 ', 'en'), [road]);
  assert.deepEqual(searchTrafficItems([road, parking], '告士打', 'zh'), [road]);
  assert.deepEqual(searchTrafficItems([road, parking], '灣仔', 'en'), [parking]);
  assert.deepEqual(searchTrafficItems([road, parking], 'Wan Chai', 'zh'), [parking]);
  assert.deepEqual(searchTrafficItems([road, parking], 'missing road', 'en'), []);
  assert.equal(road.camera.district, undefined);
});

test('parking joins capacity with live vacancy counts per vehicle type without inventing missing data', async () => {
  const values = [10, 0, '12', undefined, null, '', ' ', -1, 'unknown', 'Infinity', 1.5, true];
  const expected = [10, 0, 12, null, null, null, null, null, null, null, null, null];
  type ParkingInfoFixture = { park_Id: string; name: string; latitude: number; longitude: number; privateCar?: { space: unknown }; LGV?: { space: unknown }; coach?: { space: unknown } };
  type ParkingVacancyFixture = { park_Id: string; privateCar?: { vacancy_type?: string; vacancy: unknown; lastupdate?: string }[]; LGV?: { vacancy_type?: string; vacancy: unknown; lastupdate?: string }[]; HGV?: { vacancy_type?: string; vacancy: unknown; lastupdate?: string }[] };
  const info: ParkingInfoFixture[] = values.map((space, index) => ({ park_Id: String(index), name: `Park ${index}`, latitude: 22.3, longitude: 114.1, privateCar: { space } }));
  const vacancy: ParkingVacancyFixture[] = values.map((count, index) => ({ park_Id: String(index), privateCar: [{ vacancy_type: 'A', vacancy: count }] }));
  for (const [index, type] of ['B', 'C', undefined].entries()) {
    info.push({ park_Id: `status-${index}`, name: `Status ${index}`, latitude: 22.3, longitude: 114.1, privateCar: { space: 100 } });
    vacancy.push({ park_Id: `status-${index}`, privateCar: [{ vacancy_type: type, vacancy: 1 }] });
  }
  // A car park serving several vehicle types keeps them apart, including one that only publishes
  // a live count (HGV) and one that only publishes capacity (coach).
  info.push({ park_Id: 'multi', name: 'Multi', latitude: 22.3, longitude: 114.1, privateCar: { space: 100 }, LGV: { space: 5 }, coach: { space: 2 } });
  vacancy.push({ park_Id: 'multi', privateCar: [{ vacancy_type: 'A', vacancy: 40, lastupdate: '2026-10-03 12:00:00' }], LGV: [{ vacancy_type: 'A', vacancy: 1 }], HGV: [{ vacancy_type: 'A', vacancy: 0, lastupdate: '2026-10-03 12:05:00' }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => Response.json({ results: new URL(String(input)).searchParams.get('data') === 'info' ? info : vacancy });
  try {
    const data = await getCameraData('parking');
    assert.deepEqual(data.cameras.slice(0, values.length).map(camera => camera.parkingSpaces), expected.map((count, index) => index === 1 || count === null ? undefined : [{ type: 'privateCar', available: count, total: count }]));
    assert.deepEqual(data.cameras.slice(values.length, values.length + 3).map(camera => camera.parkingSpaces), [[{ type: 'privateCar', available: null, total: 100 }], [{ type: 'privateCar', available: null, total: 100 }], [{ type: 'privateCar', available: null, total: 100 }]]);
    const multi = data.cameras.find(camera => camera.sourceId === 'multi')!;
    assert.deepEqual(multi.parkingSpaces, [
      { type: 'privateCar', available: 40, total: 100 },
      { type: 'LGV', available: 1, total: 5 },
      { type: 'HGV', available: 0, total: null },
      { type: 'coach', available: null, total: 2 },
    ]);
    assert.equal(multi.dataUpdated, '2026-10-03T12:05:00+08:00', 'The newest type report dates the car park');
  } finally { globalThis.fetch = originalFetch; }
});
