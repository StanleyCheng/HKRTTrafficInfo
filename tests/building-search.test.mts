import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuildingResults, searchBuildings } from '../lib/building-search.ts';
import { parseSession } from '../lib/session-state.ts';

const building = (overrides = {}) => ({ Address: { PremisesAddress: {
  GeoAddress: '3428516348P20050905',
  EngPremisesAddress: { BuildingName: 'TWO INTERNATIONAL FINANCE CENTRE', EngStreet: { BuildingNoFrom: '8', StreetName: 'FINANCE STREET' }, EngDistrict: { DcDistrict: 'CENTRAL & WESTERN' } },
  ChiPremisesAddress: { BuildingName: '國際金融中心二期', ChiStreet: { BuildingNoFrom: '8', StreetName: '金融街' } },
  GeospatialInformation: { Latitude: '22.28602', Longitude: '114.15763' }, ...overrides,
} } });

test('building results preserve both languages, shared podium identities and valid coordinates', () => {
  const payload = { SuggestedAddress: [building(), building(), building({ EngPremisesAddress: { BuildingName: 'IFC MALL' }, ChiPremisesAddress: { BuildingName: '國際金融中心商場' } })] };
  const results = parseBuildingResults(payload);
  assert.equal(results.length, 2);
  assert.equal(results[0].name, '國際金融中心二期');
  assert.equal(results[0].address, '金融街8號');
  assert.equal(results[0].addressEn, '8 FINANCE STREET, CENTRAL & WESTERN');
  assert.equal(results[0].lat, 22.28602);
});

test('building search rejects invalid coordinates and malformed service payloads', () => {
  assert.deepEqual(parseBuildingResults({ SuggestedAddress: [building({ GeospatialInformation: { Latitude: '', Longitude: null } }), building({ GeospatialInformation: { Latitude: '51', Longitude: '0' } }), null] }), []);
  assert.throws(() => parseBuildingResults({ error: 'upstream failure' }));
  assert.deepEqual(parseBuildingResults({ SuggestedAddress: [] }), []);
});

test('building search bounds input, sends bilingual JSON requests and caches successful results', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(new URL(String(input)).searchParams.get('q'), '國際金融中心二期');
    assert.equal(new Headers(init?.headers).get('accept'), 'application/json');
    return Response.json({ SuggestedAddress: [building()] });
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await searchBuildings('x', signal), []);
  assert.deepEqual(await searchBuildings('x'.repeat(201), signal), []);
  assert.equal((await searchBuildings('國際金融中心二期', signal)).length, 1);
  assert.equal((await searchBuildings(' 國際金融中心二期 ', signal)).length, 1);
  assert.equal(calls, 1);
  assert.equal(parseSession({ version: 1, searchScope: 'buildings' }).searchScope, 'buildings');
});
