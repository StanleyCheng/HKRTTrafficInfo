// node tests/map-markers.browser.mjs [baseURL] [evidenceDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/vehicle-icons');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const results = [], contexts = [];
const center = [22.282, 113.951];
const imagePixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const network = JSON.parse(await fs.readFile(new URL('../data/mtr-network.json', import.meta.url), 'utf8'));
const lrt = JSON.parse(await fs.readFile(new URL('../data/light-rail-stations.json', import.meta.url), 'utf8'));
const featureCollection = (kind, extra = {}) => ({ type: 'FeatureCollection', features: [1, 2].map(index => ({ type: 'Feature', properties: { id: `${kind}-${index}`, code: `${kind}-${index}`, name: `${kind} fixture ${index}`, ...extra }, geometry: { type: 'Point', coordinates: [113.943 + index * .006, 22.280] } })) });
async function create(mobile = false, parking = [{ vacancy: 10, space: 100 }, { vacancy: 0 }]) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  const observedAt = new Date().toISOString(), localTime = new Date(Date.now() + 8 * 3600000).toISOString();
  const date = localTime.slice(0, 10), time = localTime.slice(11, 19), headers = { 'access-control-allow-origin': '*' };
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => {
    const url = new URL(route.request().url());
    if (/FeatureServer\/0\/query$/.test(url.pathname)) {
      const kind = url.pathname.includes('1671693287017') ? 'redlight' : 'speed';
      const count = kind === 'redlight' ? 3 : 2;
      if (url.searchParams.has('returnIdsOnly')) return route.fulfill({ headers, json: { objectIds: Array.from({ length: count }, (_, i) => i + 1) } });
      if (url.searchParams.has('returnCountOnly')) return route.fulfill({ headers, json: { count } });
      return route.fulfill({ headers, json: { features: Array.from({ length: count }, (_, i) => ({ attributes: { OBJECTID: i + 1, PopupInfo: `<table><tr><th>SITE_DESC_CHI</th><td>${kind} fixture ${i + 1}</td></tr><tr><th>SITE_DESC_ENG</th><td>${kind} fixture ${i + 1}</td></tr></table>` }, geometry: { x: kind === 'redlight' ? 113.951 : 113.943 + i * .006, y: kind === 'redlight' ? 22.282 : 22.285 } })) } });
    }
    if (url.pathname.includes('Traffic_Camera_Locations_')) return route.fulfill({ headers, body: `<image-list>${[1, 2].map(index => `<image><key>${index}</key><description>${url.pathname.includes('_Tc') ? '快拍測試' : 'snapshot fixture'} ${index}</description><latitude>22.288</latitude><longitude>${113.943 + index * .006}</longitude><url>${origin}/fixture.jpg?camera=${index}</url></image>`).join('')}</image-list>` });
    if (url.pathname.endsWith('/carpark-info-vacancy')) return route.fulfill({ headers, json: { results: parking.map((counts, index) => ({ park_Id: String(index + 1), name: `parking fixture ${index + 1}`, latitude: 22.292, longitude: 113.943 + (index + 1) * .006, privateCar: url.searchParams.get('data') === 'info' ? { space: counts.space } : [{ vacancy_type: counts.type ?? 'A', vacancy: counts.vacancy }] })) } });
    if (url.searchParams.get('dataType') === 'rhrread') return route.fulfill({ headers, json: { rainfall: { data: [{ place: 'Islands District', max: 2 }, { place: 'Central & Western District', max: 3 }], endTime: observedAt } } });
    if (url.pathname.endsWith('/specialtrafficnews.xml')) return route.fulfill({ headers, body: `<body><message><msgID>1</msgID><ChinText>測試道路事故</ChinText><EngText>Fixture Road collision</EngText></message><message><msgID>2</msgID><ChinText>第二測試道路事故</ChinText><EngText>Other Road collision</EngText></message></body>` });
    if (url.hostname === 'www.als.gov.hk') return route.fulfill({ headers, json: { SuggestedAddress: [{ ValidationInformation: { Score: 100 }, Address: { PremisesAddress: { GeospatialInformation: { Latitude: '22.296', Longitude: url.searchParams.get('q') === 'Fixture Road' ? '113.949' : '113.955' } } } }] } });
    if (/traffic_speed_volume_occ_info(?:-slp)?\.csv$/.test(url.pathname)) return route.fulfill({ headers, body: 'aid_id_number,latitude,longitude,road_tc,road_en\nfixture,22.300,113.950,測試道路,Fixture detector' });
    if (/rawSpeedVol(?:_SLP)?-all\.xml$/.test(url.pathname)) return route.fulfill({ headers, body: `<raw_speed_volume_list><date>${date}</date><periods><period><period_to>${time}</period_to><detectors><detector><detector_id>fixture</detector_id><lanes><lane><speed>20</speed><valid>Y</valid></lane></lanes></detector></detectors></period></periods></raw_speed_volume_list>` });
    if (url.pathname.endsWith('/irnAvgSpeed-all.xml')) return route.fulfill({ headers, body: `<segment_speed_list><date>${date}</date><time>${time}</time><segments><segment><segment_id>91001</segment_id><speed>20</speed><valid>Y</valid></segment></segments></segment_speed_list>` });
    if (url.pathname.endsWith('/speed_segments_info.csv')) return route.fulfill({ headers, body: 'irn_id,ucase(route)\n91001,1' });
    if (url.pathname.endsWith('/FeatureServer/10/query')) return route.fulfill({ headers, json: { features: [{ attributes: { ROUTE_ID: 91001, STREET_ENAME: 'Fixture road', STREET_CNAME: '測試道路', TRAVEL_DIRECTION: 3 }, geometry: { paths: [[[113.943, 22.3], [113.957, 22.3]]] } }] } });
    if (url.pathname.endsWith('/FeatureServer/2/query')) return route.fulfill({ headers, json: { features: [{ attributes: { ROAD_ROUTE_ID: 91001, SPEED_LIMIT: '100' } }] } });
    return route.fulfill({ headers, status: 503, body: 'Unexpected source in fixture' });
  });
  await context.route('**/api/**', route => {
    const kind = new URL(route.request().url()).pathname.split('/')[2], base = { ok: true, observedAt, fetchedAt: observedAt };
    if (['kmb', 'citybus', 'gmb', 'nlb'].includes(kind)) return route.fulfill({ json: { ...base, stops: [1, 2].map(index => ({ id: `${kind}-${index}`, nameTc: `${kind} fixture ${index}`, nameEn: `${kind} fixture ${index}`, lng: 113.943 + index * .006, lat: 22.274 + ['kmb', 'citybus', 'gmb', 'nlb'].indexOf(kind) * .002, routes: ['1'], calls: [] })) } });
    if (kind === 'mtr' || kind === 'lrt') return route.fulfill({ json: { ...base, boards: [], trains: [] } });
    if (kind === 'works') return route.fulfill({ json: { ...base, works: featureCollection('works', { status: 'In Progress' }) } });
    if (kind === 'tolls') {
      const tolls = featureCollection('toll'); tolls.features[0].properties.band = 'overview'; tolls.features[1].properties.band = 'portal';
      return route.fulfill({ json: { ...base, tolls } });
    }
    if (kind === 'control-points') return route.fulfill({ json: { ...base, points: featureCollection('boundary', { worst: 0 }) } });
    if (kind === 'approaches') return route.fulfill({ json: { ...base, capturedAt: observedAt, points: [1, 2].map(index => ({ id: String(index), name: `crossing fixture ${index}`, nameTc: `crossing fixture ${index}`, coordinates: [113.943 + index * .006, 22.304], legs: [] })) } });
    if (kind === 'warnings') return route.fulfill({ json: { ...base, warnings: [], conditions: [] } });
    if (kind === 'ferry') return route.fulfill({ json: { ...base, piers: [1, 2].map(index => ({ id: String(index), nameTc: `ferry fixture ${index}`, nameEn: `ferry fixture ${index}`, lng: 113.943 + index * .006, lat: 22.310, calls: [] })), vessels: [] } });
    return route.fulfill({ json: base });
  });
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: imagePixel }));
  await context.route('**/fixture.jpg*', route => route.fulfill({ contentType: 'image/png', body: imagePixel }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en'); localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = []; window.addEventListener('error', event => window.__errors.push(event.message));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition() {} } });
    let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.evaluate(center => { window.__map.setView(center, 17, { animate: false }); }, center);
  if (mobile) await page.locator('.mobile-panel-button').click();
  for (const toggle of await page.locator('.layer-card .layer-toggle').all()) if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.layer-card')].every(card => !card.querySelector('.spin')));
  const detectors = page.getByRole('switch', { name: 'Show detector locations', exact: true });
  await detectors.waitFor(); if (await detectors.getAttribute('aria-checked') !== 'true') await detectors.click();
  if (mobile) { await page.locator('.mobile-panel-close').click(); await page.locator('.sidebar').waitFor({ state: 'hidden' }); }
  return { context, page };
}
async function hoverMarker(page, marker) {
  const box = await marker.locator('.marker-inner').boundingBox();
  assert.ok(box, 'Marker must be visible before hover');
  await page.mouse.move(50, 20);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-marker-id]')?.getAttribute('data-marker-id'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  assert.equal(hit, await marker.getAttribute('data-marker-id'), 'Hover must reach the visible marker');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
async function counts(page) {
  return page.evaluate(() => { const counts = {}; window.__map.eachLayer(layer => { if (layer.options?.cameraKind && layer.getElement?.()?.classList.contains('camera-marker')) counts[layer.options.cameraKind] = (counts[layer.options.cameraKind] || 0) + 1; }); return counts; });
}
async function test(name, run) {
  if (process.env.MARKER_TEST_FILTER && !new RegExp(process.env.MARKER_TEST_FILTER).test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}
try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Snapshot delayed hover loads photo and official update time only after dwell, and cancels on exit', async () => {
    const { page, context } = await create();
    let requests = 0; const imageRequests = [];
    const modified = new Date(Date.now() - 20 * 60000).toUTCString();
    await context.route('**/fixture.jpg*', route => { requests++; imageRequests.push(route.request().url()); return route.fulfill({ contentType: 'image/png', headers: { 'Last-Modified': modified }, body: imagePixel }); });
    await page.evaluate(() => { window.__map.setView([22.288, 113.949], 16, { animate: false }); });
    const marker = page.locator('[data-marker-id="snapshot-1"]'), card = page.locator('.snapshot-hover');
    assert.equal(await marker.getAttribute('title'), null, 'Rich hover replaces the browser title');
    await hoverMarker(page, marker);
    await page.getByRole('tooltip', { name: 'snapshot fixture 1', exact: true }).waitFor();
    await page.waitForTimeout(600);
    assert.equal(requests, 0); assert.equal(await card.count(), 0);
    await page.mouse.move(50, 20);
    await page.waitForTimeout(1600);
    assert.equal(requests, 0); assert.equal(await card.count(), 0, 'Leaving before dwell cancels pending hover');
    await hoverMarker(page, marker);
    await page.waitForTimeout(1600);
    assert.equal(requests, 0); assert.equal(await card.count(), 0, 'The delayed photo does not load early');
    await card.waitFor();
    await card.locator('img').waitFor();
    assert.ok(requests >= 1); assert.ok(imageRequests.every(url => url.endsWith('camera=1')), 'Only the hovered photo is fetched');
    const loadedRequests = requests;
    assert.equal(await card.locator('.snapshot-hover-name').textContent(), 'snapshot fixture 1');
    const update = await card.locator('.image-update').textContent();
    assert.match(update, /^Image updated /);
    const expected = await page.evaluate(value => new Intl.DateTimeFormat('en-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)), modified);
    assert.ok(update.includes(expected), 'Date and time are the official Last-Modified in Hong Kong time');
    assert.match(await card.locator('.snapshot-note').textContent(), /see the image for its capture time/);
    assert.equal(await card.locator('img').evaluate(image => getComputedStyle(image).objectFit), 'contain', 'Full image retains the stamped capture time');
    await card.hover(); await page.waitForTimeout(400);
    assert.equal(await card.count(), 1, 'Pointer can enter and inspect the rich card');
    const unrelatedLayer = page.locator('.layer-card.rainfall .layer-toggle');
    await unrelatedLayer.evaluate(button => button.click());
    assert.equal(await card.count(), 1, 'Unrelated feed/layer updates retain the hovered snapshot');
    await unrelatedLayer.evaluate(button => button.click());
    await card.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.snapshot-hover .refresh-image')?.disabled);
    assert.equal(requests, loadedRequests + 1, 'Refresh remains usable inside hover');
    await page.screenshot({ path: path.join(evidence, 'snapshot-hover-en.png') });
    await page.keyboard.press('Escape'); await card.waitFor({ state: 'detached' });
    await page.keyboard.press('Tab'); await marker.focus(); await card.waitFor();
    assert.equal(await card.evaluate(element => document.activeElement === element), true, 'Keyboard focus opens an accessible card');
    await page.keyboard.press('Escape'); await card.waitFor({ state: 'detached' });
    assert.equal(await marker.evaluate(element => document.activeElement === element), true, 'Escape restores the marker tab position');
    await page.locator('.map-tools button').first().focus();
    await hoverMarker(page, marker); await card.waitFor();
    await page.evaluate(() => { window.__map.panBy([20, 0], { animate: false }); });
    await card.waitFor({ state: 'detached' });
    await hoverMarker(page, marker); await card.waitFor();
    await page.mouse.move(50, 20); await card.waitFor({ state: 'detached' });
    for (const edge of ['right', 'left']) {
      await page.evaluate(edge => {
        const m = window.__map, point = m.latLngToContainerPoint([22.288, 113.949]);
        const area = document.querySelector('.map-canvas').getBoundingClientRect(), sidebar = document.querySelector('.sidebar').getBoundingClientRect();
        m.panBy(point.subtract([edge === 'right' ? m.getSize().x - 100 : Math.max(0, sidebar.right - area.left) + 60, 180]), { animate: false });
      }, edge);
    await hoverMarker(page, marker); await card.waitFor(); await card.locator('img').waitFor();
    await card.locator('.warning-text').waitFor(); await page.waitForTimeout(100);
    const contained = await card.evaluate(element => {
      const card = element.closest('.leaflet-popup').getBoundingClientRect(), map = document.querySelector('.map-canvas').getBoundingClientRect();
      return card.left >= Math.max(map.left, document.querySelector('.sidebar').getBoundingClientRect().right) && card.top >= Math.max(map.top, document.querySelector('.topbar').getBoundingClientRect().bottom, document.querySelector('.traffic-status').getBoundingClientRect().bottom) && card.right <= Math.min(map.right, document.querySelector('.map-tools').getBoundingClientRect().left) && card.bottom <= map.bottom;
    });
    assert.equal(contained, true, 'Near-edge popup remains inside the map without panning');
    await page.screenshot({ path: path.join(evidence, `snapshot-hover-${edge}-edge.png`) });
    await page.keyboard.press('Escape');
    }
    await hoverMarker(page, marker); await card.waitFor();
    await page.getByRole('button', { name: 'Chinese', exact: true }).click();
    await card.waitFor({ state: 'detached' });
    await hoverMarker(page, marker); await card.waitFor();
    await card.locator('img').waitFor();
    assert.equal(await card.locator('.snapshot-hover-name').textContent(), '快拍測試 1');
    assert.match(await card.locator('.image-update').textContent(), /^影像更新 /);
    assert.match(await card.locator('.snapshot-note').textContent(), /拍攝時間以圖中標示為準/);
    assert.equal(await page.locator('[data-marker-id="parking-1"]').getAttribute('title'), '10 個空位 / 共 100 個私家車車位');
    await page.screenshot({ path: path.join(evidence, 'snapshot-hover-zh.png') });
    await page.keyboard.press('Escape');
    await marker.focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { level: 4, name: '快拍測試 1', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await context.close();
  });
  await test('Snapshot hover retains missing-time and retry states and closes when its layer is removed', async () => {
    const { page, context } = await create();
    let failure = false, requests = 0;
    await context.route('**/fixture.jpg*', route => { requests++; return route.fulfill(failure ? { status: 503, body: 'Unavailable' } : { contentType: 'image/png', body: imagePixel }); });
    await page.evaluate(() => { window.__map.setView([22.288, 113.949], 16, { animate: false }); });
    const marker = page.locator('[data-marker-id="snapshot-1"]'), card = page.locator('.snapshot-hover');
    await hoverMarker(page, marker); await card.waitFor(); await card.locator('img').waitFor();
    assert.equal(await card.locator('.image-update').textContent(), 'The source did not provide an image update time');
    await page.keyboard.press('Escape'); failure = true;
    await page.mouse.move(50, 20); await hoverMarker(page, marker); await card.waitFor();
    await card.getByRole('alert').waitFor();
    assert.equal(await card.locator('img').count(), 0, 'Failed source never appears as a loaded snapshot');
    const failedRequests = requests;
    await card.hover(); failure = false;
    await card.getByRole('button', { name: 'Reload snapshot', exact: true }).click();
    await card.locator('img').waitFor(); assert.equal(requests, failedRequests + 1);
    const retriedRequests = requests;
    const toggle = page.locator('.layer-card.snapshot .layer-toggle');
    await toggle.click(); await card.waitFor({ state: 'detached' });
    assert.equal(await marker.count(), 0);
    await toggle.click(); await marker.waitFor();
    await hoverMarker(page, marker); await page.waitForTimeout(500);
    await toggle.click(); await page.waitForTimeout(1700);
    assert.equal(requests, retriedRequests, 'Removing the layer cancels a pending photo request');
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await context.close();
  });
  await test('Snapshot hover fits a narrow mobile map and closes when the layers panel opens', async () => {
    const { page, context } = await create(true);
    await page.setViewportSize({ width: 375, height: 844 });
    await page.evaluate(() => { window.__map.setView([22.288, 113.949], 16, { animate: false }); });
    const marker = page.locator('[data-marker-id="snapshot-1"]'), card = page.locator('.snapshot-hover');
    await hoverMarker(page, marker); await card.waitFor(); await card.locator('img').waitFor();
    await page.waitForTimeout(100);
    assert.equal(await card.evaluate(element => {
      const card = element.closest('.leaflet-popup').getBoundingClientRect(), map = document.querySelector('.map-canvas').getBoundingClientRect(), tools = document.querySelector('.map-tools').getBoundingClientRect();
      return card.left >= map.left && card.right <= tools.left && card.bottom <= map.bottom;
    }), true, 'Full photo fits the actual 375px map space clear of controls');
    await page.screenshot({ path: path.join(evidence, 'snapshot-hover-mobile-375.png') });
    await page.locator('.mobile-panel-button').click(); await card.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await context.close();
  });
  await test('Parking hover preserves location and shows bilingual vacancy / total counts in the native title', async () => {
    const { page, context } = await create(false, [{ vacancy: 10, space: 100 }, { vacancy: 0, space: 0 }, { vacancy: 4 }, { space: 80 }, { vacancy: 1, space: 20, type: 'B' }, { vacancy: 0, space: 30, type: 'C' }]);
    await page.evaluate(() => { window.__map.setView([22.292, 113.964], 15, { animate: false }); });
    const expected = ['10 available / 100 total private car spaces', '0 available / 0 total private car spaces', '4 available / — total private car spaces', '— available / 80 total private car spaces', '— available / 20 total private car spaces', '— available / 30 total private car spaces'];
    for (const [index, title] of expected.entries()) {
      const marker = page.locator(`[data-marker-id="parking-${index + 1}"]`);
      await marker.waitFor();
      assert.equal(await marker.getAttribute('title'), title);
      assert.equal(await marker.getAttribute('aria-label'), `parking fixture ${index + 1}`);
    }
    await page.locator('[data-marker-id="parking-1"] .marker-inner').hover();
    await page.getByRole('tooltip', { name: 'parking fixture 1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Chinese', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'zh-HK');
    assert.equal(await page.locator('[data-marker-id="parking-1"]').getAttribute('title'), '10 個空位 / 共 100 個私家車車位');
    assert.equal(await page.locator('[data-marker-id="parking-2"]').getAttribute('title'), '0 個空位 / 共 0 個私家車車位');
    await page.locator('[data-marker-id="parking-1"] .marker-inner').hover();
    await page.getByRole('tooltip', { name: 'parking fixture 1', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await context.close();
  });
  await test('All point layers retain individual source records across zoom and language changes', async () => {
    const { page, context } = await create();
    const expected = { redlight: 3, speed: 2, snapshot: 2, parking: 2, rainfall: 2, incident: 2, crossing: 2, works: 2, toll: 2, boundary: 2, mtr: Object.keys(network.stations).length, lrt: lrt.stations.length, kmb: 2, citybus: 2, gmb: 2, nlb: 2, ferry: 2 };
    const actual = await counts(page);
    for (const [kind, count] of Object.entries(expected)) assert.equal(actual[kind], count, `${kind} must show every source record individually`);
    assert.ok(actual.flow >= 1, 'Flow detector marker remains individual alongside road geometry');
    await page.evaluate(() => { window.__originalStatic = [...document.querySelectorAll('.camera-marker:not(.vehicle-marker)')].filter(element => /redlight fixture/.test(element.title)); });
    for (const zoom of [10, 13, 17]) {
      await page.evaluate(({ center, zoom }) => { window.__map.setView(center, zoom, { animate: false }); }, { center, zoom });
      await page.waitForTimeout(200);
      const zoomCounts = await counts(page);
      for (const kind of ['redlight', 'speed', 'snapshot', 'parking', 'rainfall', 'incident', 'crossing', 'works', 'toll', 'boundary', 'mtr', 'lrt', 'ferry']) assert.equal(zoomCounts[kind], expected[kind], `${kind} source count at zoom ${zoom}`);
      assert.equal(await page.locator('.camera-cluster, .marker-cluster').count(), 0, 'No count clusters on any layer or zoom');
    }
    assert.equal(await page.evaluate(() => window.__originalStatic.every(element => element.isConnected)), true, 'Viewport changes retain existing static marker DOM');
    await page.getByRole('button', { name: 'Chinese', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'zh-HK');
    assert.equal((await counts(page)).redlight, 3);
    await page.evaluate(() => { window.__map.panBy([50, 30], { animate: false }); });
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await page.screenshot({ path: path.join(evidence, 'all-layers-individual.png') });
    await context.close();
  });
  for (const mobile of [false, true]) await test(`${mobile ? 'Mobile' : 'Desktop'}: colocated records keep geographic anchors and independent bounded click targets`, async () => {
    const { page, context } = await create(mobile);
    const targets = page.locator('.camera-marker[title*="redlight fixture"]');
    assert.equal(await targets.count(), 3);
    const layout = await targets.evaluateAll(elements => elements.map(element => {
      let anchor; window.__map.eachLayer(layer => { if (layer.getElement?.() === element) anchor = layer.getLatLng(); });
      const body = element.querySelector('.marker-displacement'), displacement = new DOMMatrix(getComputedStyle(body).transform);
      const rect = element.querySelector('.marker-inner').getBoundingClientRect();
      return { anchor: { lat: anchor.lat, lng: anchor.lng }, x: displacement.m41, y: displacement.m42, center: [rect.x + rect.width / 2, rect.y + rect.height / 2] };
    }));
    assert.ok(layout.every(marker => marker.anchor.lat === center[0] && marker.anchor.lng === center[1]), 'Display displacement never changes source coordinates');
    assert.equal(new Set(layout.map(marker => JSON.stringify(marker.center))).size, 3, 'Three colocated records each have their own visible center');
    assert.ok(layout.every(marker => Math.max(Math.abs(marker.x), Math.abs(marker.y)) <= 34.01), 'Display displacements stay within 34px on each axis');
    await page.evaluate(() => { window.__colocated = [...document.querySelectorAll('.camera-marker[title*="redlight fixture"]')]; });
    for (let index = 0; index < 3; index++) {
      const point = layout[index].center; await page.mouse.click(point[0], point[1]);
      await page.getByRole('heading', { level: 4, name: `redlight fixture ${index + 1}`, exact: true }).waitFor();
      if (mobile) { await page.locator('.mobile-panel-close').click(); await page.locator('.sidebar').waitFor({ state: 'hidden' }); }
    }
    await page.evaluate(() => { window.__map.panBy([12, 8], { animate: false }); });
    assert.equal(await page.evaluate(() => window.__colocated.every(element => element.isConnected)), true);
    const offsets = await targets.evaluateAll(elements => elements.map(element => { const matrix = new DOMMatrix(getComputedStyle(element.querySelector('.marker-displacement')).transform); return [matrix.m41, matrix.m42]; }));
    assert.deepEqual(offsets, layout.map(marker => [marker.x, marker.y]), 'Small viewport pan preserves stable display offsets');
    await page.screenshot({ path: path.join(evidence, mobile ? 'mobile-colocated.png' : 'desktop-colocated.png') });
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await context.close();
  });
  await test('Every generated vehicle variant loads in the browser', async () => {
    const files = (await fs.readdir(new URL('../public/vehicles/', import.meta.url))).filter(file => file.endsWith('.webp')).sort();
    assert.ok(files.length >= 17, 'All requested fleet/operator variants must exist');
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route(`${origin}/__vehicle_gallery`, route => route.fulfill({ contentType: 'text/html', body: `<style>body{font:14px system-ui;background:#e8f0ec}main{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}figure{margin:0;text-align:center;background:white;padding:8px;border-radius:8px}img{width:120px;height:120px;object-fit:contain;background:repeating-conic-gradient(#e5e8e6 0% 25%,white 0% 50%) 0/16px 16px}</style><main>${files.map(file => `<figure><img src="${origin}/vehicles/${file}" alt=""><figcaption>${file.replace('.webp', '')}</figcaption></figure>`).join('')}</main>` }));
    await page.goto(`${origin}/__vehicle_gallery`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator('img').count(), files.length);
    await page.screenshot({ path: path.join(evidence, 'generated-vehicle-gallery.png'), fullPage: true });
    await page.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser.close();
  await fs.writeFile(path.join(evidence, 'map-markers-results.json'), JSON.stringify({ origin, results, fixture: 'Deterministic official source feeds; production adapters and Leaflet rendering. Asset gallery requests actual served generated files.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length }));
if (results.some(result => !result.ok)) process.exitCode = 1;
