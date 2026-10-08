// With dev running: node tests/transit-refresh.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package or file URL; PLAYWRIGHT_CHANNEL defaults to chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/transit-refresh');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const kinds = ['mtr', 'lrt', 'kmb', 'citybus', 'gmb', 'nlb', 'ferry'];
const buses = ['kmb', 'citybus', 'gmb', 'nlb'];
const contexts = [], results = [], cadence = {};
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const selection = { operator: 'kmb', company: 'KMB', route: '1', bound: 'O', serviceType: '1', stopId: 'fixture', stopSeq: 1 };

function payload(kind, generation, at, complete = true) {
  const observedAt = new Date(at).toISOString();
  const base = { ok: true, complete, observedAt, fetchedAt: observedAt };
  const call = { route: '1', destTc: `終點 ${generation}`, destEn: `Destination ${generation}`, eta: new Date(at + 120000).toISOString(), minutes: 2, scheduled: false, remarkTc: '', remarkEn: '' };
  if (kind === 'mtr') return { ...base, trains: [], boards: [{ line: 'TWL', station: 'ADM', observedAt, message: '', trains: [{ dest: 'TSW', plat: '1', ttnt: generation + 1, delay: false, timeType: 'A' }] }] };
  if (kind === 'lrt') return { ...base, trains: [], boards: [{ station: '1', observedAt, calls: [{ route: '610', dest: '2', destTc: '兆康', destEn: 'Siu Hong', plat: '1', ttnt: generation + 1, timeType: 'A' }] }] };
  if (kind === 'ferry') return { ...base, vessels: [], piers: [{ id: 'fixture', nameTc: `碼頭 ${generation}`, nameEn: `Ferry generation ${generation}`, lng: 113.951, lat: 22.284, calls: [call] }] };
  if (kind === 'bus-route') return { ...base, stale: false, route: { key: JSON.stringify(selection), operator: 'kmb', company: 'KMB', route: '1', geometry: 'road', coordinates: [[113.949, 22.282], [113.955, 22.282]], stops: [{ id: 'fixture', seq: 1, nameTc: '起點', nameEn: 'Origin', lng: 113.949, lat: 22.282, distance: 0 }, { id: 'terminus', seq: 2, nameTc: '終點', nameEn: 'Terminus', lng: 113.955, lat: 22.282, distance: 618 }] }, vehicle: { id: 'fixture', fromDistance: generation * 50, toDistance: 618, departureAt: at, arrivalAt: at + 120000, validUntil: at + 180000 } };
  return { ...base, stops: [{ id: 'fixture', nameTc: `${kind} 車站 ${generation}`, nameEn: `${kind} generation ${generation}`, lng: 113.95 + buses.indexOf(kind) * .0007, lat: 22.282, routes: ['1'], calls: [{ ...call, company: 'KMB', ...(kind === 'kmb' ? { tracking: selection } : {}) }] }] };
}

