// With the Vite/Vinext dev server running: node tests/map-3d.browser.mjs [origin]
// PLAYWRIGHT_MODULE points to the externally installed Playwright package.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || '.impeccable/review');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const results = [];

async function create(width, language = 'en', unsupported = false) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 960 : 844 }, isMobile: width <= 700, hasTouch: width <= 700, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Observe real renderer instances without shipping a test-only global in the app.
  await context.addInitScript(({ language, unsupported }) => {
    localStorage.setItem('hk-traffic-language-v1', language);
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ snapshot: true, works: true, kmb: true }));
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get: () => leaflet, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
    if (unsupported) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args); };
    }
  }, { language, unsupported });
  await context.route('**/app/traffic-map-3d.tsx*', async route => {
    const response = await route.fetch(), source = await response.text();
    assert.ok(source.includes('map.current = m;'), 'Dev renderer instrumentation point exists');
    await route.fulfill({ response, body: source.replace('map.current = m;', 'map.current = m; window.__nativeMap = m;') });
  });
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => {
    const url = new URL(route.request().url()), headers = { 'access-control-allow-origin': '*' };
    if (url.pathname.includes('Traffic_Camera_Locations_')) return route.fulfill({ headers, body: `<image-list><image><key>1</key><description>${url.pathname.includes('_Tc') ? '中環快拍測試' : 'Central snapshot fixture'}</description><latitude>22.2818</latitude><longitude>114.1585</longitude><url>${origin}/fixture.jpg</url></image></image-list>` });
    return route.fulfill({ status: 503, headers, body: 'Other original feeds are excluded from this fixture' });
  });
  await context.route('**/api/**', route => {
    const kind = new URL(route.request().url()).pathname.split('/').at(-1), observedAt = new Date().toISOString();
    const base = { ok: true, observedAt, fetchedAt: observedAt, stale: false };
    const tracking = { operator: 'kmb', company: 'KMB', route: '1', stopId: 'FIXSTOP', bound: 'O', serviceType: '1', stopSeq: 1 };
    if (kind === 'bus-route' && new URL(route.request().url()).searchParams.get('stopArrivals') === '1') return route.fulfill({ json: { ...base, arrivals: [] } });
    if (kind === 'bus-route') return route.fulfill({ json: { ...base, route: { key: 'fixture-route', operator: 'kmb', company: 'KMB', route: '1', geometry: 'road', coordinates: [[114.160, 22.282], [114.164, 22.284], [114.1655, 22.288]], stops: [{ id: 'FIXSTOP', seq: 1, nameTc: '中環車站', nameEn: 'Central stop', lng: 114.160, lat: 22.282, distance: 0 }, { id: 'ENDSTOP', seq: 2, nameTc: '終點站', nameEn: 'Terminus', lng: 114.1655, lat: 22.288, distance: 900 }] }, vehicles: [{ id: 'fixture-bus', fromDistance: 0, toDistance: 900, departureAt: Date.now() - 60000, arrivalAt: Date.now() + 240000, validUntil: Date.now() + 300000 }], reverse: [] } });
    if (kind === 'kmb') return route.fulfill({ json: { ...base, stops: [{ id: 'FIXSTOP', nameTc: '中環車站', nameEn: 'Central stop', lng: 114.160, lat: 22.282, routes: ['1'], calls: [{ route: '1', company: 'KMB', destTc: '終點站', destEn: 'Terminus', minutes: 4, eta: new Date(Date.now() + 240000).toISOString(), scheduled: false, remarkTc: '', remarkEn: '', tracking }] }] } });
    if (kind === 'works') return route.fulfill({ json: { ...base, works: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'fixture-work', name: 'Central works', status: 'In Progress' }, geometry: { type: 'Point', coordinates: [114.157, 22.2818] } }] } } });
    return route.fulfill({ json: { ...base, boards: [], trains: [], stops: [], piers: [], vessels: [], warnings: [], notices: [], features: [], segments: [], points: [] } });
  });
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await context.route('**/fixture.jpg*', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__map?._loaded);
  const headerFits = await page.evaluate(() => {
    const bar = document.querySelector('.topbar'), title = bar.querySelector('h1');
    return bar.scrollWidth <= bar.clientWidth + 1 && (title.scrollWidth <= title.clientWidth + 1 || getComputedStyle(title).overflowX === 'hidden');
  });
  assert.ok(headerFits, 'The 2D menu and brand stay within their own space with the new mode button');
  await page.evaluate(() => window.__map.setView([22.2818, 114.1585], 16, { animate: false }));
  await page.locator('.camera-marker[data-marker-id="snapshot-1"]').waitFor();
  return { context, page, pageErrors };
}

