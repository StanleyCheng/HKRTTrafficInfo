// node tests/ferry-hover.browser.mjs [baseURL] [evidenceDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = path.resolve(process.argv[3] || 'outputs/ferry-hover');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const observed = Date.now(), observedAt = new Date(observed).toISOString();
let gpsUpdated = false;
const call = (fields = {}) => ({ route: '天星', destTc: '中環', destEn: 'Central', originTc: '', originEn: '', arriving: false, eta: new Date(observed + 90000).toISOString(), minutes: 2, scheduled: true, firstFerry: '06:30', lastFerry: '23:30', remarkTc: '預計', remarkEn: 'Estimated', ...fields });
await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Unrelated fixture feed unavailable' }));
await context.route('**/api/**', route => {
  if (!new URL(route.request().url()).pathname.endsWith('/ferry')) return route.fulfill({ json: { ok: true, observedAt, boards: [], trains: [], stops: [], points: [], warnings: [] } });
  return route.fulfill({ json: { ok: true, observedAt, piers: [{ id: 'fixture', nameTc: '測試碼頭', nameEn: 'Fixture pier', lng: 114.17, lat: 22.3, calls: [
    call({ eta: new Date(observed + 600000).toISOString() }), call(), call({ arriving: true, destTc: '測試碼頭', destEn: 'Wrong incoming destination' }),
    call({ route: '富裕', destTc: '觀塘', destEn: 'Kwun Tong', eta: '', minutes: null, firstFerry: undefined, lastFerry: undefined }),
  ] }], vessels: ['天星', 'CECC', '1', '富裕'].map((route, index) => ({ id: `fixture-${index}`, nameTc: `測試渡輪 ${index}`, nameEn: `Fixture ferry ${index}`, route, lng: gpsUpdated ? 114.175 : 114.173, lat: 22.29 + index * .002, fix: index === 1 ? 'gps' : 'clock', eta: new Date(observed + 600000).toISOString(), minutes: 10, departAt: observed - 600000, arriveAt: observed + 600000, pathLng: [114.165, 114.181], pathLat: [22.29 + index * .002, 22.29 + index * .002] })) } });
});
await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64') }));
await context.addInitScript(() => {
  localStorage.setItem('hk-traffic-language-v1', 'en'); localStorage.setItem('hk-traffic-basemap-v1', 'osm');
  window.__errors = []; window.addEventListener('error', event => window.__errors.push(event.message));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
  let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
});
const page = await context.newPage();
const hover = async marker => { await marker.locator('.marker-inner').waitFor(); const box = await marker.locator('.marker-inner').boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); };
try {
  await fs.mkdir(evidence, { recursive: true });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.locator('.layer-card.ferry [role="switch"]').click();
  const marker = page.locator('[data-marker-id="ferry-fixture"]'), card = page.locator('.ferry-hover');
  await marker.waitFor();
  await page.evaluate(() => { window.__map.setView([22.296, 114.17], 15, { animate: false }); });
  await page.waitForFunction(() => document.querySelectorAll('.ferry-marker').length === 4);
  assert.deepEqual((await page.locator('.ferry-marker img').evaluateAll(images => images.map(image => image.getAttribute('src').split('/').pop()))).sort(), ['ferry-fortune.webp', 'ferry-hkkf.webp', 'ferry-star.webp', 'ferry-sun.webp']);
  assert.match(await page.locator('.ferry-marker[title="Fixture ferry 0"]').getAttribute('aria-label'), /Estimated position · timetable \/ arrival data/);
  assert.match(await page.locator('.ferry-marker[title="Fixture ferry 1"]').getAttribute('aria-label'), /GPS/);
  const moving = page.locator('.ferry-marker[title="Fixture ferry 0"]');
  const before = await moving.getAttribute('style'); await page.waitForTimeout(200); assert.notEqual(await moving.getAttribute('style'), before, 'Timetable boat moves continuously');
  assert.equal(await marker.getAttribute('title'), null);
  await hover(marker); await page.waitForTimeout(700); assert.equal(await card.count(), 0);
  await page.mouse.move(30, 20); await page.waitForTimeout(1500); assert.equal(await card.count(), 0, 'Early exit cancels dwell');
  await hover(marker); await page.waitForTimeout(1400); assert.equal(await card.count(), 0);
  await card.waitFor();
  assert.equal(await card.locator('li').count(), 2, 'One row per departing destination');
  const central = card.locator('li').filter({ hasText: 'Central' });
  assert.match(await central.innerText(), /First ferry\s+06:30/); assert.match(await central.innerText(), /Last ferry\s+23:30/);
  assert.match(await central.innerText(), /Next ferry/); assert.match(await central.innerText(), /Next in 2 min/);
  assert.doesNotMatch(await card.innerText(), /Wrong incoming destination/);
  assert.equal(await card.locator('li').filter({ hasText: 'Kwun Tong' }).getByText('Unavailable', { exact: true }).count(), 3);
  await card.hover(); await page.waitForTimeout(350); assert.equal(await card.count(), 1, 'Popup accepts pointer');
  await page.evaluate(() => { const realNow = Date.now; Date.now = () => realNow() + 60000; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('.ferry-countdown')?.textContent === 'Next in 1 min');
  await page.screenshot({ path: path.join(evidence, 'ferry-hover-en.png') });
  await page.keyboard.press('Escape'); await card.waitFor({ state: 'detached' });
  await page.keyboard.press('Tab'); await marker.focus(); await card.waitFor();
  assert.equal(await card.evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Escape'); await card.waitFor({ state: 'detached' });
  assert.equal(await marker.evaluate(element => document.activeElement === element), true);
  await page.getByRole('button', { name: 'Chinese', exact: true }).click();
  await page.locator('[data-marker-id="ferry-fixture"][aria-label="測試碼頭"]').waitFor();
  await hover(marker); await card.waitFor();
  assert.match(await card.innerText(), /測試碼頭/); assert.match(await card.innerText(), /頭班船/); assert.match(await card.innerText(), /尾班船/); assert.match(await card.innerText(), /下一班船/); assert.match(await card.innerText(), /分鐘後開出/);
  await page.screenshot({ path: path.join(evidence, 'ferry-hover-zh.png') });
  await page.keyboard.press('Escape');
  gpsUpdated = true;
  const response = page.waitForResponse(response => response.url().includes('/api/ferry') && response.ok());
  await page.locator('.sidebar-footer button').click(); await response;
  await page.waitForFunction(() => { let lng; window.__map.eachLayer(layer => { if (layer.getElement?.()?.title === '測試渡輪 1') lng = layer.getLatLng().lng; }); return lng > 114.173 && lng < 114.175; });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => { let lng; window.__map.eachLayer(layer => { if (layer.getElement?.()?.title === '測試渡輪 1') lng = layer.getLatLng().lng; }); return lng; }), 114.175, 'GPS correction reaches confirmed fix');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForLoadState('networkidle');
  console.log(await page.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, canvas: document.querySelector('.map-canvas')?.className })));
  await page.waitForFunction(() => document.querySelector('.map-canvas')?.classList.contains('map-motion-paused'));
  const reducedBoat = page.locator('.ferry-marker[title="測試渡輪 0"]');
  const reducedPosition = await reducedBoat.getAttribute('style');
  await page.waitForTimeout(1200);
  assert.equal(await reducedBoat.getAttribute('style'), reducedPosition, 'Reduced motion keeps the estimated boat stationary between feed updates');
  await page.setViewportSize({ width: 375, height: 844 });
  await page.evaluate(() => { window.__map.setView([22.3, 114.17], 15, { animate: false }); });
  await hover(marker); await card.waitFor();
  await page.waitForTimeout(100);
  assert.equal(await card.evaluate(element => {
    const popup = element.closest('.leaflet-popup').getBoundingClientRect(), map = document.querySelector('.map-canvas').getBoundingClientRect();
    return popup.left >= map.left && popup.right <= document.querySelector('.map-tools').getBoundingClientRect().left && popup.top >= document.querySelector('.traffic-status').getBoundingClientRect().bottom && popup.bottom <= map.bottom;
  }), true, 'Pier hover fits the 375px map clear of controls and status');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(evidence, 'ferry-hover-mobile.png') });
  await page.locator('.mobile-panel-button').click(); await card.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.__errors), []);
  console.log('PASS: all operator sprites, timetable motion, confirmed GPS interpolation, reduced motion, delayed bilingual pier hover, departure filtering, unknown times, countdown, focus and Escape, mobile positioning and dismissal');
} finally { await context.close(); await browser.close(); }
