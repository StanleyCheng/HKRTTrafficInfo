// node --experimental-strip-types tests/ferry-geography.browser.mjs [baseURL] [evidenceDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ferryPaths } from '../lib/ferry-fairway.ts';
import { pathMetres, pointAlong } from '../lib/ferry-run.ts';
import { metresBetween } from '../lib/mtr-estimate.ts';
import { inSea, landSamples } from './ferry-geography.mts';
import { openLayers, closeControls } from './browser-controls.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const routes = ferryPaths(), observed = Date.now();
const piers = JSON.parse(await fs.readFile(new URL('../data/ferry-piers.json', import.meta.url), 'utf8')).piers;
const coast = JSON.parse(await fs.readFile(new URL('./fixtures/ferry-coastline.json', import.meta.url), 'utf8'));
const evidence = path.resolve(process.argv[3] || 'outputs/ferry-geography/browser');
let active = false;
const vessels = routes.flatMap((route, index) => [false, true].map(reverse => {
  const points = route.pathLng.map((lng, i) => ({ lng, lat: route.pathLat[i] }));
  if (reverse) points.reverse();
  const from = piers.find(pier => pier.lng === points[0].lng && pier.lat === points[0].lat), to = piers.find(pier => pier.lng === points.at(-1).lng && pier.lat === points.at(-1).lat);
  return { id: `${index}-${reverse ? 'return' : 'out'}`, nameTc: `${from.nameTc} – ${to.nameTc}`, nameEn: `${from.nameEn} – ${to.nameEn}`, destTc: to.nameTc, destEn: to.nameEn.replace(/(?: Ferry)? Pier.*| Star Ferry$/, ''), route: route.id.includes('star-') ? '天星' : route.id.includes('fortune-') ? '富裕' : route.id.includes('sun-') ? 'CECC' : '1', fix: 'clock', ...points[0], pathLng: points.map(point => point.lng), pathLat: points.map(point => point.lat), eta: new Date(observed + 120000).toISOString(), minutes: 1, departAt: observed, arriveAt: observed + 120000 };
}));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Unrelated fixture feed unavailable' }));
await context.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/ferry')
  ? { ok: true, observedAt: new Date(observed).toISOString(), piers: piers.map(pier => ({ ...pier, calls: [] })), vessels: active ? vessels : [] }
  : { ok: true, observedAt: new Date(observed).toISOString(), boards: [], trains: [], stops: [], points: [], warnings: [] } }));
await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64') }));
await context.addInitScript(({ observed }) => {
  localStorage.setItem('hk-traffic-language-v1', 'en'); localStorage.setItem('hk-traffic-basemap-v1', 'osm');
  window.__clock = observed + 30000; Date.now = () => window.__clock;
  window.__errors = []; window.addEventListener('error', event => window.__errors.push(event.message));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
  let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
}, { observed });
const page = await context.newPage();
const openFerries = async () => {
  await page.waitForFunction(() => window.__map?._loaded);
  await openLayers(page);
  for (const kind of ['mtr', 'lrt']) {
    const rail = page.locator(`.layer-card.${kind} [role="switch"]`);
    if (await rail.count() && await rail.getAttribute('aria-checked') === 'true') await rail.evaluate(button => button.click());
  }
  const toggle = page.locator('.layer-card.ferry [role="switch"]');
  if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
  await closeControls(page);
  await page.waitForFunction(() => { let count = 0; window.__map.eachLayer(layer => { if (layer.options.className === 'ferry-route-polyline') count++; }); return count === 16; });
  await page.evaluate(({ polygons, attribution }) => {
    const map = window.__map;
    map.getPane('tilePane').style.opacity = '0';
    map.getContainer().style.background = '#b8bbb7';
    const pane = map.createPane('geography'); pane.style.zIndex = '150';
    window.L.geoJSON({ type: 'FeatureCollection', features: polygons.map(coordinates => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties: {} })) }, { pane: 'geography', interactive: false, style: { fillColor: '#d7eaf5', fillOpacity: 1, weight: 0 } }).addTo(map);
    map.attributionControl.addAttribution(attribution);
    map.fitBounds([[22.19, 113.99], [22.325, 114.23]], { padding: [35, 35], animate: false });
  }, { polygons: coast.polygons, attribution: coast.attribution });
};
try {
  await fs.mkdir(evidence, { recursive: true });
  await page.goto(process.argv[2] || 'http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await openFerries();
  const rendered = await page.evaluate(() => {
    const lines = []; window.__map.eachLayer(layer => { if (layer.options.className === 'ferry-route-polyline') lines.push({ points: layer.getLatLngs().map(point => [point.lat, point.lng]), smoothFactor: layer.options.smoothFactor }); }); return lines;
  });
  assert.equal(rendered.length, 16);
  for (const line of rendered) {
    assert.equal(line.smoothFactor, 0, 'map must preserve every coastline bend');
    assert.ok(routes.some(route => JSON.stringify(line.points) === JSON.stringify(route.pathLng.map((lng, i) => [route.pathLat[i], lng]))), 'rendered route must match shared geography');
    assert.deepEqual(landSamples(line.points.map(([lat, lng]) => ({ lng, lat }))), []);
  }
  assert.equal(await page.locator('.ferry-marker').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'all-routes-no-boats.png') });
  active = true;
  await page.reload({ waitUntil: 'domcontentloaded' }); await openFerries();
  await page.waitForFunction(() => document.querySelectorAll('.ferry-marker').length === 32);
  const snapshots = [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    await page.evaluate(time => { window.__clock = time; }, observed + 120000 * fraction);
    await page.waitForTimeout(1500);
    const markers = await page.evaluate(() => {
      const points = []; window.__map.eachLayer(layer => { const id = layer.getElement?.()?.dataset.markerId; if (id?.startsWith('ferry-vessel-')) points.push({ id: id.replace('ferry-vessel-', ''), ...layer.getLatLng() }); }); return points;
    });
    assert.equal(markers.length, vessels.length);
    for (const marker of markers) {
      const vessel = vessels.find(boat => boat.id === marker.id);
      const route = vessel.pathLng.map((lng, i) => ({ lng, lat: vessel.pathLat[i] }));
      assert.ok(metresBetween(marker, pointAlong(route, fraction)) < 1, `${marker.id} rendered boat must follow its route at ${fraction}`);
      assert.equal(inSea(marker), true, `${marker.id} rendered boat must remain at sea`);
    }
    snapshots.push({ fraction, markers });
  }
  await page.screenshot({ path: path.join(evidence, 'all-routes-moving-boats.png') });
  await fs.writeFile(path.join(evidence, 'route-and-motion-checks.json'), JSON.stringify({ rendered, snapshots, routeMetres: routes.map(route => pathMetres(route.pathLng.map((lng, i) => ({ lng, lat: route.pathLat[i] })))) }, null, 2));
  assert.deepEqual(await page.evaluate(() => window.__errors), []);
  console.log('PASS: 16 persistent rendered routes preserve bends; all 32 directional boats match route and stay at sea at quarter, midpoint and three-quarter positions.');
} finally { await context.close(); await browser.close(); }
