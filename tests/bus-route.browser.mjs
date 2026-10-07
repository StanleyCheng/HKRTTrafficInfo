// Run with a dev server: node tests/bus-route.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package/file URL; uses an existing Chrome installation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/bus-route');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const contexts = [], results = [];
const coordinates = [[113.944, 22.280], [113.947, 22.280], [113.947, 22.284], [113.955, 22.284], [113.955, 22.289], [113.965, 22.289]];
const distance = [0];
for (let i = 1; i < coordinates.length; i++) {
  const [x, y] = coordinates[i], [a, b] = coordinates[i - 1], r = Math.PI / 180;
  distance.push(distance.at(-1) + 6371000 * 2 * Math.asin(Math.sqrt(Math.sin((y - b) * r / 2) ** 2 + Math.cos(y * r) * Math.cos(b * r) * Math.sin((x - a) * r / 2) ** 2)));
}
const variants = [
  { operator: 'kmb', company: 'KMB', route: '1', bound: 'O', serviceType: '1', stopId: 'KMB1', stopSeq: 2 },
  { operator: 'kmb', company: 'LWB', route: 'A31', bound: 'I', serviceType: '2', stopId: 'KMB1', stopSeq: 3 },
  { operator: 'citybus', route: '11', bound: 'I', stopId: 'CTB1', stopSeq: 2 },
  { operator: 'gmb', route: '1', routeId: '200001', routeSeq: 2, stopId: 'GMB1', stopSeq: 2 },
  { operator: 'nlb', route: '1', routeId: '42', stopId: 'NLB1', stopSeq: 2 },
];
function response(selection, mode = 'live', correction = 0) {
  const now = Date.now();
  const key = JSON.stringify(selection);
  return { ok: true, observedAt: new Date(now).toISOString(), stale: mode === 'stale', route: { key, operator: selection.operator, company: selection.company, route: selection.route, geometry: mode === 'approximate' ? 'stops' : 'road', coordinates, stops: [0, 3, 5].map((index, seq) => ({ id: `route-${seq}`, seq: seq + 1, nameTc: `測試車站${seq + 1}`, nameEn: ['Fixture origin', 'Fixture interchange', 'Fixture terminus'][seq], lng: coordinates[index][0], lat: coordinates[index][1], distance: distance[index] })) }, vehicle: ['empty', 'stale', 'approximate'].includes(mode) ? null : { id: key, fromDistance: 0, toDistance: distance[3], departureAt: now - 60000 - correction, arrivalAt: now + 120000 - correction, validUntil: now + 180000 } };
}
async function create({ mobile = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion });
  contexts.push(context);
  const requests = [], controls = { mode: 'live', correction: 0, delay: 0 };
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split('/')[2];
    if (kind === 'bus-route') {
      const selection = Object.fromEntries(url.searchParams);
      requests.push(selection);
      const payload = response(selection, controls.mode, controls.correction);
      if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
      return route.fulfill({ json: payload }).catch(() => {});
    }
    if (variants.some(v => v.operator === kind)) {
      const calls = variants.filter(v => v.operator === kind);
      const index = ['kmb', 'citybus', 'gmb', 'nlb'].indexOf(kind);
      return route.fulfill({ json: { ok: true, observedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), stops: [{ id: calls[0].stopId, nameTc: `${kind}測試`, nameEn: `${kind} fixture stop`, lng: 113.95 + index * .0007, lat: 22.282, routes: calls.map(v => v.route), calls: calls.map(v => ({ route: v.route, company: v.company, destTc: '測試終點', destEn: `${v.company || kind} fixture destination`, minutes: 2, eta: new Date(Date.now() + 120000).toISOString(), scheduled: false, remarkTc: '', remarkEn: '', tracking: v })) }] } });
    }
    return route.fulfill({ json: { ok: true, observedAt: new Date().toISOString(), boards: [], trains: [], piers: [], vessels: [], notices: [], features: [], warnings: [] } });
  });
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, body: 'Unrelated official feed is excluded from bus fixture' }));
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64') }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en'); localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = []; window.addEventListener('error', e => window.__errors.push(e.message));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition() {} } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  if (mobile) await page.locator('.mobile-panel-button').click();
  for (const kind of ['kmb', 'citybus', 'gmb', 'nlb']) await page.locator(`.layer-card.${kind} [role="switch"]`).click();
  if (mobile) await page.locator('.mobile-panel-close').click();
  await page.locator('.camera-marker[title$="kmb fixture stop"]').waitFor();
  return { context, page, controls, requests, mobile };
}
async function select(fixture, variant) {
  const { page, mobile } = fixture;
  if (mobile && await page.locator('.sidebar.mobile-open').count()) await page.locator('.mobile-panel-close').click();
  await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  if (await page.locator('.map-canvas.route-focus').count()) await page.locator('.map-canvas').click({ position: { x: 30, y: 150 } });
  await page.locator(`.camera-marker[title$="${variant.operator} fixture stop"] .marker-displacement`).click();
  const button = page.locator(`.stop-eta-popup .bus-route-button[aria-label^="Show route ${variant.route} ·"]`).first();
  await page.evaluate(() => { window.__busRouteFitComplete = false; window.__map.once('zoomend', () => { window.__busRouteFitComplete = true; }); });
  await button.click();
  await page.locator('.bus-route-polyline').waitFor();
  await page.waitForFunction(() => window.__busRouteFitComplete);
}
async function samples(page, count = 14) {
  return page.evaluate(count => new Promise(resolve => { const frames = []; function frame() { const e = document.querySelector('.bus-route-marker'); frames.push(e?.style.transform); if (frames.length >= count) resolve(frames); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }), count);
}
async function refresh(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}
async function test(name, run) {
  if (process.env.BUS_TEST_FILTER && !new RegExp(process.env.BUS_TEST_FILTER).test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}
try {
  await fs.mkdir(evidence, { recursive: true });
  await test('All four bus operators and Long Win preserve direction and service identity; full road geometry fits', async () => {
    const f = await create();
    for (const variant of variants) {
      await select(f, variant);
      const actual = f.requests.at(-1);
      for (const [key, value] of Object.entries(variant)) assert.equal(actual[key], String(value), `${variant.operator} ${key}`);
      await f.page.locator('.bus-route-marker').waitFor();
      await f.page.waitForFunction(() => { const image = document.querySelector('.bus-route-marker .vehicle-art'); return image?.complete && image.naturalWidth > 0; });
      const artwork = await f.page.locator('.bus-route-marker').evaluate(element => ({
        src: element.querySelector('.vehicle-art').getAttribute('src'), heading: element.querySelector('.vehicle-heading').style.transform,
        running: element.classList.contains('is-running'), width: element.getBoundingClientRect().width,
        animations: element.getAnimations({ subtree: true }).map(animation => animation.playState),
      }));
      assert.match(artwork.src, new RegExp(`bus-${variant.company === 'LWB' ? 'lwb' : variant.operator}`), 'Bus miniature matches its actual operator');
      assert.match(artwork.heading, /^rotate\(-?[\d.]+deg\)$/, 'Bearing rotates the inner wrapper');
      assert.equal(artwork.width, 32); assert.equal(artwork.running, true);
      assert.ok(artwork.animations.includes('running'), 'Estimated bus runs its CSS miniature animation');
      const geometry = await f.page.evaluate(() => { let points; window.__map.eachLayer(layer => { if (layer.options?.className === 'bus-route-polyline') points = layer.getLatLngs().map(p => [p.lng, p.lat]); }); return { points, bounds: window.__map.getBounds().toBBoxString() }; });
      assert.deepEqual(geometry.points, coordinates, 'Route includes road bends between the three stops');
      const [west, south, east, north] = geometry.bounds.split(',').map(Number);
      for (const [lng, lat] of coordinates) assert.ok(lng >= west && lng <= east && lat >= south && lat <= north, 'Whole route must fit');
      const motion = await samples(f.page);
      assert.ok(new Set(motion).size >= 10, `${variant.operator} ${variant.route} moves continuously: ${new Set(motion).size} positions; ${await f.page.locator('.map-canvas').getAttribute('class')}`);
    }
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.page.screenshot({ path: path.join(evidence, 'desktop-route.png') });
    await f.context.close();
  });
  await test('Refresh keeps marker identity, smoothly corrects position, handles stale data and close cleanup', async () => {
    const f = await create(); await select(f, variants[0]); await f.page.locator('.bus-route-marker').waitFor();
    await f.page.evaluate(() => { window.__originalBus = document.querySelector('.bus-route-marker'); });
    await f.page.evaluate(() => { window.__map.setView([22.285, 113.95], 16, { animate: false }); });
    f.controls.correction = 20000; const before = f.requests.length; await refresh(f.page);
    await f.page.waitForFunction(() => window.__originalBus?.isConnected);
    await f.page.waitForTimeout(250);
    assert.ok(f.requests.length > before, 'Refresh reaches endpoint');
    assert.equal(await f.page.evaluate(() => window.__originalBus === document.querySelector('.bus-route-marker')), true);
    assert.ok(new Set(await samples(f.page)).size >= 10);
    assert.equal(await f.page.evaluate(() => window.__map.getZoom()), 16, 'Refresh must preserve the user camera');
    f.controls.mode = 'stale'; await refresh(f.page);
    await f.page.locator('.bus-route-marker').waitFor({ state: 'detached' });
    assert.equal(await f.page.locator('.bus-route-polyline').count(), 1, 'Stale route stays visible without misleading movement');
    // Selecting a route from the map popup keeps the current sidebar tab.
    await f.page.locator('#panel-tab-details').click();
    await f.page.getByRole('button', { name: 'Close route', exact: true }).click();
    await f.page.locator('.bus-route-polyline').waitFor({ state: 'detached' });
    await f.context.close();
  });
  await test('Missing position and unavailable road geometry remain explicit without invented movement', async () => {
    const f = await create(); f.controls.mode = 'approximate'; await select(f, variants[2]);
    assert.equal(await f.page.locator('.bus-route-marker').count(), 0);
    await f.page.locator('#panel-tab-details').click();
    await f.page.getByText('Route connects published stops; road geometry is unavailable.', { exact: true }).waitFor();
    await f.page.getByText('No current position estimate available.', { exact: true }).waitFor();
    await f.context.close();
  });
  await test('Reduced motion, hidden documents, request cancellation and layer disable', async () => {
    const f = await create({ reducedMotion: 'reduce' }); await select(f, variants[0]); await f.page.locator('.bus-route-marker').waitFor();
    assert.equal(new Set(await samples(f.page)).size, 1, 'Reduced motion keeps a static location');
    await f.page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.ok(new Set(await samples(f.page)).size >= 10);
    await f.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(new Set(await samples(f.page)).size, 1);
    await f.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await f.page.locator('#panel-tab-layers').click();
    await f.page.locator('.layer-card.kmb [role="switch"]').click();
    await f.page.locator('.bus-route-marker').waitFor({ state: 'detached' });
    await f.page.locator('.bus-route-polyline').waitFor({ state: 'detached' });
    await f.page.locator('.layer-card.kmb [role="switch"]').click();
    f.controls.delay = 700;
    await f.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    await f.page.locator('.camera-marker[title$="kmb fixture stop"] .marker-displacement').click();
    await f.page.locator('.bus-route-button').first().click();
    await f.page.locator('#panel-tab-details').click();
    await f.page.locator('.clear-selection').click();
    await f.page.waitForTimeout(900);
    assert.equal(await f.page.locator('.bus-route-polyline, .bus-route-marker').count(), 0, 'Cancelled selection cannot revive after response');
    await f.context.close();
  });
  await test('Mobile selection reveals map, fits full route and keeps route controls accessible', async () => {
    const f = await create({ mobile: true }); await select(f, variants[3]); await f.page.locator('.bus-route-marker').waitFor();
    assert.equal(await f.page.locator('.map-area').getAttribute('inert'), null, 'Route selection must reveal active map on mobile');
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(new Set(await samples(f.page)).size >= 10);
    const fit = await f.page.evaluate(points => points.every(([lng, lat]) => window.__map.getBounds().contains([lat, lng])), coordinates);
    assert.equal(fit, true);
    await f.page.screenshot({ path: path.join(evidence, 'mobile-route.png') });
    await f.context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close();
  await fs.writeFile(path.join(evidence, 'bus-route-results.json'), JSON.stringify({ origin, results, fixture: 'Deterministic local feed and route API responses; production normalization, polling, route projection, Leaflet rendering and interactions.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length }));
if (results.some(r => !r.ok)) process.exitCode = 1;



