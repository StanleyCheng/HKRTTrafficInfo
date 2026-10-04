// Acceptance checks use the real browser adapters for the seven original feeds.
// New integrations use hosted API routes; comparisons fetch independent official data.
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { getCameraData } from '../lib/traffic-client.ts';
import { isLiveTrafficDataFresh, speedLevel } from '../lib/traffic.ts';
import { loadSlpDetectors, parseSlpDetectors, SLP_LOCATIONS_URL, SLP_READINGS_URL } from '../lib/slp.ts';
import { parseCsv } from '../lib/traffic-parsing.ts';

const origin = (process.argv.find((arg) => /^https?:/.test(arg)) || 'http://localhost:5173').replace(/\/$/, '');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const report = [];
const parser = new XMLParser({ parseTagValue: false });
const array = (value) => Array.isArray(value) ? value : value ? [value] : [];
const officialHeaders = { Accept: 'application/json', Referer: 'https://www.hkemobility.gov.hk/en/' };
async function response(url, headers) {
  const result = await fetch(url, { headers, signal: AbortSignal.timeout(90000) });
  assert.equal(result.status, 200, `${url}: HTTP ${result.status}`);
  return result;
}
async function json(url, headers) { return (await response(url, headers)).json(); }
async function api(path) {
  const body = await json(`${origin}/api/${path}`);
  assert.equal(body.ok, true, `${path}: ${body.error || 'feed unavailable'}`);
  assert.ok(!body.stale, `${path}: retained stale data (${body.error || 'upstream failed'})`);
  assert.ok(!body.error, `${path}: partial update (${body.error})`);
  return body;
}
async function check(layer, run) {
  if (only && !only.includes(layer)) return;
  try { report.push({ layer, ok: true, ...await run() }); }
  catch (error) { report.push({ layer, ok: false, error: error.message }); }
  console.log(JSON.stringify(report.at(-1)));
}
function validLocations(data) {
  assert.equal(data.count, data.cameras.length);
  assert.equal(new Set(data.cameras.map((item) => item.id)).size, data.count);
  assert.ok(data.cameras.every((item) => item.name && item.lat > 22 && item.lat < 23 && item.lng > 113 && item.lng < 115));
}
const sources = {
  redlight: 'https://www.td.gov.hk/datagovhk_td/junctions-with-rlc/resources/junctions_with_rlc.csv',
  speed: 'https://www.td.gov.hk/datagovhk_td/locations-of-sec/resources/locations_of_sec.csv',
  snapshot: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml',
};
for (const [kind, source] of Object.entries(sources)) await check(kind, async () => {
  const [data, official] = await Promise.all([getCameraData(kind), response(source)]);
  const text = await official.text();
  const ids = kind === 'snapshot' ? array(parser.parse(text)['image-list'].image).map((row) => row.key)
    : [...text.matchAll(/^(\d+),/gm)].map((match) => match[1]);
  validLocations(data);
  assert.equal(data.complete, true);
  assert.deepEqual(data.cameras.map((item) => item.sourceId).sort(), ids.sort());
  return { officialCount: ids.length, displayedCount: data.count };
});
await check('flow', async () => {
  const data = await getCameraData('flow');
  validLocations(data);
  assert.ok(isLiveTrafficDataFresh(data.segmentsUpdated), 'Official speed publication is stale');
  const raw = parser.parse(await (await response('https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml')).text()).segment_speed_list;
  const timestamp = `${raw.date}T${raw.time}+08:00`;
  const gap = Math.abs(Date.parse(timestamp) - Date.parse(data.segmentsUpdated));
  assert.ok(gap <= 120000, `Speed snapshots differ by ${gap / 1000} seconds`);
  const speeds = new Map(array(raw.segments?.segment).map((row) => [Number(row.segment_id), row]));
  assert.equal(data.segmentsExpectedCount, speeds.size);
  assert.equal(new Set(data.segments.map((segment) => segment.id)).size, data.segments.length);
  assert.equal(data.segmentsComplete, data.segments.length === speeds.size);
  let compared = 0;
  for (const segment of data.segments) {
    assert.ok(segment.path.length >= 2 && segment.path.every((point) => point.length === 2 && point.every(Number.isFinite)));
    const row = speeds.get(segment.routeId);
    assert.ok(row, `Missing official speed row ${segment.routeId}`);
    if (gap !== 0) continue;
    const value = row.valid === 'Y' && Number.isFinite(Number(row.speed)) && Number(row.speed) >= 0 ? Number(row.speed) : null;
    assert.equal(segment.speedKmh, value === null ? null : Math.round(value));
    assert.equal(segment.level, speedLevel(value, segment.speedLimitKmh));
    compared++;
  }
  const saturation = await json('https://www.hkemobility.gov.hk/api/drss/layer/map?service=WFS&version=1.0.0&request=GetFeature&typeName=DRSS%3AVW_IRN_AVG_SPEED_MAP&outputFormat=application%2Fjson&srsName=EPSG%3A4326&maxFeatures=5000', officialHeaders);
  const officialLevels = new Map((saturation.features ?? []).map((feature) => {
    const value = feature.properties;
    const level = value.ROAD_SATURATION_LEVEL === 'TRAFFIC GOOD' ? 'free' : value.ROAD_SATURATION_LEVEL === 'TRAFFIC AVERAGE' ? 'moderate' : value.ROAD_SATURATION_LEVEL === 'TRAFFIC BAD' ? 'slow' : 'unknown';
    return [Number(value.SEGMENT_ID), { level, speed: Number(value.SPEED) }];
  }));
  let colourMatches = 0;
  for (const segment of data.segments) {
    const official = officialLevels.get(segment.routeId);
    // Compare only identical published speeds: the WFS and XML clocks can differ.
    if (segment.speedKmh === null || !official || Math.round(official.speed) !== segment.speedKmh) continue;
    assert.equal(segment.level, official.level, `Independent HKeMobility colour mismatch: ${segment.routeId}`);
    colourMatches++;
  }
  const valid = data.segments.filter((segment) => segment.speedKmh !== null).length;
  assert.ok(colourMatches >= valid * 0.9, `Too few matching WFS readings (${colourMatches}/${valid})`);
  return { officialCount: speeds.size, displayedCount: data.segments.length, speedRowsCompared: compared, officialColourMatches: colourMatches, publicationGapSeconds: gap / 1000 };
});
await check('slp', async () => {
  const [cameras, locations, readings] = await Promise.all([loadSlpDetectors(), response(SLP_LOCATIONS_URL), response(SLP_READINGS_URL)]);
  const csv = await locations.text();
  const xml = await readings.text();
  const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
  const headers = rows.shift().map((value) => value.trim().toLowerCase());
  const idIndex = headers.indexOf('aid_id_number');
  const ids = rows.filter((row) => row[idIndex]?.trim()).map((row) => row[idIndex].trim()).sort();
  assert.deepEqual(cameras.map((camera) => camera.sourceId).sort(), ids);
  const raw = parser.parse(xml).raw_speed_volume_list;
  const latest = array(raw.periods?.period).sort((a, b) => b.period_to.localeCompare(a.period_to))[0];
  const timestamp = `${raw.date}T${latest.period_to}+08:00`;
  assert.ok(cameras.every((camera) => isLiveTrafficDataFresh(camera.dataUpdated)), 'SLP publication is stale');
  const gap = Math.abs(Date.parse(cameras[0].dataUpdated) - Date.parse(timestamp));
  assert.ok(gap <= 120000, `SLP CDN publications differ by ${gap / 1000} seconds`);
  // Validate parser readings against this exact independently fetched snapshot
  // even when CDN edges gave the browser loader another publication.
  const parsed = parseSlpDetectors(csv, xml);
  const detectors = new Map(array(latest.detectors?.detector).map((detector) => [detector.detector_id, detector]));
  let compared = 0;
  for (const camera of [...parsed, ...cameras]) {
    if (camera.dataUpdated !== timestamp) continue;
    const values = array(detectors.get(camera.sourceId)?.lanes?.lane).filter((lane) => lane.valid === 'Y').map((lane) => Number(lane.speed)).filter((value) => Number.isFinite(value) && value >= 0);
    const expected = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    assert.equal(camera.speedKmh, expected);
    compared++;
  }
  assert.ok(compared >= cameras.length);
  return { officialCount: ids.length, displayedCount: cameras.length, comparedReadings: compared, publicationGapSeconds: gap / 1000 };
});
for (const kind of ['incident', 'parking', 'rainfall']) await check(kind, async () => {
  const data = await getCameraData(kind);
  validLocations(data);
  assert.ok(Number.isFinite(Date.parse(data.fetchedAt)));
  if (kind === 'rainfall') assert.ok(data.cameras.every((item) => Number.isFinite(item.rainfallMm)));
  return { displayedCount: data.count, expectedCount: data.expectedCount };
});
await check('snapshot-image', async () => {
  const image = await response('https://tdcctv.data.one.gov.hk/H106F.JPG');
  assert.ok(image.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg'));
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.ok(bytes.length > 1000);
  assert.deepEqual([...bytes.slice(0, 3)], [255, 216, 255]);
  return { bytes: bytes.length, sourceLastModified: image.headers.get('last-modified') };
});
await check('health', async () => { await api('health'); return { serving: origin }; });
const wfs = (typeName) => 'https://www.hkemobility.gov.hk/api/drss/layer/map?' + new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName, outputFormat: 'application/json', srsName: 'EPSG:4326' });
for (const [kind, typeName, idKey] of [['works', 'DRSS:VW_ROAD_WORK_EN', 'ROADWORKS_ID'], ['tolls', 'DRSS:DRSS_TOLL_POINT', 'FeatureID']]) await check(kind, async () => {
  const [data, upstream] = await Promise.all([api(kind), json(wfs(typeName), officialHeaders)]);
  const ids = [...new Set(upstream.features.filter((feature) => feature.geometry?.type === 'Point').map((feature) => String(feature.properties[idKey])))].sort();
  assert.deepEqual([...new Set(data[kind].features.map((feature) => String(feature.properties.id)))].sort(), ids);
  return { officialCount: ids.length, displayedCount: data[kind].features.length };
});
await check('approaches', async () => {
  const [data, locations] = await Promise.all([api('approaches'), json(wfs('DRSS:VW_JOURNEY_TIME_LOCATION_EN'), officialHeaders)]);
  const wanted = new Set(['H1', 'H2', 'H3', 'H4', 'H11', 'K02', 'K03', 'K07', 'K08']);
  const ids = locations.features.map((feature) => feature.properties.LOCATION_ID).filter((id) => wanted.has(id));
  assert.ok(data.points.length > 0 && data.points.length <= ids.length);
  assert.ok(data.points.every((point) => ids.includes(point.id) && point.legs.every((leg) => Number.isFinite(leg.minutes) && leg.minutes >= 0)));
  const sample = data.points[0];
  const detail = await json(`https://www.hkemobility.gov.hk/api/drss/getTextInfo/JourneyTime/en/${sample.id}`, officialHeaders);
  assert.ok(sample.legs.every((leg) => detail.some((row) => row.dest?.did === leg.code)));
  return { officialBoards: ids.length, activeBoards: data.points.length, sample: sample.id };
});
await check('boundary', async () => {
  const [data, resident, visitor] = await Promise.all([api('control-points'), json('https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json'), json('https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeV.json')]);
  assert.equal(data.points.features.length, 8);
  for (const feature of data.points.features) {
    const p = feature.properties;
    assert.ok(resident[p.code] && visitor[p.code]);
    for (const key of ['residentArrCode', 'residentDepCode', 'visitorArrCode', 'visitorDepCode']) assert.ok(Number.isFinite(p[key]));
  }
  return { displayedCount: data.points.features.length };
});
await check('warnings', async () => {
  const [data, upstream] = await Promise.all([api('warnings?lang=en'), json('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en')]);
  const codes = Object.entries(upstream).filter(([, row]) => row.actionCode !== 'CANCEL' && row.code !== 'CANCEL').map(([key, row]) => row.code || key).sort();
  assert.deepEqual(data.warnings.map((warning) => warning.code).sort(), codes);
  return { warnings: data.warnings.length };
});
await check('mtr', async () => {
  const data = await api('mtr');
  assert.ok(data.boards.length > 0 && Array.isArray(data.trains));
  const sample = data.boards[0];
  const upstream = await json(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${sample.line}&sta=${sample.station}`);
  assert.ok(upstream.status !== undefined);
  return { boards: data.boards.length, trains: data.trains.length, officialSample: `${sample.line}-${sample.station}` };
});
await check('lrt', async () => { const data = await api('lrt'); assert.ok(data.boards.length > 0 && Array.isArray(data.trains)); return { boards: data.boards.length, trains: data.trains.length }; });
for (const [kind, lng, lat, zoom] of [['kmb',114.17,22.32,15], ['citybus',114.17,22.28,15], ['gmb',114.17,22.32,17], ['nlb',113.94,22.29,15]]) await check(kind, async () => {
  const missing = await fetch(`${origin}/api/${kind}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(missing.status, 400, 'Missing coordinates must be rejected');
  const gated = await api(`${kind}?lng=114.2&lat=22.3&zoom=10`);
  assert.deepEqual(gated.stops, []);
  const query = `lng=${lng}&lat=${lat}&zoom=${zoom}`;
  const places = await api(`${kind}/places?${query}`);
  const data = await api(`${kind}?${query}`);
  assert.ok(Array.isArray(data.stops) && Array.isArray(places.stops));
  if (kind === 'nlb') {
    assert.ok(places.stops.length > 0, 'Lantau acceptance viewport must contain published NLB stops');
    assert.ok(data.stops.length > 0, 'NLB catalogue places must produce arrival boards');
    assert.deepEqual(data.stops.map((stop) => stop.id).sort(), places.stops.map((stop) => stop.id).sort(), 'NLB arrival boards must match nearby published stops');
  }
  assert.ok(data.stops.every((stop) => Array.isArray(stop.calls) && stop.calls.length <= 12));
  if (kind === 'kmb' && data.stops.length) {
    const sample = await json(`https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${data.stops[0].id}`);
    assert.ok(Array.isArray(sample.data));
  }
  return { nearbyPlaces: places.stops.length, arrivalBoards: data.stops.length };
});
await check('ferry', async () => {
  const data = await api('ferry');
  assert.ok(data.piers.length > 0 && Array.isArray(data.vessels));
  assert.ok(data.piers.every((pier) => Array.isArray(pier.calls)));
  return { piers: data.piers.length, vessels: data.vessels.length };
});
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), report }, null, 2));
if (report.some((item) => !item.ok)) process.exitCode = 1;
