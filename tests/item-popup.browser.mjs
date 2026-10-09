// node tests/item-popup.browser.mjs [baseURL] [evidenceDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openLayers, openSearch, closeControls, reloadAll } from './browser-controls.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/item-popup');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const contexts = [], results = [];
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const tracking = { operator: 'kmb', company: 'KMB', route: '1', stopId: 'fixture', stopSeq: 1, bound: 'O', serviceType: '1' };

async function create({ viewport = { width: 1440, height: 1000 }, touch = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch });
  contexts.push(context);
  const observedAt = new Date().toISOString(), hk = new Date(Date.now() + 8 * 3600000).toISOString();
  const controls = { train: true, stale: false, worksStatus: 'In Progress' }, requests = [];
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => {
    const url = new URL(route.request().url()), headers = { 'access-control-allow-origin': '*' };
    if (/FeatureServer\/0\/query$/.test(url.pathname)) {
      if (url.searchParams.has('returnIdsOnly')) return route.fulfill({ headers, json: { objectIds: [1] } });
      if (url.searchParams.has('returnCountOnly')) return route.fulfill({ headers, json: { count: 1 } });
      const fields = { SITE_DESC_CHI: '完整資料測試', SITE_DESC_ENG: 'Complete fixture camera', RLC_ID: 'CAMERA-FIXTURE', REMARKS: 'Official fixture remarks remain available in full.', LAST_UPD_DATE: '2026-10-08' };
      return route.fulfill({ headers, json: { features: [{ attributes: { OBJECTID: 1, PopupInfo: `<table>${Object.entries(fields).map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`).join('')}</table>` }, geometry: { x: 113.951, y: 22.282 } }] } });
    }
    if (url.pathname.includes('Traffic_Camera_Locations_')) return route.fulfill({ headers, body: `<image-list>${[1, 2].map(index => `<image><key>${index}</key><description>${url.pathname.includes('_Tc') ? '快拍測試' : 'Snapshot fixture'} ${index}</description><district>Islands</district><region>New Territories</region><latitude>22.283</latitude><longitude>${113.951 + index * .001}</longitude><url>${origin}/fixture.jpg?camera=${index}</url></image>`).join('')}</image-list>` });
    if (/traffic_speed_volume_occ_info(?:-slp)?\.csv$/.test(url.pathname)) return route.fulfill({ headers, body: 'aid_id_number,latitude,longitude,road_tc,road_en\nfixture,22.282,113.951,測試道路,Fixture detector' });
    if (/rawSpeedVol(?:_SLP)?-all\.xml$/.test(url.pathname)) return route.fulfill({ headers, body: `<raw_speed_volume_list><date>${hk.slice(0, 10)}</date><periods><period><period_to>${hk.slice(11, 19)}</period_to><detectors><detector><detector_id>fixture</detector_id><lanes><lane><speed>20</speed><valid>Y</valid></lane></lanes></detector></detectors></period></periods></raw_speed_volume_list>` });
    if (url.pathname.endsWith('/irnAvgSpeed-all.xml')) return route.fulfill({ headers, body: `<segment_speed_list><date>${hk.slice(0, 10)}</date><time>${hk.slice(11, 19)}</time><segments><segment><segment_id>91001</segment_id><speed>20</speed><valid>Y</valid></segment></segments></segment_speed_list>` });
    if (url.pathname.endsWith('/speed_segments_info.csv')) return route.fulfill({ headers, body: 'irn_id,ucase(route)\n91001,1' });
    if (url.pathname.endsWith('/FeatureServer/10/query')) return route.fulfill({ headers, json: { features: [{ attributes: { ROUTE_ID: 91001, STREET_ENAME: 'Popup fixture road', STREET_CNAME: '彈出測試道路', TRAVEL_DIRECTION: 3 }, geometry: { paths: [[[113.948, 22.280], [113.956, 22.280]]] } }] } });
    if (url.pathname.endsWith('/FeatureServer/2/query')) return route.fulfill({ headers, json: { features: [{ attributes: { ROAD_ROUTE_ID: 91001, SPEED_LIMIT: '100' } }] } });
    return route.fulfill({ headers, status: 503, body: 'Unrelated fixture feed unavailable' });
  });
  await context.route('**/api/**', route => {
    const kind = new URL(route.request().url()).pathname.split('/')[2];
    const base = { ok: true, complete: true, observedAt, fetchedAt: observedAt, stale: controls.stale };
    if (kind === 'bus-route') {
      requests.push(route.request().url());
      const at = Date.now();
      return route.fulfill({ json: { ...base, route: { key: 'popup-route', operator: 'kmb', company: 'KMB', route: '1', geometry: 'road', coordinates: [[113.950, 22.282], [113.956, 22.282]], stops: [{ id: 'fixture', seq: 1, nameTc: '完整到站測試站', nameEn: 'Complete arrival fixture stop', lng: 113.950, lat: 22.282, distance: 0 }, { id: 'terminus', seq: 2, nameTc: '測試終點', nameEn: 'Fixture terminus', lng: 113.956, lat: 22.282, distance: 618 }] }, vehicle: { id: 'popup-bus', fromDistance: 0, toDistance: 618, departureAt: at, arrivalAt: at + 120000, validUntil: at + 180000 } } });
    }
    if (kind === 'kmb') return route.fulfill({ json: { ...base, stops: [{ id: 'fixture', nameTc: '完整到站測試站', nameEn: 'Complete arrival fixture stop', lng: 113.954, lat: 22.282, routes: ['1'], calls: Array.from({ length: 12 }, (_, index) => ({ route: String(index + 1), company: 'KMB', destTc: `終點 ${index + 1}`, destEn: `Full destination ${index + 1}`, minutes: index + 2, eta: new Date(Date.now() + (index + 2) * 60000).toISOString(), scheduled: index % 2 === 0, remarkTc: '所有備註', remarkEn: `Full remark ${index + 1}`, ...(index === 0 ? { tracking } : {}) })) }] } });
    if (kind === 'works') return route.fulfill({ json: { ...base, works: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'fixture', name: 'Works fixture', road: 'Full road name', place: 'Full working area', status: controls.worksStatus, lane: 'Full lane restrictions', start: '2026-10-01', end: '2026-10-20' }, geometry: { type: 'Point', coordinates: [113.950, 22.284] } }] } } });
    if (kind === 'mtr') return route.fulfill({ json: { ...base, boards: [{ line: 'TWL', station: 'ADM', observedAt, trains: [{ dest: 'TSW', plat: '1', ttnt: 4, timeType: 'A' }] }], trains: controls.train ? [{ id: 'popup-train', line: 'TWL', dest: 'TSW', plat: '1', ttnt: .4, observedAt, delay: false, timeType: 'A', anchor: 'ADM', path: ['CEN', 'ADM', 'TST', 'TSW'], hold: ['CEN', 'ADM', 'TST', 'TSW'] }] : [] } });
    return route.fulfill({ json: { ...base, boards: [], trains: [], stops: [], points: [], piers: [], vessels: [], warnings: [], works: { type: 'FeatureCollection', features: [] } } });
  });
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await context.route('**/fixture.jpg*', route => route.fulfill({ contentType: 'image/png', headers: { 'Last-Modified': new Date(Date.now() - 60000).toUTCString() }, body: pixel }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en'); localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = []; window.addEventListener('error', event => window.__errors.push(event.message));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
    let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.evaluate(() => { window.__map.setView([22.282, 113.951], 17, { animate: false }); });
  await openLayers(page);
  for (const kind of ['redlight', 'snapshot', 'kmb', 'works']) await page.locator(`.layer-card.${kind} [role="switch"]`).click();
  await page.locator('[data-marker-id="kmb-fixture"]').waitFor();
  await closeControls(page);
  return { page, context, controls, requests, observedAt };
}

async function select(page, id, touch = false) {
  const target = page.locator(`[data-marker-id="${id}"] .marker-inner`);
  if (touch) await target.tap(); else await target.click();
  await page.locator(`.item-popup-content[data-item-id="${id}"]`).waitFor();
  await page.locator(`.item-popup-content[data-item-id="${id}"] .item-detail-title`).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.item-popup').length === 1);
  await page.waitForFunction(() => !window.__map._panAnim?._inProgress && !window.__map._animatingZoom);
  assert.equal(await page.locator('.item-popup').count(), 1);
}

async function closePopup(page) {
  await page.locator('.item-popup .leaflet-popup-close-button').click();
  await page.locator('.item-popup').waitFor({ state: 'detached' });
}

async function assertBorder(page, id) {
  const colors = await page.evaluate(id => {
    const marker = document.querySelector(`[data-marker-id="${id}"]`) || document.querySelector('.vehicle-marker');
    const probe = document.createElement('span'); probe.style.color = getComputedStyle(marker.querySelector('.marker-inner') || marker.querySelector('.marker-displacement')).getPropertyValue('--marker-color').trim(); document.body.append(probe);
    const item = getComputedStyle(probe).color; probe.remove();
    return { item, border: getComputedStyle(document.querySelector('.item-popup .leaflet-popup-content-wrapper')).borderTopColor };
  }, id);
  assert.equal(colors.border, colors.item, 'Popup border matches the currently rendered item color');
}

async function test(name, run) {
  if (process.env.POPUP_TEST_FILTER && !new RegExp(process.env.POPUP_TEST_FILTER).test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await contexts.at(-1)?.pages()[0]?.screenshot({ path: path.join(evidence, `failure-${results.length}.png`) }).catch(() => {}); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Desktop: full field parity, colored border, replacement, internal scroll and explicit route tracking', async () => {
    const f = await create(), popup = f.page.locator('.item-popup');
    assert.equal(await f.page.locator('.sidebar, .mobile-scrim, .panel-reopen').count(), 0);
    await select(f.page, 'redlight-1');
    const text = await popup.innerText();
    for (const value of ['Complete fixture camera', 'CAMERA-FIXTURE', 'Coordinates', '22.282000, 113.951000', 'Record updated', 'Official remarks', 'Official fixture remarks remain available in full.', 'Official source']) assert.ok(text.includes(value), `Existing detail remains available: ${value}`);
    await assertBorder(f.page, 'redlight-1');
    await select(f.page, 'kmb-fixture');
    assert.equal(f.requests.length, 0, 'Clicking a stop alone does not begin tracking or fit a route');
    assert.equal(await popup.locator('.arrival-board li').count(), 12, 'Every current arrival is retained in the DOM');
    assert.ok((await popup.innerText()).includes('Full destination 12') && (await popup.innerText()).includes('Full remark 12'));
    const scroll = f.page.locator('.item-popup-content');
    assert.equal(await scroll.evaluate(element => element.scrollHeight > element.clientHeight), true);
    const center = await f.page.evaluate(() => window.__map.getCenter().toString());
    await scroll.hover(); await f.page.mouse.wheel(0, 450); await f.page.waitForTimeout(150);
    assert.ok(await scroll.evaluate(element => element.scrollTop > 0), 'Detail content scrolls independently');
    assert.equal(await f.page.evaluate(() => window.__map.getCenter().toString()), center, 'Scrolling details does not move the map');
    await popup.locator('.bus-route-button').first().click();
    await popup.waitFor({ state: 'detached' }); await f.page.locator('.bus-route-polyline').waitFor({ state: 'attached' });
    assert.ok(f.requests.length > 0);
    await openLayers(f.page); await f.page.locator('.layers-popover .bus-route-status').waitFor();
    assert.equal(await f.page.getByRole('button', { name: 'Close route', exact: true }).count(), 1, 'Active route remains manageable after popup dismissal');
    await closeControls(f.page);
    assert.equal(await f.page.locator('.bus-route-polyline').count(), 1);
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.page.screenshot({ path: path.join(evidence, 'desktop-route-preserved.png') });
    await f.context.close();
  });
  await test('Keyboard, Search and Intel selections use the same popup and dismiss cleanly', async () => {
    const f = await create(), marker = f.page.locator('[data-marker-id="redlight-1"]');
    await marker.focus(); await marker.press('Enter'); await f.page.locator('.item-popup').waitFor();
    await f.page.waitForFunction(() => document.querySelector('.item-popup-content')?.contains(document.activeElement));
    assert.equal(await f.page.locator('.item-popup-content').evaluate(element => element.contains(document.activeElement) || element === document.activeElement), true);
    await f.page.keyboard.press('Escape'); await f.page.locator('.item-popup').waitFor({ state: 'detached' });
    assert.equal(await marker.evaluate(element => document.activeElement === element), true);
    await marker.press('Enter'); await f.page.locator('.item-popup').waitFor();
    await f.page.locator('.item-popup .leaflet-popup-close-button').focus();
    await f.page.keyboard.press('Enter'); await f.page.locator('.item-popup').waitFor({ state: 'detached' });
    assert.equal(await marker.evaluate(element => document.activeElement === element), true, 'Keyboard close returns focus to the selected item');
    await openSearch(f.page);
    await f.page.locator('.search-popover').getByRole('button', { name: 'Other locations', exact: true }).click();
    await f.page.locator('.search-popover input').fill('Complete fixture camera');
    await f.page.locator('.search-popover').getByRole('button', { name: 'Locate Complete fixture camera, Red light on the map and open its details', exact: true }).click();
    await f.page.locator('.item-popup-content[data-item-id="redlight-1"]').waitFor();
    await f.page.locator('.search-popover').waitFor({ state: 'detached' });
    await closePopup(f.page);
    await f.page.locator('.intel-trigger').click();
    await f.page.locator('.intel-row button').filter({ hasText: 'Popup fixture road' }).first().click();
    await f.page.locator('.item-popup .item-detail-title').filter({ hasText: 'Popup fixture road' }).waitFor();
    assert.match(await f.page.locator('.item-popup').innerText(), /20km\/h/);
    assert.ok((await f.page.locator('.item-popup').innerText()).includes('100 km/h'));
    await f.page.locator('.map-canvas').click({ position: { x: 90, y: 450 } });
    await f.page.locator('.item-popup').waitFor({ state: 'detached' });
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.context.close();
  });
  await test('Snapshot hover stays available and is suppressed while full details are open', async () => {
    const f = await create();
    const first = f.page.locator('[data-marker-id="snapshot-1"] .marker-inner');
    const second = f.page.locator('[data-marker-id="snapshot-2"] .marker-inner');
    await first.hover(); await f.page.locator('.snapshot-hover img').waitFor();
    await f.page.locator('.snapshot-hover .refresh-image').click();
    assert.equal(await f.page.locator('.item-popup').count(), 0, 'Refreshing the preview does not select full details');
    await f.page.locator('.snapshot-hover img').click();
    await f.page.locator('.item-popup-content[data-item-id="snapshot-1"]').waitFor();
    await f.page.locator('.snapshot-hover').waitFor({ state: 'detached' });
    await f.page.locator('.item-popup img').waitFor();
    assert.ok((await f.page.locator('.item-popup').innerText()).includes('Image updated'));
    assert.equal(await f.page.locator('.item-popup .refresh-image').count(), 1);
    await second.hover(); await f.page.waitForTimeout(2300);
    assert.equal(await f.page.locator('.snapshot-hover').count(), 0);
    assert.equal(await f.page.locator('.item-popup').count(), 1);
    await closePopup(f.page); await second.hover(); await f.page.locator('.snapshot-hover img').waitFor();
    await f.page.keyboard.press('Escape');
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.context.close();
  });
  for (const [name, viewport, touch] of [['Desktop', { width: 1440, height: 1000 }, false], ['Mobile', { width: 375, height: 844 }, true], ['Landscape', { width: 844, height: 390 }, true]]) await test(`${name}: edge-aware compact card, tap/click, map pan, border updates and item leaving view`, async () => {
    const f = await create({ viewport, touch });
    for (const edge of ['left', 'right']) {
      await f.page.evaluate(({ edge, viewport }) => {
        const point = window.__map.latLngToContainerPoint([22.282, 113.954]);
        const y = viewport.height * (viewport.height < 520 && edge === 'right' ? .74 : .55);
        window.__map.panBy(point.subtract([edge === 'left' ? 28 : viewport.width - 28, y]), { animate: false });
      }, { edge, viewport });
      await select(f.page, 'kmb-fixture', touch);
      const geometry = await f.page.locator('.item-popup').evaluate(element => {
        const rect = element.getBoundingClientRect(), scroll = element.querySelector('.item-popup-content'), title = element.querySelector('.item-detail-title').getBoundingClientRect(), close = element.querySelector('.leaflet-popup-close-button').getBoundingClientRect();
        const coveredBy = [...document.querySelectorAll('.topbar,.traffic-info-toggle,.map-tools,.map-toolbar,.desktop-layer-dock,.mobile-dock,.layer-group-picker,.intel-shell')].filter(overlay => {
          const style = getComputedStyle(overlay), bounds = overlay.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0 && rect.left < bounds.right && rect.right > bounds.left && rect.top < bounds.bottom && rect.bottom > bounds.top;
        }).map(overlay => overlay.className);
        const nativeControlsObscure = [...document.querySelectorAll('.leaflet-control-attribution,.leaflet-control-scale')].filter(control => {
          const bounds = control.getBoundingClientRect();
          if (rect.left >= bounds.right || rect.right <= bounds.left || rect.top >= bounds.bottom || rect.bottom <= bounds.top) return false;
          const x = (Math.max(rect.left, bounds.left) + Math.min(rect.right, bounds.right)) / 2;
          const y = (Math.max(rect.top, bounds.top) + Math.min(rect.bottom, bounds.bottom)) / 2;
          return !document.elementFromPoint(x, y)?.closest('.item-popup');
        }).map(control => control.className);
        let popup; window.__map.eachLayer(layer => { if (layer.options?.className === 'item-popup') popup = layer; });
        const native = { paddingTopLeft: popup.options.autoPanPaddingTopLeft, paddingBottomRight: popup.options.autoPanPaddingBottomRight, offset: popup.options.offset, anchor: popup.getLatLng(), center: window.__map.getCenter() };
        const bounds = Object.fromEntries(['.item-popup-content','.mobile-dock','.topbar','.traffic-status','.map-canvas'].map(selector => [selector, document.querySelector(selector)?.getBoundingClientRect().toJSON()]));
        const nativeStack = [...document.querySelectorAll('.leaflet-map-pane,.leaflet-popup-pane,.leaflet-bottom')].map(node => ({ className: node.className, zIndex: getComputedStyle(node).zIndex, insideMap: Boolean(node.closest('.map-canvas')) }));
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, readingHeight: scroll.clientHeight, titleVisible: title.top >= rect.top && title.bottom <= rect.bottom, closeWidth: close.width, closeHeight: close.height, bodySize: parseFloat(getComputedStyle(element.querySelector('.arrival-destination')).fontSize), coveredBy, nativeControlsObscure, nativeStack, bounds, native, css: { height: element.style.getPropertyValue('--item-popup-max-height'), width: element.style.getPropertyValue('--item-popup-width') } };
      });
      await fs.writeFile(path.join(evidence, `${name.toLowerCase()}-${edge}-geometry.json`), JSON.stringify(geometry, null, 2));
      assert.ok(geometry.left >= -1 && geometry.right <= viewport.width + 1 && geometry.top >= -1 && geometry.bottom <= viewport.height + 1, JSON.stringify(geometry));
      assert.deepEqual(geometry.coveredBy, [], 'Item title and content stay clear of the status button and map controls');
      assert.deepEqual(geometry.nativeControlsObscure, [], 'Native map attribution and scale never cover detail text');
      const availableReadingHeight = viewport.height - geometry.native.paddingTopLeft.y - geometry.native.paddingBottomRight.y - 12;
      assert.ok(geometry.width <= 325 && geometry.readingHeight >= Math.min(140, availableReadingHeight), 'Popup retains readable space within the available viewport');
      assert.equal(geometry.titleVisible, true); assert.ok(geometry.closeWidth >= 43.9 && geometry.closeHeight >= 43.9); assert.ok(geometry.bodySize >= 14);
      await assertBorder(f.page, 'kmb-fixture');
      assert.equal(await f.page.locator('.map-area').getAttribute('inert'), null);
      const center = await f.page.evaluate(() => window.__map.getCenter().toString());
      await f.page.evaluate(() => { window.__map.panBy([8, 0], { animate: false }); });
      assert.notEqual(await f.page.evaluate(() => window.__map.getCenter().toString()), center);
      assert.equal(await f.page.locator('.item-popup').count(), 1, 'A small user pan retains the anchored card');
      await f.page.screenshot({ path: path.join(evidence, `${name.toLowerCase()}-${edge}.png`) });
      await closePopup(f.page);
      assert.equal(await f.page.locator('.leaflet-control-attribution a').first().evaluate(link => {
        const bounds = link.getBoundingClientRect();
        return Boolean(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.leaflet-control-attribution'));
      }), true, 'Map attribution links remain accessible after details close');
    }
    if (name === 'Mobile') {
      await f.page.evaluate(() => { window.__map.setView([22.282, 113.954], 17, { animate: false }); });
      await select(f.page, 'kmb-fixture', touch);
      await f.page.setViewportSize({ width: 844, height: 390 });
      await f.page.waitForFunction(() => window.__map.getSize().x === 844 && !window.__map._panAnim?._inProgress);
      assert.equal(await f.page.locator('.item-popup').count(), 1, 'A visible anchor retains its details when the phone rotates');
      const fitted = await f.page.locator('.item-popup').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const covered = [...document.querySelectorAll('.topbar,.traffic-info-toggle,.mobile-dock,.layer-group-picker,.intel-shell')].some(overlay => {
          const style = getComputedStyle(overlay), bounds = overlay.getBoundingClientRect();
          return style.display !== 'none' && bounds.width > 0 && rect.left < bounds.right && rect.right > bounds.left && rect.top < bounds.bottom && rect.bottom > bounds.top;
        });
        return { inView: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, covered };
      });
      assert.deepEqual(fitted, { inView: true, covered: false }, 'Rotated details fit without covering fixed controls');
      await f.page.screenshot({ path: path.join(evidence, 'mobile-rotated.png') });
      await closePopup(f.page); await f.page.setViewportSize(viewport);
      await f.page.waitForFunction(() => window.__map.getSize().x === 375);
    }
    await f.page.evaluate(() => { window.__map.setView([22.284, 113.950], 17, { animate: false }); });
    await select(f.page, 'works-fixture', touch); await assertBorder(f.page, 'works-fixture');
    f.controls.worksStatus = 'Preparation'; await reloadAll(f.page);
    await f.page.locator('.item-popup').getByText('Preparation', { exact: true }).waitFor();
    await f.page.waitForFunction(() => getComputedStyle(document.querySelector('.item-popup .leaflet-popup-content-wrapper')).borderTopColor === 'rgb(212, 155, 37)');
    await assertBorder(f.page, 'works-fixture');
    f.controls.stale = true; await reloadAll(f.page);
    await f.page.locator('.item-popup .warning-text').waitFor();
    await f.page.waitForFunction(() => getComputedStyle(document.querySelector('.item-popup .leaflet-popup-content-wrapper')).borderTopColor === 'rgb(138, 154, 165)');
    await assertBorder(f.page, 'works-fixture');
    await f.page.evaluate(() => { window.__map.panBy([2000, 0], { animate: false }); });
    await f.page.locator('.item-popup').waitFor({ state: 'detached' });
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.context.close();
  });
  await test('Moving train popup follows the marker without moving the map and closes when the train disappears', async () => {
    const f = await create();
    await f.page.locator('.vehicle-marker').waitFor();
    await f.page.evaluate(() => { let train; window.__map.eachLayer(layer => { if (layer.getElement?.()?.classList.contains('vehicle-marker')) train = layer; }); window.__map.setView(train.getLatLng(), 16, { animate: false }); });
    const target = await f.page.locator('.vehicle-marker').boundingBox();
    await f.page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    await f.page.locator('.item-popup').waitFor();
    await f.page.waitForFunction(() => !window.__map._panAnim?._inProgress && !window.__map._animatingZoom);
    await assertBorder(f.page, 'mtr-train-popup-train');
    const center = await f.page.evaluate(() => window.__map.getCenter().toString());
    const sample = () => f.page.evaluate(() => {
      let train, popup; window.__map.eachLayer(layer => { if (layer.getElement?.()?.classList.contains('vehicle-marker')) train = layer; if (layer.options?.className === 'item-popup') popup = layer; });
      return { vehicle: [train.getLatLng().lat, train.getLatLng().lng], distance: window.__map.latLngToContainerPoint(train.getLatLng()).distanceTo(window.__map.latLngToContainerPoint(popup.getLatLng())) };
    });
    const before = await sample(); await f.page.waitForTimeout(200); const after = await sample();
    assert.notDeepEqual(after.vehicle, before.vehicle, `Selected vehicle must continue moving, elapsed since feed: ${Date.now() - Date.parse(f.observedAt)}ms; ${JSON.stringify({ before, after })}`); assert.ok(after.distance < 1);
    assert.equal(await f.page.evaluate(() => window.__map.getCenter().toString()), center, 'Vehicle movement never chases the camera');
    f.controls.train = false; await reloadAll(f.page);
    await f.page.locator('.item-popup').waitFor({ state: 'detached' });
    assert.deepEqual(await f.page.evaluate(() => window.__errors), []);
    await f.context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser.close();
  await fs.writeFile(path.join(evidence, 'item-popup-results.json'), JSON.stringify({ origin, results }, null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
