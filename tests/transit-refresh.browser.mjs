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
  // Stepped runFor: fastForward fires each timer at most once, which would
  // hide the polling cadence; 5-second steps fire refreshAll once per step.
  const step = 5000;
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) await state.page.clock.runFor(Math.min(step, milliseconds - elapsed));
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
  await test('Transit polls on cadence; language and gated pans reuse data; eligible pans refetch viewport feeds', async () => {
    const state = await create();
    const initial = await requestCounts(state);
    const once = Object.fromEntries([...kinds.map(kind => [kind, 1]), ['bus-route', 0]]);
    assert.deepEqual(initial, { network: once, invoked: once }, 'Each eligible transit layer loads exactly once initially');
    for (const kind of ['mtr', 'lrt']) {
      const pills = await state.page.locator(`[data-marker-id^="${kind}-"].station-marker .station-label`).evaluateAll(elements => elements.map(element => ({ text: element.textContent.trim(), radius: getComputedStyle(element).borderRadius })));
      assert.ok(pills.length, `${kind} includes station name pills`);
      assert.ok(pills.every(pill => pill.text.length > 0 && pill.radius === '999px'), 'Station pills carry rounded station names');
    }
    await state.page.locator('.source-button').evaluate(element => element.click());
    assert.equal(await state.page.locator('.sources-dialog').getByText('Refresh interval: 30 seconds while visible.', { exact: true }).count(), 6, 'Rail and bus feeds advertise their 30-second cadence');
    assert.equal(await state.page.locator('.sources-dialog').getByText('Refresh interval: 60 seconds while visible.', { exact: true }).count(), 3, 'Ferries, boundary queues and weather warnings advertise their 60-second cadence');
    await state.page.locator('.sources-dialog .close-button').evaluate(element => element.click());
    await tick(state, 300000);
    const polled = await requestCounts(state);
    for (const kind of ['mtr', 'lrt']) assert.ok(polled.network[kind] >= 10 && polled.network[kind] <= 11, `${kind} must poll about every 30 seconds while visible (${polled.network[kind]})`);
    for (const kind of buses) assert.ok(polled.network[kind] >= 10 && polled.network[kind] <= 11, `${kind} must poll about every 30 seconds while visible (${polled.network[kind]})`);
    assert.ok(polled.network.ferry >= 5 && polled.network.ferry <= 6, `ferry must poll about every 60 seconds while visible (${polled.network.ferry})`);
    await visibility(state.page);
    await languageChanges(state);
    assert.deepEqual(await requestCounts(state), polled, 'Visibility and language changes reuse the cadence data');
    await state.page.evaluate(() => { window.__map.setView([22.31, 114.18], 12, { animate: false }); });
    await tick(state, 10000);
    assert.deepEqual(await requestCounts(state), polled, 'A gated viewport must not fetch bus feeds');
    await state.page.evaluate(() => { window.__map.setView([22.283, 113.952], 17, { animate: false }); });
    await until(() => buses.every(kind => state.calls[kind].length === polled.network[kind] + 1), 'An eligible pan must refetch every bus feed for the new viewport');
    const afterPan = await requestCounts(state);
    assert.equal(afterPan.network.mtr, polled.network.mtr, 'Network-wide rail feeds do not refetch on pan');
    assert.equal(afterPan.network.ferry, polled.network.ferry, 'Ferries do not refetch on pan');
    const visible = await labels(state), manualBefore = counts(state);
    await refresh(state); await changed(state, manualBefore); await waitLabels(state, visible);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.page.screenshot({ path: path.join(evidence, 'all-transit-refresh.png') });
    await state.context.close();
  });
  await test('Gated bus layers load at the first eligible viewport, follow pans and keep polling while visible', async () => {
    const state = await create({ gated: true });
    const before = await requestCounts(state);
    for (const kind of buses) assert.equal(before.network[kind], 0, `${kind} cannot load before its viewport is eligible`);
    await tick(state);
    const gated = await requestCounts(state);
    for (const kind of buses) assert.equal(gated.network[kind], 0, `${kind} stays gated at an ineligible viewport`);
    assert.ok(gated.network.mtr >= 2 && gated.network.lrt >= 2, 'Rail keeps polling even while bus feeds are gated');
    await state.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    await until(() => buses.every(kind => state.calls[kind].length === 1));
    await until(async () => (await state.page.locator('[data-marker-id="nlb-fixture"]').count()) === 1);
    const loaded = await requestCounts(state);
    await state.page.evaluate(() => { window.__map.setView([22.285, 113.955], 17, { animate: false }); });
    await until(() => buses.every(kind => state.calls[kind].length === 2), 'Panning to a new eligible viewport refetches every bus feed');
    await tick(state, 65000);
    for (const kind of buses) assert.ok(state.calls[kind].length >= 4, `${kind} keeps polling about every 30 seconds (${state.calls[kind].length})`);
    await state.context.close();
  });
  await test('Pending initial responses survive language changes; pans replace only viewport feeds', async () => {
    const state = await create({ hold: true });
    const before = await requestCounts(state), failedBefore = state.failed.length;
    await languageChanges(state);
    await tick(state, 10000);
    assert.deepEqual(await requestCounts(state), before, 'Language changes neither cancel nor replace in-flight requests');
    assert.deepEqual(state.failed.slice(failedBefore), [], 'Every initial request remains alive across language changes');
    await state.page.evaluate(() => { window.__map.setView([22.283, 113.952], 17, { animate: false }); });
    await until(() => buses.every(kind => state.calls[kind].length === 2), 'Panning replaces the held bus requests with new viewport requests');
    for (const kind of ['mtr', 'lrt', 'ferry']) assert.equal(state.calls[kind].length, 1, `${kind} requests are retained through the pan`);
    for (const item of state.held.splice(0)) await item.route.fulfill({ json: item.json }).catch(() => {});
    await until(async () => Object.values(await labels(state)).every(Boolean), 'All initial responses must become visible after context changes');
    await tick(state, 35000);
    for (const kind of ['mtr', 'lrt']) assert.ok(state.calls[kind].length >= 2, `${kind} resumes its polling cadence once the retained load completes`);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  await test('Failures auto-retry on cadence; slow manual refreshes survive time advances without duplicate requests', async () => {
    const state = await create();
    let before = counts(state), visible = await labels(state);
    for (const kind of kinds) state.mode[kind] = 'fail';
    await refresh(state); await changed(state, before);
    await until(async () => (await state.page.locator(kinds.map(kind => `.layer-card.${kind} [role="alert"]`).join(',')).count()) === 7);
    assert.deepEqual(await labels(state), visible, 'Failed refresh keeps the last known data visible');
    await tick(state, 65000);
    for (const kind of ['mtr', 'lrt']) assert.ok(state.calls[kind].length >= 4, `${kind} auto-retries about every 30 seconds (${state.calls[kind].length})`);
    for (const kind of buses) assert.ok(state.calls[kind].length >= 4, `${kind} auto-retries about every 30 seconds (${state.calls[kind].length})`);
    assert.ok(state.calls.ferry.length >= 3, `ferry auto-retries about every 60 seconds (${state.calls.ferry.length})`);
    for (const kind of kinds) state.mode[kind] = 'complete';
    await tick(state, 65000);
    await until(async () => (await state.page.locator(kinds.map(kind => `.layer-card.${kind} [role="alert"]`).join(',')).count()) === 0, 'The polling cadence clears feed errors without manual Retry');
    await waitLabels(state, visible);
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
  await test('Selected bus route polls every 30 seconds while visible and recovers automatically from failures', async () => {
    const state = await create();
    await state.page.locator('[data-marker-id="kmb-fixture"] .marker-displacement').evaluate(element => element.click());
    await state.page.locator('.stop-eta-popup .bus-route-button').first().evaluate(element => element.click());
    await until(() => state.calls['bus-route'].length === 1);
    await until(async () => (await state.page.locator('.bus-route-marker').count()) === 1);
    await state.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    const position = () => state.page.evaluate(() => { let point; window.__map.eachLayer(layer => { if (layer.getElement?.()?.classList.contains('bus-route-marker')) point = layer.getLatLng().lng; }); return point; });
    await tick(state, 65000);
    assert.ok(state.calls['bus-route'].length >= 3, `A selected route polls about every 30 seconds (${state.calls['bus-route'].length})`);
    const before = await position();
    await tick(state, 35000);
    assert.ok(state.calls['bus-route'].length >= 4, 'Cadence polls continue while the route stays selected');
    assert.notEqual(await position(), before, 'Cadence refreshes update the route vehicle estimate');
    state.mode['bus-route'] = 'api-fail';
    await tick(state, 65000);
    await state.page.locator('#panel-tab-details').evaluate(element => element.click());
    await until(async () => (await state.page.locator('.bus-route-status .warning-text').count()) > 0);
    assert.equal(await state.page.locator('.bus-route-polyline').count(), 1, 'An HTTP-200 API failure retains the last route geometry');
    assert.equal(await state.page.locator('.bus-route-marker').count(), 0, 'Failed route data must not show an estimated vehicle');
    assert.match(await state.page.locator('.bus-route-status').innerText(), /Retained data/);
    const failed = state.calls['bus-route'].length;
    await tick(state, 35000);
    assert.ok(state.calls['bus-route'].length >= failed + 1, 'A failed selected route keeps auto-retrying');
    state.mode['bus-route'] = 'complete';
    await tick(state, 35000);
    await until(async () => (await state.page.locator('.bus-route-status .warning-text').count()) === 0);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.page.screenshot({ path: path.join(evidence, 'bus-route-refresh.png') });
    await state.context.close();
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await fs.writeFile(path.join(evidence, 'transit-refresh-results.json'), JSON.stringify({ origin, results, fixture: 'Mocked official and transit endpoints; Playwright clock advances verify the polling cadences (rail 15s, buses 30s, ferries 60s), viewport-keyed refetches, retention across language changes and manual updates. Native fetch invocation counts, actual requests and rendered station pills are asserted.' }, null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