async function until(condition, message = 'Expected browser state did not arrive') {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(await condition(), message);
}
async function create({ incomplete = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  const calls = Object.fromEntries([...kinds, 'bus-route'].map(kind => [kind, []]));
  const mode = Object.fromEntries(kinds.map(kind => [kind, incomplete && ['mtr', 'lrt'].includes(kind) ? 'incomplete' : 'complete']));
  const held = [], failed = [];
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Unrelated official feed excluded from fixture' }));
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en'); localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = []; window.addEventListener('error', event => window.__errors.push(event.message));
    // Record at invocation; asynchronous route-handler clock reads include fixture latency.
    window.__transitFetchTimes = {};
    const nativeFetch = window.fetch;
    window.fetch = function(...args) {
      const input = args[0] instanceof Request ? args[0].url : String(args[0]);
      const kind = new URL(input, location.href).pathname.match(/\/api\/(mtr|lrt|kmb|citybus|gmb|nlb|ferry|bus-route)$/)?.[1];
      if (kind) (window.__transitFetchTimes[kind] ??= []).push(Date.now());
      return nativeFetch.apply(this, args);
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.clock.install();
  page.on('requestfailed', request => { if (/\/api\/(mtr|lrt|kmb|citybus|gmb|nlb|ferry|bus-route)\?/.test(request.url())) failed.push(request.url()); });
  await context.route('**/api/**', async route => {
    const kind = new URL(route.request().url()).pathname.split('/')[2];
    if (!(kind in calls)) return route.fulfill({ json: { ok: true, observedAt: new Date().toISOString(), warnings: [], boards: [], trains: [], stops: [], points: [], piers: [], vessels: [] } });
    const at = await page.evaluate(() => Date.now());
    const generation = calls[kind].push({ at, url: route.request().url() });
    const json = payload(kind, generation, at, mode[kind] !== 'incomplete');
    if (mode[kind] === 'hold') { held.push({ kind, route, json }); return; }
    if (mode[kind] === 'fail') return route.fulfill({ status: 503, body: 'Fixture feed failure' });
    return route.fulfill({ json });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  for (const kind of kinds.filter(kind => kind !== 'mtr')) await page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
  await until(() => kinds.every(kind => calls[kind].length > 0));
  await until(async () => (await page.locator('[data-marker-id="ferry-fixture"]').count()) === 1 && (await page.locator('[data-marker-id="nlb-fixture"]').count()) === 1);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  return { context, page, calls, mode, held, failed };
}
const counts = state => Object.fromEntries(kinds.map(kind => [kind, state.calls[kind].length]));
async function tick(state, milliseconds = 5000) {
  await state.page.clock.runFor(milliseconds);
  await new Promise(resolve => setTimeout(resolve, 150));
}
async function changed(state, before) {
  await until(() => kinds.every(kind => state.calls[kind].length === before[kind] + 1), `Every transit endpoint must poll once in 5 seconds: ${JSON.stringify(counts(state))}`);
}
async function labels(state) {
  return state.page.evaluate(() => Object.fromEntries(['mtr-ADM', 'lrt-1', 'kmb-fixture', 'citybus-fixture', 'gmb-fixture', 'nlb-fixture', 'ferry-fixture'].map(id => [id, document.querySelector(`[data-marker-id="${id}"]`)?.getAttribute('aria-label')])));
}
async function waitLabels(state, before) {
  await until(async () => Object.entries(await labels(state)).every(([id, value]) => value && value !== before[id]), 'New endpoint responses must visibly update every transit marker label or arrival board');
}
async function assertCadence(state, kind) {
  const times = await state.page.evaluate(kind => window.__transitFetchTimes[kind], kind);
  cadence[kind] = times.at(-1) - times.at(-2);
  assert.equal(cadence[kind], 5000, `${kind} browser fetch invocations are exactly 5 seconds apart`);
}
async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('All seven transit feeds update every 5 seconds; incomplete rail startup cannot suppress polling', async () => {
    const state = await create({ incomplete: true });
    for (const kind of ['mtr', 'lrt']) assert.equal(await state.page.locator(`.layer-card.${kind} [role="alert"]`).count(), 1);
    for (const kind of kinds) state.mode[kind] = 'complete';
    let before = counts(state), visible = await labels(state);
    await tick(state); await changed(state, before); await waitLabels(state, visible);
    for (const kind of ['mtr', 'lrt']) assert.equal(await state.page.locator(`.layer-card.${kind} [role="alert"]`).count(), 0);
    before = counts(state); visible = await labels(state);
    await tick(state); await changed(state, before); await waitLabels(state, visible);
    for (const kind of kinds) await assertCadence(state, kind);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.page.screenshot({ path: path.join(evidence, 'all-transit-refresh.png') });
    await state.context.close();
  });
  await test('Failures recover on the next poll; slow requests survive later ticks; manual refresh and layer switches work', async () => {
    const state = await create();
    let before = counts(state), visible = await labels(state);
    for (const kind of kinds) state.mode[kind] = 'fail';
    await tick(state); await changed(state, before);
    await until(async () => (await state.page.locator(kinds.map(kind => `.layer-card.${kind} [role="alert"]`).join(',')).count()) === 7);
    assert.deepEqual(await labels(state), visible, 'Failed refresh keeps the last known data visible');
    before = counts(state);
    for (const kind of kinds) state.mode[kind] = 'complete';
    await tick(state); await changed(state, before); await waitLabels(state, visible);
    await until(async () => (await state.page.locator(kinds.map(kind => `.layer-card.${kind} [role="alert"]`).join(',')).count()) === 0);
    before = counts(state); visible = await labels(state);
    const failedBeforeSlowRequest = state.failed.length;
    for (const kind of kinds) state.mode[kind] = 'hold';
    await tick(state); await changed(state, before);
    await tick(state, 10000);
    assert.deepEqual(counts(state), Object.fromEntries(kinds.map(kind => [kind, before[kind] + 1])), 'Later timer ticks neither abort nor duplicate pending requests');
    assert.deepEqual(state.failed.slice(failedBeforeSlowRequest), [], 'A request slower than the cadence must remain alive');
    for (const item of state.held.splice(0)) await item.route.fulfill({ json: item.json });
    await waitLabels(state, visible);
    for (const kind of kinds) state.mode[kind] = 'complete';
    await until(() => state.page.locator('.sidebar-footer > button').isEnabled());
    before = counts(state); visible = await labels(state);
    await state.page.locator('.sidebar-footer > button').evaluate(element => element.click());
    await changed(state, before); await waitLabels(state, visible);
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
    before = counts(state);
    await tick(state, 15000);
    assert.deepEqual(counts(state), before, 'Disabled layers stop polling');
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
    await changed(state, before);
    before = counts(state);
    await tick(state); await changed(state, before);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  await test('Selected bus route refreshes actual data and estimated marker every 5 seconds', async () => {
    const state = await create();
    await state.page.locator('[data-marker-id="kmb-fixture"] .marker-displacement').evaluate(element => element.click());
    await state.page.locator('.stop-eta-popup .bus-route-button').first().evaluate(element => element.click());
    await until(() => state.calls['bus-route'].length === 1);
    await until(async () => (await state.page.locator('.bus-route-marker').count()) === 1);
    await state.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    const position = () => state.page.evaluate(() => { let point; window.__map.eachLayer(layer => { if (layer.getElement?.()?.classList.contains('bus-route-marker')) point = layer.getLatLng().lng; }); return point; });
    for (const expected of [2, 3]) {
      const before = await position();
      await tick(state);
      await until(() => state.calls['bus-route'].length === expected);
      await until(async () => (await position()) !== before, 'The route marker consumes the refreshed vehicle estimate');
      await assertCadence(state, 'bus-route');
    }
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.page.screenshot({ path: path.join(evidence, 'bus-route-refresh.png') });
    await state.context.close();
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await fs.writeFile(path.join(evidence, 'transit-refresh-results.json'), JSON.stringify({ origin, results, cadenceMs: cadence, fixture: 'Mocked official and transit endpoints; Playwright clock advances the real application timers; synchronous browser fetch timestamps, actual request counts and visible Leaflet data updates are asserted.' }, null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
