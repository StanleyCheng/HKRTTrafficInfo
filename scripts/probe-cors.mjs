import { mkdir, writeFile } from 'node:fs/promises';

const origin = 'https://hkrttrafficinfo.vercel.app';
const probes = [
  ['boundary-resident', 'https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json'],
  ['boundary-visitor', 'https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeV.json'],
  ['kmb', 'https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/18492910339410B1'],
  ['citybus', 'https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/001145/1'],
  ['gmb', 'https://data.etagmb.gov.hk/eta/stop/20001142'],
  ['nlb', 'https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=1&stopId=1&lang=en'],
  ['warnings', 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en'],
  ['approaches', 'https://www.hkemobility.gov.hk/api/drss/getTextInfo/JourneyTime/en/H1'],
  ['works', 'https://www.hkemobility.gov.hk/api/drss/layer/map?service=WFS&version=1.0.0&request=GetFeature&typeName=DRSS:VW_ROAD_WORK_EN&outputFormat=application/json&srsName=EPSG:4326'],
  ['slp-locations', 'https://static.data.gov.hk/td/traffic-data-slp/info/traffic_speed_volume_occ_info-slp.csv'],
  ['slp-readings', 'https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol_SLP-all.xml'],
];
const results = await Promise.all(probes.map(async ([feed, url]) => {
  try {
    const response = await fetch(url, { headers: { Origin: origin }, signal: AbortSignal.timeout(25000) });
    const allowOrigin = response.headers.get('access-control-allow-origin') ?? '';
    const text = await response.text();
    return { feed, url, status: response.status, allowOrigin, bytes: Buffer.byteLength(text), direct: response.ok && (allowOrigin === '*' || allowOrigin === origin), error: '' };
  } catch (error) { return { feed, url, status: 'network error', allowOrigin: '', bytes: 0, direct: false, error: `${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}` }; }
}));
const lines = ['# Browser-direct CORS probe', '', `Observed: ${new Date().toISOString()}. GET requests with Origin: ${origin}; no Referer.`, '', '| Feed | HTTP | Access-Control-Allow-Origin | Bytes | Browser eligible | Error |', '| --- | --- | --- | --- | --- | --- |', ...results.map((r) => `| ${r.feed} | ${r.status} | ${r.allowOrigin || '(absent)'} | ${r.bytes} | ${r.direct ? 'yes' : 'no / unverified'} | ${r.error} |`), '', 'These are real GET response header checks; they do not simulate browser CORS enforcement. Transport failures leave CORS unverified. Journey boards, works, tolls, rail and ferry remain server-only regardless of probe success because of referer or shared-load requirements.', '', ...results.map((r) => `- ${r.feed}: ${r.url}`), ''];
await mkdir('docs', { recursive: true });
await writeFile('docs/cors-probe.md', lines.join('\n'));
console.log(JSON.stringify(results, null, 2));
