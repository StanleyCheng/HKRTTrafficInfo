// With a dev server running: node tests/map-empty.browser.mjs [baseURL] [evidenceDir]
// The map-centre empty notice must only appear when map content is genuinely
// expected: all layers off, an enabled layer failing, or an ungated camera
// layer that loaded healthy but empty. Viewport-gated bus feeds and layers
// that never place cameras (weather warnings) must keep the map quiet.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openLayers } from './browser-controls.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/map-empty');
const results = [];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const contexts = [];

async function create({ mobile = false, routeScenario = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile });
  contexts.push(context);
  const observedAt = new Date().toISOString();
  // One KMB stop with a tracked arrival, and a route so wide that fitting it
  // drops the map below the zoom-13 bus gate.
  const tracking = { operator: 'kmb', company: 'KMB', route: '1', bound: 'O', serviceType: '1', stopId: 'FIXSTOP', stopSeq: 2 };
  const routeStops = [
    { id: 'FIXSTOP', seq: 1, nameTc: '固定起點', nameEn: 'Fixture origin', lng: 113.9, lat: 22.32, distance: 0 },
    { id: 'FIXSTOP2', seq: 2, nameTc: '固定中途站', nameEn: 'Fixture mid stop', lng: 114.08, lat: 22.30, distance: 19000 },
    { id: 'FIXSTOP3', seq: 3, nameTc: '固定終點', nameEn: 'Fixture terminus', lng: 114.25, lat: 22.34, distance: 37000 },
  ];
  const coordinates = routeStops.map(stop => [stop.lng, stop.lat]);
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split('/')[2];
    if (routeScenario && kind === 'bus-route' && url.searchParams.get('stopArrivals') !== '1') {
      return route.fulfill({ json: { ok: true, observedAt, stale: false, route: { key: JSON.stringify(tracking), operator: 'kmb', company: 'KMB', route: '1', geometry: 'road', coordinates, stops: routeStops }, vehicles: [{ id: 'fixture-bus', fromDistance: 0, toDistance: 19000, departureAt: Date.now() - 60000, arrivalAt: Date.now() + 240000, validUntil: Date.now() + 300000 }], reverse: [] } });
    }
    if (routeScenario && kind === 'bus-route') return route.fulfill({ json: { ok: true, observedAt, stale: false, arrivals: [] } });
    if (routeScenario && kind === 'kmb') return route.fulfill({ json: { ok: true, observedAt, stops: [{ id: 'FIXSTOP', nameTc: '固定車站', nameEn: 'Fixture stop', lng: 113.9, lat: 22.32, routes: ['1'], calls: [{ route: '1', company: 'KMB', destTc: '固定終點', destEn: 'Fixture terminus', minutes: 4, eta: new Date(Date.now() + 240000).toISOString(), scheduled: false, remarkTc: '', remarkEn: '', tracking }] }] } });
    return route.fulfill({ json: { ok: true, observedAt, fetchedAt: observedAt, boards: [], trains: [], stops: [], piers: [], vessels: [], warnings: [], notices: [], features: [], segments: [], points: [] } });
  });
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, body: 'Fixture: original feeds are excluded from this scenario' }));
  await context.route('**tile.openstreetmap.org**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64') }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en');
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded, null, { timeout: 30000 });
  return { context, page };
}

async function settle(page) {
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('.layer-card')];
    return cards.length > 0 && cards.every(card => !card.querySelector('.spin'));
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

async function toggle(page, kind, on) {
  const card = page.locator(`.layer-card.${kind} [role="switch"]`);
  if ((await card.getAttribute('aria-checked')) !== String(on)) await card.click();
}

async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Gated bus layers with every roads layer off keep the map quiet', async () => {
    const { page, context } = await create();
    await page.evaluate(() => { window.__map.setView([22.355, 114.13], 11, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await settle(page);
    const notice = page.locator('.map-empty');
    assert.equal(await notice.count(), 0, 'A zoom-gated bus feed is healthy and must not raise the no-locations notice');
    await page.screenshot({ path: path.join(evidence, 'gated-bus-quiet.png') });
    await context.close();
  });
  await test('Weather warnings alone never raise the no-locations notice', async () => {
    const { page, context } = await create();
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'weather-warning', true);
    await settle(page);
    assert.equal(await page.locator('.map-empty').count(), 0, 'A layer that places no cameras by design must not raise the notice');
    await context.close();
  });
  await test('Every layer off still explains how to turn layers on', async () => {
    const { page, context } = await create();
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /All layers are off/, 'The all-off hint stays available');
    await context.close();
  });
  await test('An ungated bus layer that loads healthy but empty keeps the honest notice', async () => {
    const { page, context } = await create();
    await page.evaluate(() => { window.__map.setView([22.3, 114.17], 14, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /No camera location data is available/, 'Genuinely empty loaded layers still explain themselves');
    await context.close();
  });
  await test('Mobile: gated bus layers keep the map quiet', async () => {
    const { page, context } = await create({ mobile: true });
    await page.evaluate(() => { window.__map.setView([22.355, 114.13], 11, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await settle(page);
    assert.equal(await page.locator('.map-empty').count(), 0, 'The mobile map stays quiet with only a gated bus feed on');
    await context.close();
  });
  await test('Mobile: every layer off still explains how to turn layers on', async () => {
    const { page, context } = await create({ mobile: true });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /All layers are off/, 'The all-off hint stays available on mobile');
    await context.close();
  });
  await test('A displayed bus route is map content: no empty notice, moving bus stays', async () => {
    const { page, context } = await create({ routeScenario: true });
    await page.evaluate(() => { window.__map.setView([22.32, 113.9], 14, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await toggle(page, 'crossing', true);
    await settle(page);
    await page.locator('.camera-marker[data-marker-id="kmb-FIXSTOP"]').waitFor({ timeout: 20000 });
    await page.locator('.camera-marker[data-marker-id="kmb-FIXSTOP"]').evaluate(marker => marker.click());
    await page.locator('.item-popup .bus-route-button[aria-label^="Show route 1"]').click({ timeout: 15000 });
    await page.locator('.bus-route-polyline').waitFor({ timeout: 30000 });
    await page.locator('.bus-route-marker').waitFor({ timeout: 10000 });
    // Fitting the whole route drops below the zoom-13 bus gate; the crossing
    // layer stays drawable but empty, so without a route the notice returns.
    await page.waitForFunction(() => window.__map.getZoom() < 13, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.map-empty').count(), 0, 'The empty notice must not cover a displayed route');
    const moving = await page.evaluate(count => new Promise(resolve => { const frames = []; function frame() { const element = document.querySelector('.bus-route-marker'); frames.push(element?.style.transform); if (frames.length >= count) resolve(new Set(frames).size); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }), 20);
    assert.ok(moving >= 10, 'The estimated bus keeps moving on the displayed route');
    await page.screenshot({ path: path.join(evidence, 'route-display-no-notice.png') });
    await openLayers(page);
    await page.getByRole('button', { name: 'Close route', exact: true }).click();
    await page.locator('.bus-route-polyline').waitFor({ state: 'detached' });
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /No camera location data is available/, 'Without a route the honest notice returns');
    await context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close();
  await fs.writeFile(path.join(evidence, 'map-empty-results.json'), JSON.stringify({ origin, results, fixture: 'All /api feeds answered with deterministic healthy-but-empty envelopes; gating and rendering use production code.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length }));
if (results.some(result => !result.ok)) process.exitCode = 1;
