// PLAYWRIGHT_MODULE points to the external runtime used by the other browser scenarios.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { commuterCatalogue } from '../lib/commuter-catalogue.ts';
import { openLayers, reloadAll, emptyRouteVehicles } from './browser-controls.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = process.argv[3] || '/tmp/hkrt-bus-refresh';
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQAAAABJRU5ErkJggg==', 'base64');
const shape = (operator, route) => ({ key: `${operator}:${route}`, operator, route, geometry: 'road', coordinates: [[113.944, 22.28], [113.95, 22.282], [113.965, 22.289]], stops: [
  { id: 'ORIGIN', seq: 1, nameTc: '起點', nameEn: 'Origin', lng: 113.944, lat: 22.28, distance: 0 },
  { id: 'STOP', seq: 2, nameTc: '測試車站', nameEn: 'Fixture stop', lng: 113.95, lat: 22.282, distance: 650 },
  { id: 'END', seq: 3, nameTc: '終點', nameEn: 'Terminus', lng: 113.965, lat: 22.289, distance: 2300 },
] });

async function start({ operator = 'kmb', mode = '2d', width = 1440, language = 'en', clock = false, routes = ['1', '2'], override } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], state = { now: Date.now() };
  page.on('pageerror', error => errors.push(error.message));
  const stop = operator === 'mtr-bus'
    ? { ...commuterCatalogue('mtr-bus').find(camera => camera.routes.includes('K12')), routes: ['K12'] }
    : { id: `${operator}-STOP`, sourceId: 'STOP', kind: operator, name: '測試車站', nameEn: 'Fixture stop', lng: 113.95, lat: 22.282, routes };
  await context.addInitScript(({ operator, mode, language, stop }) => {
    localStorage.setItem('hk-traffic-language-v1', language);
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ [operator]: true }));
    localStorage.setItem('hk-traffic-session-v1', JSON.stringify({ version: 1, mapMode: mode, view: { lng: stop.lng, lat: stop.lat, zoom: 17 }, followLocation: false }));
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get: () => leaflet, set(value) { leaflet = value; value.Map.addInitHook(function () { window.__map = this; }); } });
  }, { operator, mode, language, stop });
  await context.route('**/app/traffic-map-3d.tsx*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('map.current = m;', 'map.current = m; window.__nativeMap = m;') }); });
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, body: 'Unrelated fixture' }));
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.split('/').at(-1);
    if (override && await override({ route, url, endpoint, state })) return;
    const at = new Date(state.now).toISOString();
    if (endpoint === operator && operator === 'mtr-bus') return route.fulfill({ json: { ok: true, cameras: [{ ...stop, arrivals: [] }], observedAt: at, stale: false } });
    if (endpoint === operator) return route.fulfill({ json: { ok: true, observedAt: at, fetchedAt: at, stops: [{ id: stop.sourceId, nameTc: stop.name, nameEn: stop.nameEn, lng: stop.lng, lat: stop.lat, routes, calls: routes.length ? [{ route: routes[0], destTc: '終點', destEn: 'Terminus', eta: new Date(state.now + 120_000).toISOString(), minutes: 2, scheduled: false, tracking: { operator, route: routes[0], stopId: stop.sourceId, bound: 'O', serviceType: '1', routeId: '42', routeSeq: 1 } }] : [] }] } });
    if (endpoint === 'bus-route-paths') return route.fulfill({ json: { ok: true, routes: [shape(url.searchParams.get('operator'), url.searchParams.get('route'))] } });
    if (endpoint === 'route-vehicles') return route.fulfill({ json: emptyRouteVehicles(url) });
    return route.fulfill({ json: { ok: true, observedAt: at, stops: [], cameras: [], boards: [], trains: [], warnings: [] } });
  });
  if (clock) await page.clock.install();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(mode => mode === '2d' ? window.__map?._loaded : window.__nativeMap?.getLayer('hk-transport-lines'), mode);
  return { context, page, stop, errors, state };
}

async function advance(fixture, duration) {
  for (let remaining = duration; remaining > 0;) {
    const step = Math.min(5_000, remaining);
    fixture.state.now += step;
    await fixture.page.clock.runFor(step);
    await fixture.page.waitForTimeout(20);
    remaining -= step;
  }
}

