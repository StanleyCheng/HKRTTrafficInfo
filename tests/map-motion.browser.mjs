// With a dev server: node tests/map-motion.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package name or file URL; PLAYWRIGHT_CHANNEL defaults to chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openLayers, closeControls, reloadAll } from './browser-controls.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/map-motion');
const filter = process.env.MOTION_TEST_FILTER ? new RegExp(process.env.MOTION_TEST_FILTER) : null;
const results = [];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const roads = [
  { id: 91001, name: 'Slow fixture road', speed: 20, valid: 'Y', lat: 22.283 },
  { id: 91002, name: 'Fast fixture road', speed: 80, valid: 'Y', lat: 22.284, direction: 2 },
  { id: 91003, name: 'Stopped fixture road', speed: 0, valid: 'Y', lat: 22.285 },
  { id: 91004, name: 'Unknown fixture road', speed: 80, valid: 'N', lat: 22.286 },
  { id: 91005, name: 'Another slow fixture road', speed: 20, valid: 'Y', lat: 22.2835 },
];
const contexts = [];

async function create({ mobile = false, reducedMotion = 'no-preference', gps = false, deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion, deviceScaleFactor, hasTouch: mobile });
  contexts.push(context);
  const observedAt = new Date().toISOString();
  const hk = new Date(Date.now() + 8 * 3600000).toISOString();
  const date = hk.slice(0, 10), time = hk.slice(11, 19);
  let mtrCalls = 0;
  let gpsUpdated = false;
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*' };
    let body;
    if (url.pathname.endsWith('/traffic_speed_volume_occ_info.csv')) body = 'aid_id_number,latitude,longitude,road_tc,road_en\nfixture,22.283,114.16,測試道路,Fixture road';
    else if (url.pathname.endsWith('/rawSpeedVol-all.xml')) body = `<raw_speed_volume_list><date>${date}</date><periods><period><period_to>${time}</period_to><detectors><detector><detector_id>fixture</detector_id><lanes><lane><speed>20</speed><valid>Y</valid></lane></lanes></detector></detectors></period></periods></raw_speed_volume_list>`;
    else if (url.pathname.endsWith('/irnAvgSpeed-all.xml')) body = `<segment_speed_list><date>${date}</date><time>${time}</time><segments>${roads.map(road => `<segment><segment_id>${road.id}</segment_id><speed>${road.speed}</speed><valid>${road.valid}</valid></segment>`).join('')}</segments></segment_speed_list>`;
    else if (url.pathname.endsWith('/speed_segments_info.csv')) body = 'irn_id,ucase(route)\n' + roads.map(road => `${road.id},1`).join('\n');
    else if (url.pathname.endsWith('/FeatureServer/10/query')) return route.fulfill({ headers, json: { features: roads.map(road => ({ attributes: { ROUTE_ID: road.id, STREET_ENAME: road.name, STREET_CNAME: road.name, TRAVEL_DIRECTION: road.direction ?? 3 }, geometry: { paths: [[[114.153, road.lat], [114.16, road.lat], [114.166, road.lat + .0001]]] } })) } });
    else if (url.pathname.endsWith('/FeatureServer/2/query')) return route.fulfill({ headers, json: { features: roads.map(road => ({ attributes: { ROAD_ROUTE_ID: road.id, SPEED_LIMIT: '100' } })) } });
    return route.fulfill(body ? { headers, body } : { headers, status: 503, body: 'Unrelated feed unavailable in fixture' });
  });
  await context.route('**/api/mtr**', route => {
    mtrCalls++;
    return route.fulfill({ json: { ok: true, observedAt, fetchedAt: new Date().toISOString(), boards: [], trains: [{ id: 'motion-mtr', line: 'TWL', dest: 'TSW', plat: '1', ttnt: .4, observedAt, delay: false, timeType: 'A', anchor: 'ADM', path: ['CEN', 'ADM', 'TST', 'TSW'], hold: ['CEN', 'ADM', 'TST', 'TSW'] }] } });
  });
  await context.route('**/api/lrt**', route => route.fulfill({ json: { ok: true, observedAt, boards: [], trains: [{ id: 'motion-lrt', line: '614P', dest: '100', plat: '1', ttnt: .3, observedAt, delay: false, timeType: 'A', anchor: '240', path: ['1', '240', '250', '100'], hold: ['1', '240', '250', '100'] }] } }));
  await context.route('**/api/ferry**', route => {
    const vessels = [{ id: 'motion-ferry', nameTc: '測試渡輪', nameEn: 'Fixture ferry', lng: 114.163, lat: 22.291, route: '天星', fix: 'clock', eta: new Date(Date.parse(observedAt) + 180000).toISOString(), minutes: 3, departAt: Date.parse(observedAt) - 30000, arriveAt: Date.parse(observedAt) + 180000, pathLng: [114.159, 114.166], pathLat: [22.287, 22.296] }];
    if (gps) vessels.push({ id: 'motion-gps', nameTc: '定位渡輪', nameEn: 'GPS fixture ferry', lng: gpsUpdated ? 114.163 : 114.161, lat: 22.292, route: '天星', fix: 'gps', eta: '', minutes: 3 });
    return route.fulfill({ json: { ok: true, observedAt, piers: [], vessels } });
  });
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64') }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en');
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = [];
    window.addEventListener('error', event => window.__errors.push(event.message));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) {
      leaflet = value;
      value.Map.addInitHook(function() { window.__map = this; });
    } });
  });
  const page = await context.newPage();
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.vehicle-marker').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await openLayers(page);
  for (const kind of ['lrt', 'ferry']) await page.locator(`.layer-card.${kind} [role="switch"]`).click();
  await closeControls(page);
  await page.waitForFunction(count => document.querySelectorAll('.vehicle-marker').length === count, gps ? 4 : 3);
  await page.evaluate(() => { window.__map.setView([22.286, 114.159], 16, { animate: false }); });
  await page.waitForFunction(() => { let count = 0; window.__map.eachLayer(layer => { if (layer.options?.className === 'segment-polyline') count++; }); return count === 5; });
  return { context, page, mtrCalls: () => mtrCalls, confirmGps: () => { gpsUpdated = true; } };
}

