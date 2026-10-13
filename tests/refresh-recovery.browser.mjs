// node tests/refresh-recovery.browser.mjs [baseURL]; uses the existing Playwright runtime.
import assert from 'node:assert/strict';
import { openLayers, reloadAll } from './browser-controls.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const calls = { snapshot: 0, works: 0, tolls: 0, warnings: 0 };
let snapshotFail = false, integrationFail = true;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const page = await context.newPage();
await context.addInitScript(() => {
  localStorage.setItem('hk-traffic-language-v1', 'en');
  localStorage.setItem('hk-traffic-basemap-v1', 'osm');
  localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ snapshot: true, works: true, toll: true, 'weather-warning': true }));
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition() { return 0; }, clearWatch() {} } });
  let leaflet;
  Object.defineProperty(window, 'L', { get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
});
await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
await context.route(url => url.hostname.endsWith('.gov.hk'), route => {
  const url = route.request().url(), headers = { 'access-control-allow-origin': '*' };
  if (url.includes('Traffic_Camera_Locations_')) {
    if (url.includes('_Tc')) calls.snapshot++;
    return route.fulfill(snapshotFail ? { headers, status: 503, body: 'Unavailable' } : { headers, body: `<image-list><image><key>fixture</key><description>Snapshot generation ${calls.snapshot}</description><latitude>22.3</latitude><longitude>114.1</longitude><url>${origin}/fixture.jpg</url></image></image-list>` });
  }
  return route.fulfill({ headers, status: 404, body: 'Unrelated fixture' });
});
await context.route('**/api/**', route => {
  const kind = new URL(route.request().url()).pathname.split('/').at(-1);
  if (kind === 'warnings') {
    calls.warnings++;
    const english = new URL(route.request().url()).searchParams.get('lang') === 'en';
    return route.fulfill({ json: { ok: true, observedAt: new Date().toISOString(), warnings: [{ id: 'warning-fixture', code: 'WTS', name: english ? 'Localized thunderstorm' : '本地化雷暴', shortName: english ? 'Storm' : '雷暴', detail: '', tone: 'amber', urgent: false, score: 260000 }], conditions: { temperatureC: null, rainfallMm: null, rainfallPlace: '' } } });
  }
  if (!['works', 'tolls'].includes(kind)) return route.fulfill({ json: { ok: true, boards: [], trains: [], stops: [] } });
  calls[kind]++;
  if (integrationFail) return route.fulfill({ status: 503, body: 'Unavailable' });
  return route.fulfill({ json: { ok: true, fetchedAt: new Date().toISOString(), [kind]: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'fixture', name: `${kind} recovered`, band: 'overview' }, geometry: { type: 'Point', coordinates: [114.1, 22.3] } }] } } });
});
async function settled() {
  await openLayers(page);
  await page.waitForFunction(() => ![...document.querySelectorAll('.layer-card')].some(card => card.querySelector('[role="switch"][aria-checked="true"]') && card.querySelector('.spin')));
}
try {
  await page.clock.install();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__map?._loaded);
  await settled();
  await page.locator('.layer-card.toll .layer-error').waitFor();
  await page.locator('.layer-card.works .layer-error').waitFor();
  const before = calls.snapshot;
  await reloadAll(page);
  await settled();
  assert.equal(calls.snapshot, before + 1, 'Manual refresh must bypass a fresh snapshot inventory cache');
  const marker = page.locator('[data-marker-id="snapshot-fixture"]');
  const label = await marker.getAttribute('aria-label');
  snapshotFail = true;
  await reloadAll(page);
  await settled();
  await page.locator('.layer-card.snapshot .layer-error').waitFor();
  assert.equal(await marker.getAttribute('aria-label'), label, 'Failed refresh preserves the previous snapshot inventory');
  snapshotFail = false; integrationFail = false;
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  for (let i = 0; i < 12; i++) await page.clock.runFor(5000);
  await page.locator('[data-marker-id="toll-fixture"]').waitFor();
  await page.locator('[data-marker-id="works-fixture"]').waitFor();
  await page.locator('.layer-card.snapshot .layer-error').waitFor({ state: 'detached' });
  assert.notEqual(await marker.getAttribute('aria-label'), label);
  const recovered = { ...calls };
  delete recovered.warnings;
  for (let i = 0; i < 12; i++) await page.clock.runFor(5000);
  const withoutWarnings = { ...calls };
  delete withoutWarnings.warnings;
  assert.deepEqual(withoutWarnings, recovered, 'Recovery restores the normal successful refresh cadence');
  const warningCalls = calls.warnings;
  await page.getByRole('button', { name: 'Chinese', exact: true }).click();
  await page.locator('.intel-trigger').filter({ hasText: '本地化雷暴' }).waitFor();
  assert.equal(calls.warnings, warningCalls + 1, 'Warnings refetch immediately in the selected language');
  await page.locator('.language-toggle button').nth(0).click();
  await page.locator('.intel-trigger').filter({ hasText: 'Localized thunderstorm' }).waitFor();
  const beforeOnline = calls.tolls;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settled();
  assert.equal(calls.tolls, beforeOnline + 1, 'Reconnecting refreshes enabled integration feeds immediately');
  console.log('PASS forced refresh, retained failure data, automatic recovery, localized warnings and immediate reconnect refresh');
} finally {
  await context.close();
  await browser.close();
}
