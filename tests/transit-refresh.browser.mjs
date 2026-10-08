// With dev running: node tests/transit-refresh.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package or file URL; PLAYWRIGHT_CHANNEL defaults to chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/transit-refresh');
const filter = process.env.TRANSIT_TEST_FILTER ? new RegExp(process.env.TRANSIT_TEST_FILTER) : null;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const kinds = ['mtr', 'lrt', 'kmb', 'citybus', 'gmb', 'nlb', 'ferry'];
const buses = ['kmb', 'citybus', 'gmb', 'nlb'];
const contexts = [], results = [];
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
async function create({ incomplete = false, gated = false, hold = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  const calls = Object.fromEntries([...kinds, 'bus-route'].map(kind => [kind, []]));
  const mode = Object.fromEntries(kinds.map(kind => [kind, hold ? 'hold' : incomplete && ['mtr', 'lrt'].includes(kind) ? 'incomplete' : 'complete']));
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
    if (mode[kind] === 'api-fail') return route.fulfill({ json: { ok: false, error: 'Fixture route upstream unavailable', observedAt: null, stale: false, vehicle: null } });
    if (mode[kind] === 'fail') return route.fulfill({ status: 503, body: 'Fixture feed failure' });
    return route.fulfill({ json });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  if (!gated) await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  for (const kind of kinds.filter(kind => kind !== 'mtr')) await page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
  await until(() => kinds.filter(kind => !gated || !buses.includes(kind)).every(kind => calls[kind].length > 0));
  if (!hold) {
    await until(async () => (await page.locator('[data-marker-id="ferry-fixture"]').count()) === 1 && (gated || (await page.locator('[data-marker-id="nlb-fixture"]').count()) === 1));
    await until(() => page.locator('.sidebar-footer > button').isEnabled());
  }
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  return { context, page, calls, mode, held, failed };
}
const counts = state => Object.fromEntries(kinds.map(kind => [kind, state.calls[kind].length]));
async function tick(state, milliseconds = 60000) {
  if (milliseconds >= 30000) await state.page.clock.fastForward(milliseconds);
  else await state.page.clock.runFor(milliseconds);
  await new Promise(resolve => setTimeout(resolve, 150));
}
async function changed(state, before) {
  await until(() => kinds.every(kind => state.calls[kind].length === before[kind] + 1), `Manual refresh must reload every active transit endpoint once: ${JSON.stringify(counts(state))}`);
}
async function labels(state) {
  return state.page.evaluate(() => Object.fromEntries(['mtr-ADM', 'lrt-1', 'kmb-fixture', 'citybus-fixture', 'gmb-fixture', 'nlb-fixture', 'ferry-fixture'].map(id => [id, document.querySelector(`[data-marker-id="${id}"]`)?.getAttribute('aria-label')])));
}
async function waitLabels(state, before) {
  await until(async () => Object.entries(await labels(state)).every(([id, value]) => value && value !== before[id]), 'New endpoint responses must visibly update every transit marker label or arrival board');
}
async function requestCounts(state) {
  return {
    network: Object.fromEntries(Object.entries(state.calls).map(([kind, calls]) => [kind, calls.length])),
    invoked: await state.page.evaluate(() => Object.fromEntries(['mtr', 'lrt', 'kmb', 'citybus', 'gmb', 'nlb', 'ferry', 'bus-route'].map(kind => [kind, window.__transitFetchTimes[kind]?.length ?? 0]))),
  };
}
async function refresh(state) {
  await until(() => state.page.locator('.sidebar-footer > button').isEnabled());
  await state.page.locator('.sidebar-footer > button').evaluate(element => element.click());
}
async function visibility(page) {
  await page.evaluate(() => {
    for (const value of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
}
async function languageChanges(state) {
  for (const [index, expected] of [[1, 'zh-HK'], [0, 'en-HK']]) {
    await state.page.locator('.language-toggle button').nth(index).evaluate(element => element.click());
    await until(() => state.page.evaluate(expected => document.documentElement.lang === expected, expected));
  }
}
async function test(name, run) {
  if (filter && !filter.test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Transit loads once; timers, visibility, language, switches and panning do not reload; station borders are black', async () => {
    const state = await create();
    const before = await requestCounts(state);
    const once = Object.fromEntries([...kinds.map(kind => [kind, 1]), ['bus-route', 0]]);
    assert.deepEqual(before, { network: once, invoked: once }, 'Each eligible transit layer loads exactly once initially');
    for (const kind of ['mtr', 'lrt']) {
      const styles = await state.page.locator(`[data-marker-id^="${kind}-"].station-marker.rail-marker .marker-inner`).evaluateAll(elements => elements.map(element => ({ color: getComputedStyle(element).borderColor, width: getComputedStyle(element).borderWidth })));
      assert.ok(styles.length, `${kind} includes real station markers`);
      assert.ok(styles.every(style => style.color === 'rgb(0, 0, 0)' && style.width === '2px'), `${kind} station borders must be black and 2px wide`);
    }
    await state.page.locator('.source-button').evaluate(element => element.click());
    assert.equal(await state.page.locator('.sources-dialog').getByText('Loads initially; use Refresh or Retry to update.', { exact: true }).count(), 7, 'Source descriptions must advertise initial/manual refresh for every transit feed');
    await state.page.locator('.sources-dialog .close-button').evaluate(element => element.click());
    await tick(state, 300000);
    assert.deepEqual(await requestCounts(state), before, 'Long clock advances must not poll any transit feed');
    await visibility(state.page);
    await languageChanges(state);
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
    await state.page.evaluate(() => { window.__map.setView([22.31, 114.18], 12, { animate: false }); });
    await state.page.evaluate(() => { window.__map.setView([22.283, 113.952], 17, { animate: false }); });
    await tick(state);
    assert.deepEqual(await requestCounts(state), before, 'Visibility, language, off/on and panning reuse the initial data');
    const visible = await labels(state), manualBefore = counts(state);
    await refresh(state); await changed(state, manualBefore); await waitLabels(state, visible);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.page.screenshot({ path: path.join(evidence, 'all-transit-refresh.png') });
    await state.context.close();
  });
  await test('Gated bus layers load at the first eligible viewport and never reload automatically afterward', async () => {
    const state = await create({ gated: true });
    const before = await requestCounts(state);
    for (const kind of buses) assert.equal(before.network[kind], 0, `${kind} cannot load before its viewport is eligible`);
    await tick(state);
    assert.deepEqual(await requestCounts(state), before);
    await state.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    await until(() => buses.every(kind => state.calls[kind].length === 1));
    await until(async () => (await state.page.locator('[data-marker-id="nlb-fixture"]').count()) === 1);
    const loaded = await requestCounts(state);
    await state.page.evaluate(() => { window.__map.setView([22.285, 113.955], 17, { animate: false }); });
    await tick(state);
    assert.deepEqual(await requestCounts(state), loaded, 'Panning after the first eligible bus load does not fetch again');
    await state.context.close();
  });
  await test('Pending initial transit responses survive panning, language changes and off/on without duplicate fetches', async () => {
    const state = await create({ hold: true });
    const before = await requestCounts(state), failedBefore = state.failed.length;
    await state.page.evaluate(() => { window.__map.setView([22.283, 113.952], 17, { animate: false }); });
    await languageChanges(state);
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind} [role="switch"]`).evaluate(element => element.click());
    await tick(state, 20000);
    assert.deepEqual(await requestCounts(state), before, 'Initial requests are neither canceled nor replaced by context changes');
    assert.deepEqual(state.failed.slice(failedBefore), [], 'Every initial request remains alive');
    for (const item of state.held.splice(0)) await item.route.fulfill({ json: item.json });
    await until(async () => Object.values(await labels(state)).every(Boolean), 'All initial responses must become visible after context changes');
    await tick(state);
    assert.deepEqual(await requestCounts(state), before, 'Completing retained initial loads must not schedule more requests');
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  await test('Failures wait for manual Retry; slow manual refreshes survive time advances without duplicate requests', async () => {
    const state = await create();
    let before = counts(state), visible = await labels(state);
    for (const kind of kinds) state.mode[kind] = 'fail';
    await refresh(state); await changed(state, before);
    await until(async () => (await state.page.locator(kinds.map(kind => `.layer-card.${kind} [role="alert"]`).join(',')).count()) === 7);
    assert.deepEqual(await labels(state), visible, 'Failed refresh keeps the last known data visible');
    const failedCounts = await requestCounts(state);
    await tick(state);
    assert.deepEqual(await requestCounts(state), failedCounts, 'Errors must not start automatic retries');
    before = counts(state);
    for (const kind of kinds) state.mode[kind] = 'complete';
    for (const kind of kinds) await state.page.locator(`.layer-card.${kind}`).getByRole('button', { name: 'Retry', exact: true }).evaluate(element => element.click());
    await changed(state, before); await waitLabels(state, visible);
    await until(async () => (await state.page.locator(kinds.map(kind => `.layer-card.${kind} [role="alert"]`).join(',')).count()) === 0);
    before = counts(state); visible = await labels(state);
    const failedBeforeSlowRequest = state.failed.length;
    for (const kind of kinds) state.mode[kind] = 'hold';
    await refresh(state); await changed(state, before);
    const pending = await requestCounts(state);
    await tick(state, 20000);
    assert.deepEqual(await requestCounts(state), pending, 'Time advances must neither abort nor duplicate a pending manual request');
    assert.deepEqual(state.failed.slice(failedBeforeSlowRequest), [], 'Slow manual requests remain alive');
    for (const item of state.held.splice(0)) await item.route.fulfill({ json: item.json });
    await waitLabels(state, visible);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  await test('Selected bus route loads once, retains data across visibility and language changes, and refreshes explicitly', async () => {
    const state = await create();
    await state.page.locator('[data-marker-id="kmb-fixture"] .marker-displacement').evaluate(element => element.click());
    await state.page.locator('.stop-eta-popup .bus-route-button').first().evaluate(element => element.click());
    await until(() => state.calls['bus-route'].length === 1);
    await until(async () => (await state.page.locator('.bus-route-marker').count()) === 1);
    await state.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    const position = () => state.page.evaluate(() => { let point; window.__map.eachLayer(layer => { if (layer.getElement?.()?.classList.contains('bus-route-marker')) point = layer.getLatLng().lng; }); return point; });
    const initial = await requestCounts(state);
    await tick(state);
    await visibility(state.page);
    await languageChanges(state);
    await tick(state);
    assert.deepEqual(await requestCounts(state), initial, 'An already selected route never refreshes automatically');
    const before = await position();
    await refresh(state);
    await until(() => state.calls['bus-route'].length === 2);
    await until(async () => (await position()) !== before, 'Manual refresh updates the route vehicle estimate');
    state.mode['bus-route'] = 'api-fail';
    await refresh(state);
    await until(() => state.calls['bus-route'].length === 3);
    await state.page.locator('#panel-tab-details').evaluate(element => element.click());
    await until(async () => (await state.page.locator('.bus-route-status .warning-text').count()) > 0);
    assert.equal(await state.page.locator('.bus-route-polyline').count(), 1, 'An HTTP-200 API failure retains the last route geometry');
    assert.equal(await state.page.locator('.bus-route-marker').count(), 0, 'Failed route data must not show an estimated vehicle');
    assert.match(await state.page.locator('.bus-route-status').innerText(), /Retained data/);
    const failed = await requestCounts(state);
    await tick(state);
    assert.deepEqual(await requestCounts(state), failed, 'A failed selected route waits for an explicit Retry');
    state.mode['bus-route'] = 'complete';
    await state.page.locator('.bus-route-status').getByRole('button', { name: 'Retry', exact: true }).evaluate(element => element.click());
    await until(() => state.calls['bus-route'].length === 4);
    await until(async () => (await state.page.locator('.bus-route-status .warning-text').count()) === 0);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.page.screenshot({ path: path.join(evidence, 'bus-route-refresh.png') });
    await state.context.close();
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await fs.writeFile(path.join(evidence, 'transit-refresh-results.json'), JSON.stringify({ origin, results, fixture: 'Mocked official and transit endpoints; long Playwright clock advances and application interactions verify no automatic transit fetches. Native fetch invocation counts, actual requests, manual updates and rendered station borders are asserted.' }, null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