async function frameSamples(page, frames = 14) {
  return page.evaluate(frames => new Promise(resolve => {
    const samples = [];
    function sample() {
      samples.push([...document.querySelectorAll('.vehicle-marker')].map(element => {
        return element.style.transform;
      }));
      if (samples.length === frames) resolve(samples); else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }), frames);
}
async function dotStyles(page) {
  return page.evaluate(() => {
    const result = [];
    window.__map.eachLayer(layer => {
      if (!layer.options?.className?.includes('segment-speed-dots')) return;
      const element = layer.getElement(), style = getComputedStyle(element);
      const points = layer.getLatLngs(), first = Array.isArray(points[0]) ? points[0][0] : points[0];
      result.push({ lat: first.lat, width: parseFloat(style.strokeWidth), color: style.stroke, cap: style.strokeLinecap, dash: style.strokeDasharray, duration: parseFloat(style.animationDuration), direction: style.animationDirection, state: style.animationPlayState, offset: parseFloat(style.strokeDashoffset), subpaths: (element.getAttribute('d').match(/M/g) || []).length });
    });
    return result.sort((a, b) => a.lat - b.lat);
  });
}
async function vehicleMotion(page) {
  return page.locator('.vehicle-marker').evaluateAll(elements => elements.map(element => ({
    title: element.title, running: element.classList.contains('is-running'),
    animations: element.getAnimations({ subtree: true }).map(animation => animation.playState),
  })));
}
async function test(name, run) {
  if (filter && !filter.test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Desktop: loaded vehicle images, continuous fractional movement and stable marker identity on feed/language changes', async () => {
    const { page, context, mtrCalls } = await create();
    await page.waitForFunction(() => [...document.querySelectorAll('.vehicle-art')].every(image => image.complete && image.naturalWidth > 0));
    const sizes = await page.locator('.vehicle-marker').evaluateAll(elements => elements.map(element => {
      const image = element.querySelector('.vehicle-art'), target = element.getBoundingClientRect();
      return { loaded: image?.complete && image.naturalWidth > 0, target: target.width, tabindex: element.tabIndex };
    }));
    for (const size of sizes) {
      assert.equal(size.loaded, true, 'Generated vehicle artwork must load');
      assert.ok(Math.abs(size.target - 16) < .01 && size.tabindex === 0, 'Vehicle retains its 16px pointer bounds and keyboard focus');
    }
    const samples = await frameSamples(page);
    for (let index = 0; index < 3; index++) assert.ok(new Set(samples.map(sample => sample[index])).size >= 10, `Vehicle ${index} must move visibly on at least 10 of 14 frames`);
    assert.ok((await vehicleMotion(page)).every(vehicle => !vehicle.running && vehicle.animations.length === 0), 'Vehicle miniatures stay static; only their positions move');
    assert.ok((await page.locator('.vehicle-marker .vehicle-dest').evaluateAll(elements => elements.map(element => element.textContent.trim()))).every(text => text.length > 0), 'Every vehicle carries a destination label');
    await page.evaluate(() => { window.__originalVehicles = [...document.querySelectorAll('.vehicle-marker')]; });
    const calls = mtrCalls();
    await page.getByRole('button', { name: 'Chinese', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'zh-HK');
    await page.waitForFunction(() => window.__originalVehicles.every(element => element.isConnected));
    await page.waitForTimeout(16000);
    assert.equal(mtrCalls(), calls, 'Language changes and elapsed time must not refresh retained transit feeds');
    const response = page.waitForResponse(response => response.url().includes('/api/mtr') && response.ok());
    await reloadAll(page);
    await response;
    assert.equal(mtrCalls(), calls + 1, 'Manual refresh reloads the MTR feed');
    const identity = await page.evaluate(() => window.__originalVehicles.map(element => ({ name: element.title, connected: element.isConnected })));
    assert.ok(identity.every(element => element.connected), `Feed and language changes must preserve marker DOM identity: ${JSON.stringify(identity)}`);
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await page.screenshot({ path: path.join(evidence, 'desktop-motion.png') });
    await context.close();
  });
  await test('Vehicle images: distinct MTR/LRT/ferry artwork, compact station dots with rounded name pills and keyboard targets', async () => {
    const { page, context } = await create({ reducedMotion: 'reduce', deviceScaleFactor: 3 });
    const stations = await page.locator('.rail-marker.station-marker').evaluateAll(elements => elements.map(element => {
      const dot = element.querySelector('.marker-inner'), pill = element.querySelector('.station-label');
      return { border: getComputedStyle(dot).borderColor, width: getComputedStyle(dot).width, label: pill?.textContent.trim() ?? '', radius: pill ? getComputedStyle(pill).borderRadius : '', background: pill?.style.background ?? '' };
    }));
    assert.ok(stations.length, 'Fixture includes rail stations');
    assert.ok(stations.every(marker => marker.border === 'rgb(255, 255, 255)' && marker.width === '14px' && marker.label.length > 0 && marker.radius === '999px' && marker.background !== ''), 'Rail stations use compact white-ringed dots with rounded line-coloured name pills');
    const vehicles = page.locator('.vehicle-marker');
    await page.waitForFunction(() => [...document.querySelectorAll('.vehicle-art')].every(image => image.complete && image.naturalWidth > 0));
    const artwork = await vehicles.evaluateAll(elements => elements.map(element => ({
      src: element.querySelector('.vehicle-art').getAttribute('src'), ferry: element.classList.contains('ferry-marker'), role: element.getAttribute('role'),
      tabindex: element.tabIndex, label: element.getAttribute('aria-label'), title: element.title,
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
    })));
    assert.equal(new Set(artwork.map(vehicle => vehicle.src)).size, 3, 'MTR, LRT and ferry use distinct generated miniatures');
    for (const vehicle of artwork) {
      assert.equal(vehicle.role, 'button'); assert.equal(vehicle.tabindex, 0);
      assert.equal(vehicle.label, vehicle.ferry ? `${vehicle.title} · Estimated position · timetable / arrival data` : vehicle.title); assert.ok(vehicle.label);
      assert.equal(vehicle.width, 16); assert.equal(vehicle.height, 16);
    }
    for (let index = 0; index < 3; index++) {
      await page.evaluate(index => { const target = [...document.querySelectorAll('.vehicle-marker')][index]; window.__map.eachLayer(layer => { if (layer.getElement?.() === target) window.__map.setView(layer.getLatLng(), 16, { animate: false }); }); }, index);
      await vehicles.nth(index).focus();
      assert.equal(await vehicles.nth(index).evaluate(element => document.activeElement === element), true);
      await vehicles.nth(index).press('Enter');
      await page.locator('.arrival-board').waitFor();
      assert.match(await page.locator('.arrival-board').innerText(), [/TWL/, /614P/, /Fixture/][index], 'Keyboard activation selects corresponding vehicle details');
      await page.keyboard.press('Escape');
      await vehicles.nth(index).evaluate(element => element.blur());
      await page.mouse.move(0, 0);
      await page.locator('.leaflet-tooltip').waitFor({ state: 'hidden' });
      const target = await vehicles.nth(index).boundingBox();
      await page.screenshot({ path: path.join(evidence, ['mtr-image.png', 'lrt-image.png', 'ferry-image.png'][index]), clip: { x: target.x - 80, y: target.y - 55, width: 192, height: 142 } });
    }
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    await context.close();
  });
  await test('Road dots: half as many marks, diameter matches road width, movement is another 0.7x, zero stays still and unknown has no dots', async () => {
    const { page, context } = await create();
    const dots = await dotStyles(page);
    assert.equal(dots.length, 3, 'Known speeds share three animation paths; zero remains visible and unknown has no dots');
    for (const dot of dots) {
      assert.equal(dot.width, 4.8, 'Dot diameter equals the default colored road width');
      assert.equal(dot.color, 'rgb(255, 255, 255)');
      assert.equal(dot.cap, 'round');
      assert.match(dot.dash, /^0(?:px)?[, ]+72(?:px)?$/, '72px spacing halves the current 36px dot density');
    }
    assert.ok(Math.abs(dots[0].duration / dots[1].duration - 4) < .1, '80 km/h dots must move four times as fast as 20 km/h dots');
    assert.ok(Math.abs(dots[0].duration - 144 / (20 * .49)) < .0001, '20 km/h dots use a 14.693878s cycle');
    assert.ok(Math.abs(dots[1].duration - 144 / (80 * .49)) < .0001, '80 km/h dots use a 3.673469s cycle');
    for (const [index, speed] of [[0, 20], [1, 80]]) assert.ok(Math.abs((72 / dots[index].duration) / (18 / (36 / speed)) - .49) < .00001, 'Another 0.7x slowdown gives 0.49x original dot velocity');
    assert.equal(dots[0].subpaths, 2, 'Equal speed roads share one SVG path with two disconnected subpaths');
    assert.equal(dots[0].direction, 'normal', 'Direction code 3 follows the geometry');
    assert.equal(dots[1].direction, 'reverse', 'Direction code 2 runs against the geometry');
    const stopped = dots[2].offset;
    await page.waitForTimeout(250);
    assert.equal((await dotStyles(page))[2].offset, stopped, 'Zero-speed dots must not imply movement');
    const click = await page.evaluate(() => { const point = window.__map.latLngToContainerPoint([22.283, 114.16]), rect = document.querySelector('.leaflet-container').getBoundingClientRect(); return { x: rect.x + point.x, y: rect.y + point.y }; });
    await page.mouse.click(click.x, click.y);
    await page.getByRole('heading', { name: 'Slow fixture road', exact: true, level: 2 }).waitFor();
    assert.equal(await page.locator('.live-figure strong').innerText(), '20km/h', 'Dots must preserve segment click details');
    const selectedRoadWidth = await page.evaluate(() => { let width; window.__map.eachLayer(layer => { if (layer.options?.className === 'segment-polyline' && layer.getLatLngs()[0].lat === 22.283) width = layer.options.weight; }); return width; });
    assert.equal(selectedRoadWidth, 7.2, 'Real segment click widens the selected colored road');
    const selectedDots = await dotStyles(page);
    assert.equal(selectedDots.length, 4, 'Selecting one road splits its equal-speed batch by width');
    assert.equal(selectedDots.find(dot => dot.lat === 22.283)?.width, selectedRoadWidth, 'Selected dot diameter matches the selected 7.2px road');
    assert.ok(selectedDots.filter(dot => dot.lat !== 22.283).every(dot => dot.width === 4.8), 'Unselected dot diameters stay matched to 4.8px roads');
    await context.close();
  });
  await test('Reduced motion and hidden document stop animation; becoming visible resumes continuous positions', async () => {
    const { page, context } = await create({ reducedMotion: 'reduce' });
    const still = await frameSamples(page);
    assert.equal(new Set(still.map(sample => JSON.stringify(sample))).size, 1, 'Reduced motion disables continuous movement');
    assert.ok((await vehicleMotion(page)).every(vehicle => !vehicle.animations.includes('running')), 'Reduced motion stops miniature animation');
    assert.ok((await dotStyles(page)).every(dot => dot.state === 'paused' || dot.duration === 0), 'Reduced motion disables dot animation');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(80);
    assert.ok(new Set((await frameSamples(page)).map(sample => sample[0])).size >= 10, 'Live media preference change must restore movement');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = await frameSamples(page);
    assert.equal(new Set(hidden.map(sample => JSON.stringify(sample))).size, 1, 'Hidden document must stop marker work');
    assert.ok((await vehicleMotion(page)).every(vehicle => !vehicle.animations.includes('running')), 'Hidden document stops miniature animation');
    assert.ok((await dotStyles(page)).every(dot => dot.state === 'paused' || dot.duration === 0), 'Hidden document must pause dots');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.ok(new Set((await frameSamples(page)).map(sample => sample[0])).size >= 10, 'Visibility restoration resumes movement');
    await context.close();
  });
  await test('GPS ferry: confirmed feed correction is continuous, reaches the fix and stops without inventing motion', async () => {
    const { page, context, confirmGps } = await create({ gps: true });
    const position = () => page.evaluate(() => { let point; window.__map.eachLayer(layer => { if (layer.options?.icon?.options?.className?.includes('vehicle-marker') && layer.getElement()?.title === 'GPS fixture ferry') point = layer.getLatLng().lng; }); return point; });
    assert.equal(await position(), 114.161);
    confirmGps();
    const response = page.waitForResponse(response => response.url().includes('/api/ferry') && response.ok());
    await reloadAll(page);
    await response;
    await page.waitForFunction(() => { let moving = false; window.__map.eachLayer(layer => { if (layer.options?.icon?.options?.className?.includes('vehicle-marker') && layer.getElement()?.title === 'GPS fixture ferry') moving = layer.getLatLng().lng > 114.161; }); return moving; });
    const correcting = await position();
    assert.ok(correcting > 114.161 && correcting < 114.163, 'Fresh fix is approached smoothly rather than snapped');
    await page.waitForTimeout(1200);
    assert.ok(Math.abs((await position()) - 114.163) < 1e-10, 'Correction reaches the confirmed fix');
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await position()) - 114.163) < 1e-10, 'Unconfirmed velocity must not continue moving a GPS ferry');
    const gpsMotion = (await vehicleMotion(page)).find(vehicle => vehicle.title === 'GPS fixture ferry');
    assert.equal(gpsMotion.running, false, 'Stationary GPS fix must not run a miniature animation');
    assert.ok(!gpsMotion.animations.includes('running'));
    await context.close();
  });
  await test('Mobile: tapping a vehicle opens details while map and vehicle movement remain active', async () => {
    const { page, context } = await create({ mobile: true });
    await page.evaluate(() => { window.__mobileVehicles = [...document.querySelectorAll('.vehicle-marker')]; });
    await page.evaluate(() => { let marker; window.__map.eachLayer(layer => { if (!marker && layer.options?.icon?.options?.className?.includes('vehicle-marker')) marker = layer; }); window.__map.setView(marker.getLatLng(), 16, { animate: false }); });
    const target = await page.locator('.vehicle-marker .marker-displacement').first().boundingBox();
    await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
    await page.locator('.item-popup .arrival-board').waitFor();
    assert.equal(await page.locator('.map-area').getAttribute('inert'), null, 'Mobile details leave the map interactive');
    await page.waitForTimeout(350);
    assert.ok(new Set((await frameSamples(page)).map(sample => sample[0])).size >= 10, 'Opening details preserves continuous marker movement');
    assert.ok((await dotStyles(page)).some(dot => dot.state === 'running' && dot.duration > 0), 'Road speed dots continue while details are open');
    await page.locator('.item-popup .leaflet-popup-close-button').click();
    assert.ok(new Set((await frameSamples(page)).map(sample => sample[0])).size >= 10, 'Closing details preserves animation');
    assert.equal(await page.evaluate(() => window.__mobileVehicles.every(element => element.isConnected)), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(evidence, 'mobile-motion.png') });
    await context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close();
  await fs.writeFile(path.join(evidence, 'map-motion-results.json'), JSON.stringify({ origin, results, fixture: 'Deterministic official XML/CSV/CSDI responses and transit endpoint responses; actual production adapters, projection, Leaflet rendering and interactions.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length }));
if (results.some(result => !result.ok)) process.exitCode = 1;