async function switchTo3D(page) {
  await page.getByTestId('map-mode-toggle').click();
  await page.waitForFunction(() => window.__nativeMap?.getLayer('hk-3d-buildings') && document.querySelector('.native-map-area .zoom-buttons button:not(:disabled)'));
  await page.waitForFunction(() => window.__nativeMap.areTilesLoaded(), null, { timeout: 30000 });
}
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}
try {
  await fs.mkdir(evidence, { recursive: true });
  for (const [width, language, file] of [[1440, 'en', 'desktop'], [390, 'zh', 'mobile'], [320, 'en', 'narrow'], [440, 'en', 'user-440']]) await test(`${width}px ${language}: buildings, shared view, markers, tilt, popup and return to 2D`, async () => {
    const { context, page, pageErrors } = await create(width, language);
    try {
      const layers = await page.evaluate(() => localStorage.getItem('hk-traffic-layers-v1'));
      await switchTo3D(page);
      const camera = await page.evaluate(() => ({ center: window.__nativeMap.getCenter(), zoom: window.__nativeMap.getZoom(), pitch: window.__nativeMap.getPitch(), buildings: window.__nativeMap.queryRenderedFeatures({ layers: ['hk-3d-buildings'] }).length, line: window.__nativeMap.getLayer('hk-traffic-lines')?.type, sources: window.__nativeMap.getStyle().sources }));
      assert.ok(Math.abs(camera.center.lat - 22.2818) < 0.00002 && Math.abs(camera.center.lng - 114.1585) < 0.00002, 'Camera center survives 2D to 3D');
      assert.equal(camera.zoom, 15, 'Geographic scale survives the 512px native tile conversion');
      assert.ok(Math.abs(camera.pitch - 55) < 0.000001);
      assert.ok(camera.buildings > 0, 'Real OpenFreeMap Hong Kong buildings are rendered');
      assert.equal(camera.line, 'line', 'Traffic roads use a native GeoJSON layer');
      assert.ok(camera.sources['hk-traffic'] && camera.sources['hk-transport']);
      assert.equal(await page.locator('.leaflet-container').count(), 0, 'Native mode releases the Leaflet renderer');
      await page.locator('.native-marker[data-marker-id="snapshot-1"]').waitFor();
      await page.locator('.native-marker.bus-stop-marker').waitFor();
      const overflow = await page.evaluate(() => { const bar = document.querySelector('.topbar'), rect = bar.getBoundingClientRect(); return rect.right > innerWidth || bar.scrollWidth > bar.clientWidth + 1; });
      assert.equal(overflow, false, 'Top menu fits the viewport');
      await page.getByRole('slider').fill('35');
      assert.ok(Math.abs(await page.evaluate(() => window.__nativeMap.getPitch()) - 35) < 0.000001, 'Tilt control changes the native camera');
      await page.getByRole('button', { name: language === 'zh' ? '朝向北方並重設 3D 視角' : 'Face north and reset the 3D view', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__nativeMap.getBearing()), 0);
      assert.ok(Math.abs(Number(await page.getByRole('slider').inputValue()) - 55) < 0.000001, 'Compass reset also updates the slider');
      await page.screenshot({ path: path.join(evidence, file + '.png'), fullPage: true });
      await page.locator('.native-marker[data-marker-id="snapshot-1"]').click();
      await page.locator('.native-item-popup .item-detail-title').waitFor();
      await page.locator('.native-item-popup img').waitFor();
      assert.match(await page.locator('.item-detail-title').innerText(), language === 'zh' ? /中環快拍/ : /Central snapshot/);
      const cardBounds = await page.evaluate(() => {
        const card = document.querySelector('.native-item-popup .maplibregl-popup-content').getBoundingClientRect();
        const bar = document.querySelector('.topbar').getBoundingClientRect();
        const overlays = [...document.querySelectorAll('.intel-shell,.map-3d-camera')].map(node => node.getBoundingClientRect());
        const lowerBoundary = Math.min(innerHeight, ...overlays.map(rect => rect.top));
        return { top: card.top, bottom: card.bottom, barBottom: bar.bottom, lowerBoundary };
      });
      await page.screenshot({ path: path.join(evidence, file + '-popup.png'), fullPage: true });
      assert.ok(cardBounds.top >= cardBounds.barBottom + 8 && cardBounds.bottom <= cardBounds.lowerBoundary - 8, 'Snapshot popup stays clear of the top menu and lower map controls: ' + JSON.stringify(cardBounds));
      await page.keyboard.press('Escape');
      await page.locator('.native-item-popup').waitFor({ state: 'detached' });
      const marker = page.locator('.native-marker[data-marker-id="snapshot-1"]');
      await marker.press('Enter');
      await page.waitForFunction(() => document.activeElement?.classList.contains('item-popup-content'));
      const close = page.locator('.native-item-popup .maplibregl-popup-close-button');
      assert.equal(await close.getAttribute('aria-label'), language === 'zh' ? '關閉詳情' : 'Close details');
      await close.press('Enter');
      await page.waitForFunction(() => document.activeElement?.dataset.markerId === 'snapshot-1');
      await page.locator('.native-item-popup').waitFor({ state: 'detached' });
      await page.evaluate(() => window.__nativeMap.jumpTo({ center: [114.166, 22.285], zoom: 15.25, bearing: 42, pitch: 48 }));
      await page.getByTestId('map-mode-toggle').click();
      await page.waitForFunction(() => window.__map?._loaded && document.querySelector('.leaflet-container'));
      const flat = await page.evaluate(() => ({ lat: window.__map.getCenter().lat, lng: window.__map.getCenter().lng, zoom: window.__map.getZoom() }));
      assert.equal(flat.zoom, 16.25, 'Fractional native zoom returns correctly to 2D');
      assert.ok(Math.abs(flat.lat - 22.285) < 0.00002 && Math.abs(flat.lng - 114.166) < 0.00002);
      assert.equal(await page.evaluate(() => localStorage.getItem('hk-traffic-layers-v1')), layers, 'Layer selection survives the switch');
      await switchTo3D(page);
      assert.equal(await page.evaluate(() => window.__nativeMap.getBearing()), 42, 'Returning to 3D restores rotation');
      assert.ok(Math.abs(await page.evaluate(() => window.__nativeMap.getPitch()) - 48) < 0.000001, 'Returning to 3D restores tilt');
      assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    } finally { await context.close(); }
  });
  await test('Native bus routes retain geometry, estimated vehicles and keyboard-opened route-stop details', async () => {
    const { context, page, pageErrors } = await create(1440);
    try {
      await switchTo3D(page);
      await page.locator('.native-marker.bus-stop-marker').click();
      await page.locator('.bus-route-button').click();
      const routeMarker = page.locator('.native-marker[data-marker-id^="route-stop:"]').first();
      await routeMarker.waitFor();
      await page.locator('.native-marker[data-marker-id="bus-vehicle:fixture-bus"]').waitFor();
      assert.ok(await page.evaluate(() => window.__nativeMap.getSource('hk-transport').serialize().data.features.some(feature => feature.properties.width === 5)), 'Bus route uses native GeoJSON geometry');
      const routeId = await routeMarker.getAttribute('data-marker-id');
      await routeMarker.press('Enter');
      await page.waitForFunction(() => document.activeElement?.classList.contains('item-popup-content'));
      await page.locator('.native-item-popup .maplibregl-popup-close-button').press('Enter');
      await page.waitForFunction(id => document.activeElement?.dataset.markerId === id, routeId);
      assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    } finally { await context.close(); }
  });
  await test('Unavailable WebGL offers a working return to 2D', async () => {
    const { context, page } = await create(390, 'en', true);
    try {
      await page.getByTestId('map-mode-toggle').click();
      await page.getByRole('alert').filter({ hasText: 'cannot display the 3D map' }).waitFor();
      await page.getByRole('button', { name: 'Return to 2D map', exact: true }).click();
      await page.locator('.leaflet-container').waitFor();
      assert.equal(await page.getByTestId('map-mode-toggle').getAttribute('aria-pressed'), 'false');
    } finally { await context.close(); }
  });
  await test('A failed style can be retried without losing the map view', async () => {
    const { context, page } = await create(390);
    try {
      let failed = false;
      await page.route('https://tiles.openfreemap.org/styles/positron', route => { if (!failed) { failed = true; return route.abort(); } return route.continue(); });
      await page.getByTestId('map-mode-toggle').click();
      await page.getByRole('alert').filter({ hasText: 'could not fully load' }).waitFor();
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.waitForFunction(() => window.__nativeMap?.getLayer('hk-3d-buildings'));
      assert.equal(await page.evaluate(() => window.__nativeMap.getZoom()), 15);
    } finally { await context.close(); }
  });
} finally {
  await browser.close();
  await fs.writeFile(path.join(evidence, 'map-3d-results.json'), JSON.stringify(results, null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
