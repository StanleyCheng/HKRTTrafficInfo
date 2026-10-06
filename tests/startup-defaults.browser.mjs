// With a dev server running: node tests/startup-defaults.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package name or file URL. STARTUP_TEST_FILTER limits cases.
// STARTUP_STATIC=1 runs only the unavailable-MTR regression against a static export.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || '.impeccable/review/defaults');
const staticMode = process.env.STARTUP_STATIC === '1';
const filter = process.env.STARTUP_TEST_FILTER ? new RegExp(process.env.STARTUP_TEST_FILTER) : staticMode ? /^Static export/ : null;
const results = [];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const contexts = [];

async function create({ viewport = { width: 1440, height: 1000 }, native = false, language = 'en', settledFeedFailures = false } = {}) {
  const context = await browser.newContext({ viewport, ...(native ? { permissions: ['geolocation'], geolocation: { latitude: 22.2819, longitude: 114.1585, accuracy: 20 } } : {}) });
  contexts.push(context);
  let mtrCalls = 0;
  const mtrTimes = [];
  const observedAt = new Date().toISOString();
  if (settledFeedFailures) await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Fixture: original official feeds unavailable' }));
  await context.route('**/api/mtr**', route => {
    mtrCalls++;
    mtrTimes.push(Date.now());
    return route.fulfill({ json: {
      ok: true, fetchedAt: new Date().toISOString(), observedAt,
      trains: [{ id: 'startup-TWL', line: 'TWL', dest: 'TSW', plat: '1', ttnt: 1, observedAt, delay: false, timeType: 'A', anchor: 'ADM', path: ['CEN', 'ADM', 'TST', 'JOR', 'YMT', 'MOK', 'PRE', 'SSP', 'CSW', 'LCK', 'MEF', 'LAK', 'KWF', 'KWH', 'TWH', 'TSW'], hold: ['CEN', 'ADM', 'TST', 'JOR', 'YMT', 'MOK', 'PRE', 'SSP', 'CSW', 'LCK', 'MEF', 'LAK', 'KWF', 'KWH', 'TWH', 'TSW'] }],
      boards: [{ observedAt, line: 'TWL', station: 'ADM', message: '', trains: [{ dest: 'TSW', plat: '1', ttnt: 1, delay: false, timeType: 'A' }] }],
    } });
  });
  await context.addInitScript(({ native, language }) => {
    localStorage.setItem('hk-traffic-language-v1', language === 'tc' ? 'zh' : language);
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__gpsRequests = [];
    window.__errors = [];
    window.addEventListener('error', event => window.__errors.push(event.message));
    const nativePosition = native ? navigator.geolocation.getCurrentPosition.bind(navigator.geolocation) : undefined;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, error, options) { window.__gpsRequests.push({ success, error, options }); if (nativePosition) nativePosition(success, error, options); } } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) {
      leaflet = value;
      if (value.__startupInstrumented) return;
      value.__startupInstrumented = true;
      value.Map.addInitHook(function() { window.__map = this; });
    } });
  }, { native, language });
  const page = await context.newPage();
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.leaflet-container').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded, { timeout: 30000 });
  await page.locator('.gps-button').waitFor();
  return { context, page, gps: page.locator('.gps-button'), calls: () => mtrCalls, times: mtrTimes };
}

