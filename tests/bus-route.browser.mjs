// Run with a dev server: node tests/bus-route.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package/file URL; uses an existing Chrome installation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openLayers, closeControls, reloadAll } from './browser-controls.mjs';
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
const routeStops = [0, 3, 5].map((index, seq) => ({ id: `RSTOP${seq}`, seq: seq + 1, nameTc: ['測試起點（上層乘車位置）', '測試完整長名稱轉乘車站', '測試車站3'][seq], nameEn: ['Fixture origin, Upper boarding area', 'Fixture interchange with a complete long stop name', 'Fixture terminus'][seq], lng: coordinates[index][0], lat: coordinates[index][1], distance: distance[index] }));
const operatorColors = { kmb: 'rgb(163, 62, 31)', citybus: 'rgb(194, 138, 11)', gmb: 'rgb(47, 143, 91)', nlb: 'rgb(59, 110, 165)' };
function response(selection, mode = 'live', correction = 0) {
  const now = Date.now();
  const key = JSON.stringify(selection);
  return { ok: true, observedAt: new Date(now).toISOString(), stale: mode === 'stale', route: { key, operator: selection.operator, company: selection.company, route: selection.route, geometry: mode === 'approximate' ? 'stops' : 'road', coordinates, stops: routeStops }, vehicle: ['empty', 'stale', 'approximate'].includes(mode) ? null : { id: key, fromDistance: 0, toDistance: distance[3], departureAt: now - 60000 - correction, arrivalAt: now + 120000 - correction, validUntil: now + 180000 } };
}
async function create({ mobile = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion, hasTouch: mobile });
  contexts.push(context);
  const requests = [], arrivalRequests = [], controls = { mode: 'live', correction: 0, delay: 0, arrivalDelay: 0, arrivalMode: 'live' };
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split('/')[2];
    if (kind === 'bus-route') {
      const selection = Object.fromEntries(url.searchParams);
      if (selection.stopArrivals === '1') {
        delete selection.stopArrivals;
        arrivalRequests.push(selection);
        const payload = { ok: controls.arrivalMode !== 'error', observedAt: new Date().toISOString(), stale: controls.arrivalMode === 'stale', arrivals: controls.arrivalMode === 'empty' ? [] : [{ route: selection.route, destination: `${selection.operator}全路線車站到站資訊`, destinationEn: `Off-map ${selection.operator} arrival at ${selection.stopId}`, minutes: 2, eta: new Date(Date.now() + 120000).toISOString(), scheduled: false }], ...(controls.arrivalMode === 'error' ? { error: 'Fixture arrivals unavailable' } : {}) };
        if (controls.arrivalDelay) await new Promise(resolve => setTimeout(resolve, controls.arrivalDelay));
        return route.fulfill({ json: payload }).catch(() => {});
      }
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
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  await openLayers(page);
  for (const kind of ['kmb', 'citybus', 'gmb', 'nlb']) await page.locator(`.layer-card.${kind} [role="switch"]`).click();
  await closeControls(page);
  await page.locator('.camera-marker[title$="kmb fixture stop"]').waitFor();
  return { context, page, controls, requests, arrivalRequests, mobile };
}
async function select(fixture, variant) {
  const { page } = fixture;
  await closeControls(page);
  await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  if (await page.locator('.map-canvas.route-focus').count()) await page.locator('.map-canvas').click({ position: { x: 30, y: 150 } });
  await page.locator(`.camera-marker[title$="${variant.operator} fixture stop"] .marker-displacement`).click();
  const button = page.locator(`.item-popup .bus-route-button[aria-label^="Show route ${variant.route} ·"]`).first();
  await page.evaluate(() => { window.__busRouteFitComplete = false; window.__map.once('zoomend', () => { window.__busRouteFitComplete = true; }); });
  await button.click();
  await page.locator('.bus-route-polyline').waitFor();
  await page.waitForFunction(() => window.__busRouteFitComplete);
}
async function samples(page, count = 14) {
  return page.evaluate(count => new Promise(resolve => { const frames = []; function frame() { const e = document.querySelector('.bus-route-marker'); frames.push(e?.style.transform); if (frames.length >= count) resolve(frames); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }), count);
}
async function refresh(page) {
  await reloadAll(page);
}
async function closeStopPopup(page) {
  await page.waitForFunction(() => document.querySelectorAll('.item-popup').length === 1);
  await page.locator('.item-popup .leaflet-popup-close-button').click();
  await page.locator('.item-popup').waitFor({ state: 'detached' });
}
async function assertRouteLabels(page, operator, language = 'en', checkViewport = true) {
  const labels = page.locator('.bus-route-stop-label');
  await page.waitForFunction(count => document.querySelectorAll('.bus-route-stop-label').length === count, routeStops.length);
  assert.deepEqual(await labels.allTextContents(), routeStops.map(stop => language === 'en' ? stop.nameEn : stop.nameTc), 'Every selected-route stop keeps its complete name in the app language');
  const rendered = await labels.evaluateAll(elements => {
    const overlays = [...document.querySelectorAll('.topbar,.map-tools,.map-toolbar,.traffic-status,.mobile-dock,.desktop-layer-dock,.layer-group-picker,.intel-shell')].filter(element => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0; });
    return elements.map(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      const coveredBy = overlays.filter(overlay => { const area = overlay.getBoundingClientRect(); return rect.left < area.right && rect.right > area.left && rect.top < area.bottom && rect.bottom > area.top; }).map(overlay => overlay.className);
      return { name: element.textContent, color: style.borderTopColor, width: style.borderTopWidth, labelWidth: rect.width, labelHeight: rect.height, visible: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0, inViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1, coveredBy, reachable: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('.bus-route-stop-label') === element };
    });
  });
  for (const label of rendered) {
    assert.equal(label.color, operatorColors[operator], 'Stop label border matches the bus operator');
    assert.equal(label.width, '1px', 'Stop label border remains thin');
    assert.ok(label.labelWidth >= 40 && label.labelHeight <= 72, `Full stop names use compact readable lines: ${label.name}`);
    assert.equal(label.visible, true, 'Full-route stop names remain visible');
    if (checkViewport) {
      assert.equal(label.inViewport, true, `Full-route label fits inside the screen: ${label.name}`);
      assert.deepEqual(label.coveredBy, [], `Full-route label clears header and map controls: ${label.name}`);
      assert.equal(label.reachable, true, `Full-route label center is directly tap reachable: ${label.name}`);
    }
  }
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
      const artwork = await f.page.locator('.bus-route-marker').evaluate(element => {
        const image = element.querySelector('.vehicle-art'), target = element.getBoundingClientRect(), art = image.getBoundingClientRect();
        return {
          src: image.getAttribute('src'), heading: element.querySelector('.vehicle-heading').style.transform,
          running: element.classList.contains('is-running'), size: [target.width, target.height], art: [image.clientWidth, image.clientHeight],
          centered: Math.max(Math.abs(art.x + art.width / 2 - target.x - target.width / 2), Math.abs(art.y + art.height / 2 - target.y - target.height / 2)),
          gap: target.top - element.querySelector('.vehicle-dest').getBoundingClientRect().bottom,
          animations: element.getAnimations({ subtree: true }).map(animation => animation.playState),
          destination: element.querySelector('.vehicle-dest')?.textContent.trim(),
          borderColor: getComputedStyle(element.querySelector('.vehicle-dest')).borderTopColor, borderWidth: getComputedStyle(element.querySelector('.vehicle-dest')).borderTopWidth,
      }; });
      assert.match(artwork.src, new RegExp(`bus-${variant.company === 'LWB' ? 'lwb' : variant.operator}`), 'Bus miniature matches its actual operator');
      assert.match(artwork.heading, /^rotate\(-?[\d.]+deg\)$/, 'Bearing rotates the inner wrapper');
      assert.deepEqual(artwork.size, [24, 24]); assert.deepEqual(artwork.art, [24, 24]); assert.equal(artwork.running, false);
      assert.ok(artwork.centered < .01 && Math.abs(artwork.gap - 6) < .01, 'Bus artwork stays centered with label clearance');
      assert.equal(artwork.animations.length, 0, 'The estimated bus miniature stays static; only its position moves');
      assert.equal(artwork.destination, `${variant.route} → Fixture terminus`, 'The bus labels where it is heading');
      assert.equal(artwork.borderColor, operatorColors[variant.operator], 'Moving bus label border matches its operator');
      assert.equal(artwork.borderWidth, '1px');
      await assertRouteLabels(f.page, variant.operator);
      assert.ok(await f.page.locator('.bus-stop-marker').count() > 0);
      assert.equal(await f.page.locator('.bus-stop-marker').evaluateAll(elements => elements.every(element => getComputedStyle(element).display === 'none')), true, 'Route focus hides nearby ordinary bus stops while full-route names remain visible');
      const geometry = await f.page.evaluate(() => { let points; window.__map.eachLayer(layer => { if (layer.options?.className === 'bus-route-polyline') points = layer.getLatLngs().map(p => [p.lng, p.lat]); }); return { points, bounds: window.__map.getBounds().toBBoxString() }; });
      assert.deepEqual(geometry.points, coordinates, 'Route includes road bends between the three stops');
      const [west, south, east, north] = geometry.bounds.split(',').map(Number);
      for (const [lng, lat] of coordinates) assert.ok(lng >= west && lng <= east && lat >= south && lat <= north, 'Whole route must fit');
      const motion = await samples(f.page);
      assert.ok(new Set(motion).size >= 10, `${variant.operator} ${variant.route} moves continuously: ${new Set(motion).size} positions; ${await f.page.locator('.map-canvas').getAttribute('class')}`);
      assert.equal(await f.page.locator(`.camera-marker[data-marker-id="${variant.operator}-RSTOP1"]`).count(), 0, 'Full-route stop is absent from the nearby stop catalogue');
      await f.page.evaluate(() => { window.__originalBus = document.querySelector('.bus-route-marker'); });
      await f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP1"]').click();
      await f.page.locator('.item-popup .arrival-destination').filter({ hasText: `Off-map ${variant.operator} arrival at RSTOP1` }).waitFor();
      assert.equal(await f.page.locator('.item-detail-title').textContent(), routeStops[1].nameEn);
      assert.deepEqual(f.arrivalRequests.at(-1), { ...Object.fromEntries(Object.entries(variant).map(([key, value]) => [key, String(value)])), stopId: 'RSTOP1', stopSeq: '2' }, 'Clicked-stop arrivals preserve route, operator, direction, company and service variant');
      assert.equal(await f.page.evaluate(() => window.__originalBus === document.querySelector('.bus-route-marker')), true, 'Opening stop arrivals keeps the selected route and estimated bus');
      assert.equal(await f.page.locator('.item-popup .arrival-route').textContent(), variant.route);
      await closeStopPopup(f.page);
    }
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.page.screenshot({ path: path.join(evidence, 'desktop-route.png') });
    await f.context.close();
  });
  await test('Full-route stop names follow app language and keyboard opens exact arrivals', async () => {
    const f = await create(); await select(f, variants[0]);
    const terminus = f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP2"]');
    await terminus.focus(); await terminus.press('Enter');
    await f.page.locator('.item-popup .arrival-destination').filter({ hasText: 'Off-map kmb arrival at RSTOP2' }).waitFor();
    assert.equal(await f.page.locator('.item-detail-title').textContent(), routeStops[2].nameEn);
    assert.equal(f.arrivalRequests.at(-1).stopSeq, '3');
    await closeStopPopup(f.page);
    const first = f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP0"]');
    await first.focus(); await first.press('Space');
    await f.page.locator('.item-popup .arrival-destination').filter({ hasText: 'Off-map kmb arrival at RSTOP0' }).waitFor();
    assert.equal(await f.page.locator('.item-detail-title').textContent(), routeStops[0].nameEn);
    await closeStopPopup(f.page);
    await f.page.locator('.language-toggle button').nth(1).click();
    await f.page.waitForFunction(name => document.querySelector('.bus-route-stop-label')?.textContent === name, routeStops[0].nameTc);
    await assertRouteLabels(f.page, 'kmb', 'zh', false);
    await f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP1"]').click();
    await f.page.locator('.item-popup .arrival-destination').filter({ hasText: 'kmb全路線車站到站資訊' }).waitFor();
    assert.equal(await f.page.locator('.item-detail-title').textContent(), routeStops[1].nameTc);
    assert.equal(f.requests.at(-1).stopId, 'KMB1', 'Opening route-stop arrivals leaves the original selected stop unchanged');
    assert.equal(await f.page.locator('.bus-route-polyline').count(), 1);
    assert.ok(new Set(await samples(f.page)).size >= 10, 'Estimated next-bus motion continues while arrivals are displayed');
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.context.close();
  });
  await test('Exact stop-arrival requests ignore replaced or closed popups and distinguish empty from unavailable', async () => {
    const f = await create(); await select(f, variants[0]);
    f.controls.arrivalDelay = 400;
    await f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP0"]').click();
    await f.page.locator('.item-detail-status[role="status"]').waitFor();
    f.controls.arrivalDelay = 0;
    const middle = f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP1"]');
    await middle.focus(); await middle.press('Enter');
    await f.page.locator('.item-popup .arrival-destination').filter({ hasText: 'Off-map kmb arrival at RSTOP1' }).waitFor();
    await f.page.waitForTimeout(500);
    assert.equal(await f.page.locator('.item-detail-title').textContent(), routeStops[1].nameEn);
    assert.ok((await f.page.locator('.item-popup .arrival-destination').textContent()).includes('RSTOP1'), 'Older stop response cannot replace newer popup data');
    await closeStopPopup(f.page);
    f.controls.arrivalDelay = 400;
    await f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP2"]').click();
    await f.page.locator('.item-detail-status[role="status"]').waitFor();
    await closeStopPopup(f.page);
    await f.page.waitForTimeout(500);
    assert.equal(await f.page.locator('.item-popup').count(), 0, 'A delayed response cannot reopen a closed popup');
    f.controls.arrivalDelay = 0;
    for (const mode of ['error', 'stale']) {
      f.controls.arrivalMode = mode;
      await middle.click();
      await f.page.locator('.item-detail-status[role="alert"]').waitFor();
      assert.equal(await f.page.locator('.item-popup .arrival-destination').count(), 0, 'Unavailable arrivals must not be presented as fresh');
      assert.equal(await f.page.locator('.item-popup').getByText('No upcoming arrivals reported.', { exact: true }).count(), 0, 'Failure is distinct from an empty live result');
      await closeStopPopup(f.page);
    }
    f.controls.arrivalMode = 'empty'; await middle.click();
    await f.page.locator('.item-popup').getByText('No upcoming arrivals reported.', { exact: true }).waitFor();
    assert.equal(await f.page.locator('.item-detail-status[role="alert"]').count(), 0);
    assert.equal(await f.page.locator('.bus-route-polyline').count(), 1);
    assert.equal(f.requests.at(-1).stopId, 'KMB1');
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
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
    await assertRouteLabels(f.page, 'kmb', 'en', false);
    await openLayers(f.page);
    await f.page.getByRole('button', { name: 'Close route', exact: true }).click();
    await f.page.locator('.bus-route-polyline').waitFor({ state: 'detached' });
    await f.page.waitForFunction(() => document.querySelectorAll('.bus-route-stop-label').length === 0);
    assert.equal(await f.page.locator('.bus-route-stop-label').count(), 0, 'Closing the route removes its stop labels');
    await f.context.close();
  });
  await test('Missing position and unavailable road geometry remain explicit without invented movement', async () => {
    const f = await create(); f.controls.mode = 'approximate'; await select(f, variants[2]);
    assert.equal(await f.page.locator('.bus-route-marker').count(), 0);
    await openLayers(f.page);
    await f.page.getByText('Route connects published stops; road geometry is unavailable.', { exact: true }).waitFor();
    await f.page.getByText('No current position estimate available.', { exact: true }).waitFor();
    await f.context.close();
  });
  await test('Reduced motion, hidden documents, selection cleanup and layer disable', async () => {
    const f = await create({ reducedMotion: 'reduce' }); await select(f, variants[0]); await f.page.locator('.bus-route-marker').waitFor();
    assert.equal(new Set(await samples(f.page)).size, 1, 'Reduced motion keeps a static location');
    await f.page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.ok(new Set(await samples(f.page)).size >= 10);
    await f.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(new Set(await samples(f.page)).size, 1);
    await f.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await openLayers(f.page);
    await f.page.locator('.layer-card.kmb [role="switch"]').click();
    await f.page.locator('.bus-route-marker').waitFor({ state: 'detached' });
    await f.page.locator('.bus-route-polyline').waitFor({ state: 'detached' });
    await f.page.locator('.layer-card.kmb [role="switch"]').click();
    f.controls.delay = 700;
    await closeControls(f.page);
    await f.page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
    await f.page.locator('.camera-marker[title$="kmb fixture stop"] .marker-displacement').click();
    await f.page.locator('.bus-route-button').first().click();
    await openLayers(f.page);
    await f.page.getByRole('button', { name: 'Close route', exact: true }).click();
    await f.page.waitForTimeout(900);
    assert.equal(await f.page.locator('.bus-route-polyline, .bus-route-marker, .bus-route-stop-label').count(), 0, 'Cancelled selection cannot revive route or labels after response');
    await f.context.close();
  });
  await test('Mobile selection reveals map, fits full route and keeps route controls accessible', async () => {
    const f = await create({ mobile: true }); await select(f, variants[3]); await f.page.locator('.bus-route-marker').waitFor();
    assert.equal(await f.page.locator('.map-area').getAttribute('inert'), null, 'Route selection must reveal active map on mobile');
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(new Set(await samples(f.page)).size >= 10);
    const fit = await f.page.evaluate(points => points.every(([lng, lat]) => window.__map.getBounds().contains([lat, lng])), coordinates);
    assert.equal(fit, true);
    await assertRouteLabels(f.page, 'gmb');
    await f.page.locator('.bus-route-stop-label[data-stop-id="RSTOP1"]').tap();
    await f.page.locator('.item-popup .arrival-destination').filter({ hasText: 'Off-map gmb arrival at RSTOP1' }).waitFor();
    assert.equal(await f.page.locator('.item-detail-title').textContent(), routeStops[1].nameEn);
    assert.equal(await f.page.locator('.map-area').getAttribute('inert'), null, 'Tapping a route-stop name keeps the mobile map usable');
    assert.equal(await f.page.locator('.bus-route-polyline').count(), 1);
    await closeStopPopup(f.page);
    await f.page.screenshot({ path: path.join(evidence, 'mobile-route.png') });
    await f.context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close();
  await fs.writeFile(path.join(evidence, 'bus-route-results.json'), JSON.stringify({ origin, results, fixture: 'Deterministic local feed and route API responses; production normalization, manual refresh, route projection, Leaflet rendering and interactions.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length }));
if (results.some(r => !r.ok)) process.exitCode = 1;