try {
  for (const operator of ['kmb', 'citybus', 'gmb', 'nlb', 'mtr-bus']) for (const [mode, width, language] of [['2d', 1440, 'en'], ['3d', 390, 'zh']]) {
    let fullRouteRequests = 0;
    const fixture = await start({ operator, mode, width, language, override: async ({ route, endpoint }) => {
      if (endpoint === 'bus-route') { fullRouteRequests++; await route.fulfill({ status: 503 }); return true; }
      if (endpoint === 'route-vehicles') { await route.fulfill({ status: 503 }); return true; }
      return false;
    } });
    try {
      const { page, stop } = fixture;
      await page.locator(`[data-marker-id="${stop.id}"] .marker-inner`).click();
      const details = page.locator('.item-detail').last(), prefix = language === 'en' ? 'Zoom to route' : '縮放至路線';
      const code = operator === 'mtr-bus' ? 'K12' : '2';
      await details.getByRole('button', { name: new RegExp(`^${prefix} ${code}(?:$| ·)`) }).waitFor();
      if (operator !== 'mtr-bus') assert.ok(await details.getByRole('button', { name: new RegExp(`^${prefix} 1(?:$| ·)`) }).count(), 'arriving and ETA-less routes both offer zoom');
      const before = await page.evaluate(mode => mode === '2d' ? window.__map.getZoom() : window.__nativeMap.getZoom(), mode);
      await page.screenshot({ path: `${evidence}/popup-${operator}-${mode}-${width}.png` });
      await details.getByRole('button', { name: new RegExp(`^${prefix} ${code}(?:$| ·)`) }).click();
      await details.waitFor({ state: 'detached' });
      await page.waitForFunction(({ mode, before }) => (mode === '2d' ? window.__map.getZoom() : window.__nativeMap.getZoom()) < before, { mode, before });
      assert.equal(fullRouteRequests, 0, 'zoom does not wait for full-route arrival polling');
      assert.deepEqual(fixture.errors, []);
      console.log(`PASS ${operator} ${mode} ${width}px ${language}: popup route zoom without ETA service`);
    } finally { await fixture.context.close(); }
  }

  let calls = 0, failed = true;
  const failure = await start({ clock: true, routes: [], override: async ({ route, endpoint, state }) => {
    if (endpoint !== 'kmb') return false;
    calls++;
    await route.fulfill(failed ? { status: 503 } : { json: { ok: true, observedAt: new Date(state.now).toISOString(), stops: [] } });
    return true;
  } });
  try {
    await openLayers(failure.page, 'bus');
    await failure.page.locator('.layer-card.kmb .layer-error').waitFor();
    await failure.page.clock.pauseAt(new Date(await failure.page.evaluate(() => Date.now()) + 100));
    failure.state.now = await failure.page.evaluate(() => Date.now());
    assert.equal(calls, 1);
    await advance(failure, 31_000); assert.equal(calls, 2);
    await failure.page.evaluate(() => { window.__map.panBy([90, 0], { animate: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await advance(failure, 30_000); assert.equal(calls, 2, 'map movement and visibility cannot bypass failed-operator backoff');
    await advance(failure, 31_000); assert.equal(calls, 3);
    await advance(failure, 59_000); assert.equal(calls, 3, 'third failure waits 120 seconds');
    failed = false;
    const recovered = failure.page.waitForResponse(response => new URL(response.url()).pathname === '/api/kmb' && response.status() === 200);
    await reloadAll(failure.page);
    await recovered;
    assert.equal(calls, 4, 'manual retry bypasses the client cooldown');
    await advance(failure, 31_000); assert.equal(calls, 5, 'healthy recovery restores normal polling');
    await failure.context.setOffline(true);
    await advance(failure, 60_000); assert.equal(calls, 5, 'offline pages do not keep issuing bus requests');
    const reconnected = failure.page.waitForResponse(response => new URL(response.url()).pathname === '/api/kmb');
    await failure.context.setOffline(false);
    // Dispatch explicitly while virtual timers are paused, as in the existing
    // recovery scenarios. Browser emulation can defer its own online event.
    await failure.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await reconnected;
    await advance(failure, 1_000); assert.equal(calls, 6, 'reconnecting refreshes the bus feed');
    assert.deepEqual(failure.errors, []);
    console.log('PASS failed-layer cooldown, pan/visibility stability, manual recovery, normal cadence and offline/reconnect behavior');
  } finally { await failure.context.close(); }

  let alerts = 0;
  const alerted = await start({ operator: 'mtr-bus', clock: true, override: async ({ route, endpoint }) => {
    if (endpoint !== 'mtr-bus') return false;
    alerts++;
    await route.fulfill({ json: { ok: true, cameras: [], observedAt: null, stale: true, complete: false, error: 'MTR bus operator alert (8 of 8)' } });
    return true;
  } });
  try {
    await openLayers(alerted.page, 'bus');
    await alerted.page.locator('.layer-card.mtr-bus .layer-error[role="alert"]').waitFor();
    await alerted.page.clock.pauseAt(new Date(await alerted.page.evaluate(() => Date.now()) + 100));
    alerted.state.now = await alerted.page.evaluate(() => Date.now());
    assert.equal(alerts, 1);
    await advance(alerted, 36_000); assert.equal(alerts, 2);
    await advance(alerted, 30_000); assert.equal(alerts, 2, 'HTTP 200 with all routes stale still backs off as a failed feed');
    assert.deepEqual(alerted.errors, []);
    console.log('PASS MTR Bus total operator alerts remain failures and respect cooldowns');
  } finally { await alerted.context.close(); }

  let geometryCalls = 0, vehicleCalls = 0, releaseGeometry, releaseVehicles;
  const geometryGate = new Promise(resolve => { releaseGeometry = resolve; });
  const vehicleGate = new Promise(resolve => { releaseVehicles = resolve; });
  const pending = await start({ clock: true, routes: ['1'], override: async ({ route, endpoint, url }) => {
    if (endpoint === 'bus-route-paths') { geometryCalls++; await geometryGate; await route.fulfill({ json: { ok: true, routes: [shape('kmb', '1')] } }).catch(() => {}); return true; }
    if (endpoint === 'route-vehicles') { vehicleCalls++; await vehicleGate; await route.fulfill({ json: emptyRouteVehicles(url) }).catch(() => {}); return true; }
    return false;
  } });
  try {
    await pending.page.waitForTimeout(200);
    assert.equal(geometryCalls, 1); assert.equal(vehicleCalls, 1);
    await pending.page.clock.pauseAt(new Date(await pending.page.evaluate(() => Date.now()) + 100));
    pending.state.now = await pending.page.evaluate(() => Date.now());
    await advance(pending, 31_000);
    assert.equal(geometryCalls, 1, 'fresh stop data cannot restart an unchanged geometry request');
    assert.equal(vehicleCalls, 1, 'fresh stop data cannot restart an unchanged position request');
    releaseGeometry(); releaseVehicles();
    await openLayers(pending.page, 'bus');
    await pending.page.locator('.transport-route-list li').filter({ hasText: 'Terminus' }).getByRole('button', { name: /Zoom to route/ }).waitFor();
    assert.deepEqual(pending.errors, []);
    console.log('PASS slow geometry and position requests survive successful layer refreshes');
  } finally { releaseGeometry(); releaseVehicles(); await pending.context.close(); }

  let positionCalls = 0, positionFails = true;
  const positions = await start({ clock: true, routes: ['1'], override: async ({ route, url, endpoint }) => {
    if (endpoint !== 'route-vehicles') return false;
    positionCalls++;
    await route.fulfill(positionFails ? { status: 503 } : { json: emptyRouteVehicles(url) });
    return true;
  } });
  try {
    await openLayers(positions.page, 'bus');
    await positions.page.getByRole('button', { name: /^Retry vehicle positions 1$/ }).waitFor();
    await positions.page.clock.pauseAt(new Date(await positions.page.evaluate(() => Date.now()) + 100));
    positions.state.now = await positions.page.evaluate(() => Date.now());
    assert.equal(positionCalls, 1);
    await advance(positions, 36_000); assert.equal(positionCalls, 2);
    await advance(positions, 30_000); assert.equal(positionCalls, 2, 'failed route estimates wait through successful layer refreshes');
    await advance(positions, 36_000); assert.equal(positionCalls, 3);
    positionFails = false;
    const recovered = positions.page.waitForResponse(response => new URL(response.url()).pathname === '/api/route-vehicles' && response.status() === 200);
    await positions.page.getByRole('button', { name: /^Retry vehicle positions 1$/ }).click();
    await recovered; assert.equal(positionCalls, 4);
    await advance(positions, 36_000); assert.equal(positionCalls, 5);
    assert.deepEqual(positions.errors, []);
    console.log('PASS selected-route position backoff, explicit retry and restored healthy polling');
  } finally { await positions.context.close(); }

  const geometryRoutes = ['1'], geometryReads = new Map();
  const geometry = await start({ clock: true, routes: geometryRoutes, override: async ({ route, url, endpoint }) => {
    if (endpoint !== 'bus-route-paths') return false;
    const code = url.searchParams.get('route');
    geometryReads.set(code, (geometryReads.get(code) ?? 0) + 1);
    await route.fulfill({ status: 503 });
    return true;
  } });
  try {
    await openLayers(geometry.page, 'bus');
    await geometry.page.getByRole('button', { name: /^Retry route geometry 1$/ }).waitFor();
    await geometry.page.clock.pauseAt(new Date(await geometry.page.evaluate(() => Date.now()) + 100));
    geometry.state.now = await geometry.page.evaluate(() => Date.now());
    assert.equal(geometryReads.get('1'), 1);
    await advance(geometry, 31_000); assert.equal(geometryReads.get('1'), 1);
    const retried = geometry.page.waitForResponse(response => new URL(response.url()).pathname === '/api/bus-route-paths');
    await geometry.page.getByRole('button', { name: /^Retry route geometry 1$/ }).click();
    await retried; assert.equal(geometryReads.get('1'), 2);
    geometryRoutes.push('2');
    await advance(geometry, 36_000);
    assert.equal(geometryReads.get('1'), 2, 'one explicit retry must not enable retries on every later catalogue change');
    assert.equal(geometryReads.get('2'), 1, 'new routes still request their own geometry');
    assert.deepEqual(geometry.errors, []);
    console.log('PASS failed geometry remains cached after explicit retry and new route discovery');
  } finally { await geometry.context.close(); }
} finally { await browser.close(); }