async function test(name, run) {
  if (filter && !filter.test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Startup automatically requests GPS once after map readiness', async () => {
    const { page, context, gps } = await create();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__gpsRequests.length), 1, 'Map readiness must automatically request the location once');
    assert.equal(await gps.isDisabled(), true, 'Automatic GPS request must lock its control');
    await page.evaluate(() => window.__gpsRequests[0].success({ coords: { latitude: 22.2819, longitude: 114.1585, accuracy: 20 }, timestamp: Date.now() }));
    await page.waitForFunction(() => window.__map.getZoom() >= 16);
    assert.equal(await page.locator('.user-location-dot').count(), 1, 'Automatic success must render the user location');
    await page.getByRole('button', { name: 'Chinese', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__gpsRequests.length), 1, 'A language rerender must not request GPS again');
    await context.close();
  });
  await test('MTR is enabled on first visit and renders moving train positions', async () => {
    const { page, context, calls } = await create();
    const mtr = page.locator('.layer-card.mtr [role="switch"]');
    await mtr.waitFor({ state: 'attached' });
    assert.equal(await mtr.getAttribute('aria-checked'), 'true', 'MTR must be enabled for a first visit');
    await page.locator('.vehicle-marker').waitFor({ timeout: 10000 });
    assert.ok(calls() >= 1, 'Enabling MTR must fetch its feed');
    const position = () => page.evaluate(() => {
      let result;
      window.__map.eachLayer(layer => { if (layer.options?.icon?.options?.className?.includes('vehicle-marker')) { const point = layer.getLatLng(); result = { lat: point.lat, lng: point.lng }; } });
      return result;
    });
    const before = await position();
    await page.waitForTimeout(2100);
    const after = await position();
    assert.ok(Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng) > 0.000001, 'The real map renderer must move a train as the arrival clock advances');
    assert.deepEqual(await page.evaluate(() => window.__errors), [], 'Startup must not cause runtime errors');
    await context.close();
  });
  await test('MTR polls while enabled and a user choice to disable survives rerenders', async () => {
    const { page, context, calls, times } = await create();
    const mtr = page.locator('.layer-card.mtr [role="switch"]');
    await page.locator('.vehicle-marker').waitFor({ timeout: 10000 });
    await page.waitForTimeout(250);
    const initialCalls = calls();
    await page.waitForTimeout(16000);
    assert.ok(calls() > initialCalls, 'Enabled MTR must refresh automatically after 15 seconds');
    const interval = times[initialCalls] - times[initialCalls - 1];
    assert.ok(interval >= 14000 && interval <= 17000, `MTR polling interval must be about 15 seconds: ${interval}ms`);
    await mtr.click();
    assert.equal(await mtr.getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('.vehicle-marker').count(), 0, 'Disabling MTR must remove its moving vehicles');
    const afterDisable = calls();
    await page.getByRole('button', { name: 'Chinese', exact: true }).click();
    await page.evaluate(() => { window.__map.setView([22.285, 114.16], 15, { animate: false }); });
    await page.waitForTimeout(16000);
    assert.equal(await mtr.getAttribute('aria-checked'), 'false', 'User disabling MTR must survive language and viewport rerenders');
    assert.equal(calls(), afterDisable, 'Disabled MTR must stop polling');
    assert.equal(await page.evaluate(() => window.__gpsRequests.length), 1, 'Layer, language and viewport rerenders must not request GPS again');
    await context.close();
  });
  for (const [label, viewport, language] of [['desktop', { width: 1440, height: 1000 }, 'en'], ['mobile', { width: 390, height: 844 }, 'tc']]) {
    await test(label + ': native permission grant locates automatically with MTR visible', async () => {
      const { page, context, gps } = await create({ native: true, viewport, language });
      await page.locator('.user-location-dot').waitFor({ timeout: 10000 });
      await page.locator('.vehicle-marker').waitFor({ timeout: 10000 });
      await page.waitForFunction(() => window.__map.getZoom() >= 16);
      const center = await page.evaluate(() => ({ lat: window.__map.getCenter().lat, lng: window.__map.getCenter().lng, zoom: window.__map.getZoom() }));
      assert.ok(Math.abs(center.lat - 22.2819) < 0.00001 && Math.abs(center.lng - 114.1585) < 0.00001, 'Native automatic GPS must center on the browser position');
      assert.equal(center.zoom, 16, 'Automatic GPS must zoom to street level');
      assert.equal(await gps.isDisabled(), false);
      assert.equal(await page.evaluate(() => window.__gpsRequests.length), 1, 'Native GPS must be requested exactly once');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Startup layers must not introduce horizontal overflow');
      const gpsBox = await gps.boundingBox();
      assert.ok(gpsBox.x >= 0 && gpsBox.y >= 0 && gpsBox.x + gpsBox.width <= viewport.width && gpsBox.y + gpsBox.height <= viewport.height, 'GPS target must remain in the viewport');
      assert.ok(await gps.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), 'GPS must remain reachable above map overlays');
      await page.screenshot({ path: path.join(evidence, label + '-automatic-gps-mtr.png'), fullPage: true });
      assert.deepEqual(await page.evaluate(() => window.__errors), [], 'Native startup must not cause runtime errors');
      await context.close();
    });
  }
  if (staticMode) await test('Static export keeps unavailable MTR disabled without locking refresh', async () => {
    const { page, context, calls } = await create({ settledFeedFailures: true });
    const mtr = page.locator('.layer-card.mtr [role="switch"]');
    await mtr.waitFor({ state: 'attached' });
    assert.equal(await mtr.isDisabled(), true, 'Static export must keep its hosted-only MTR switch unavailable');
    await page.waitForFunction(() => ['flow', 'incident', 'redlight', 'speed', 'snapshot', 'parking', 'rainfall'].every(kind => !document.querySelector(`.layer-card.${kind} .spin`)), { timeout: 15000 });
    console.log('Static settled state: ' + JSON.stringify({ mtrEnabled: await mtr.getAttribute('aria-checked'), mtrSpinner: await page.locator('.layer-card.mtr .spin').count(), footerDisabled: await page.locator('.sidebar-footer button').isDisabled(), mapRefreshDisabled: await page.locator('.status-refresh').isDisabled() }));
    assert.equal(await mtr.getAttribute('aria-checked'), 'false', 'An unavailable MTR layer must not be enabled by default');
    assert.equal(await page.locator('.layer-card.mtr .spin').count(), 0, 'An unavailable MTR layer must not retain a loading spinner');
    assert.equal(await page.locator('.sidebar-footer button').isDisabled(), false, 'Refresh must unlock after original feeds settle');
    assert.equal(await page.locator('.status-refresh').isDisabled(), false, 'Map refresh must also unlock after active feeds settle');
    assert.equal(calls(), 0, 'Static export must not request an unavailable MTR feed');
    await context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close();
  await fs.writeFile(path.join(evidence, 'startup-browser-results.json'), JSON.stringify({ origin, results, fixture: staticMode ? 'Original official feeds return deterministic HTTP 503 failures; the static UI, layer gates and settled loading states use production code.' : 'Only /api/mtr is a deterministic network fixture; train conversion, movement and Leaflet rendering use production code.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length }));
if (results.some(result => !result.ok)) process.exitCode = 1;
