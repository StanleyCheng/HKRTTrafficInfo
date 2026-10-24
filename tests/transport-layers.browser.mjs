// Run against the local dev server with PLAYWRIGHT_MODULE set to the installed runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { emptyRouteVehicles } from './browser-controls.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = process.argv[3] || 'output/playwright/transport-layers';
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const results = [];
try {
  for (const [width, height, language, mode] of [[1440, 960, 'en', '2d'], [390, 844, 'zh', '2d'], [320, 700, 'en', '2d'], [844, 500, 'en', '2d'], [1440, 960, 'en', '3d'], [390, 844, 'zh', '3d']]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], pathRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ language, mode }) => {
      if (!localStorage.getItem('fixture')) {
        localStorage.setItem('fixture', '1');
        localStorage.setItem('hk-traffic-language-v1', language);
        localStorage.setItem('hk-traffic-basemap-v1', 'osm');
        localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ kmb: true, mtr: true, lrt: true, ferry: true, tram: true }));
        localStorage.setItem('hk-traffic-session-v1', JSON.stringify({ version: 1, mapMode: mode, view: { lng: 114.16, lat: 22.3, zoom: 16 }, followLocation: false }));
      }
      let leaflet;
      Object.defineProperty(window, 'L', { configurable: true, get: () => leaflet, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
    }, { language, mode });
    await context.route('**/app/traffic-map-3d.tsx*', async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source.replace('map.current = m;', 'map.current = m; window.__nativeMap = m;') });
    });
    await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, body: 'Excluded from transport fixture' }));
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url()), kind = url.pathname.split('/').at(-1), now = new Date().toISOString();
      const base = { ok: true, observedAt: now, fetchedAt: now, stale: false };
      if (kind === 'route-vehicles') return route.fulfill({ json: emptyRouteVehicles(url) });
      if (kind === 'bus-route-paths') {
        const code = url.searchParams.get('route'); pathRequests.push(code);
        return route.fulfill({ json: { ok: true, routes: [{ key: `fixture-${code}`, operator: 'kmb', route: code, geometry: 'road', coordinates: code === '1' ? [[114.15, 22.29], [114.17, 22.31]] : [[114.16, 22.29], [114.19, 22.33]], stops: [] }] } });
      }
      if (kind === 'kmb') return route.fulfill({ json: { ...base, stops: (Number(url.searchParams.get('lng')) > 114.22 ? ['3'] : ['1', '2']).map((code, i) => ({ id: `STOP${code}`, nameTc: `巴士站 ${code}`, nameEn: `Bus stop ${code}`, lng: 114.16 + i * .001, lat: 22.3, routes: [code], calls: [] })) } });
      if (kind === 'mtr-bus') return route.fulfill({ json: { ...base, cameras: [], paths: [] } });
      return route.fulfill({ json: { ...base, boards: [], trains: [], stops: [], piers: [], vessels: [], warnings: [], notices: [], features: [] } });
    });
    const prefix = `${width}-${height}-${language}-${mode}`;
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(mode => mode === '3d' ? window.__nativeMap?.getLayer('hk-transport-lines') : window.__map?._loaded, mode);
      const open = async () => {
        if (!await page.locator('.layers-popover').count()) await page.locator('.map-toolbar button').first().click();
        await page.locator('.transport-layers').waitFor();
      };
      const close = async () => { if (await page.locator('.layers-popover').count()) await page.locator('.layers-popover .close-button').click(); };
      await open();
      assert.equal(await page.locator('.map-toolbar > button, .map-toolbar > [data-slot="popover-trigger"]').count(), 3);
      assert.equal(await page.locator('.bus-stops-button,.route-labels-button,.rail-lines-popover').count(), 0);
      await page.waitForFunction(() => document.querySelector('.transport-route-list')?.textContent.match(/KMB|九巴/));
      await page.waitForFunction(() => document.querySelectorAll('.transport-route-list .transport-route-zoom:not(:disabled)').length >= 28);
      assert.deepEqual([...new Set(pathRequests)].sort(), ['1', '2']);
      const stopSwitch = page.getByRole('switch', { name: language === 'en' ? 'Bus stops' : '巴士站', exact: true });
      await stopSwitch.uncheck();
      await close();
      assert.equal(await page.locator('.bus-stop-marker').count(), 0);
      await open(); await stopSwitch.check();
      await page.getByRole('button', { name: language === 'en' ? 'Hide all routes' : '隱藏所有路線', exact: true }).click();
      assert.equal(await page.locator('.transport-route-list input:checked').count(), 0);
      const one = page.locator('.transport-route-list li').filter({ has: page.getByRole('checkbox', { name: language === 'en' ? /^Show 1 KMB/ : /^顯示 1 九巴/ }) });
      await one.getByRole('checkbox').check();
      assert.equal(await page.locator('.transport-route-list input:checked').count(), 1);
      await page.locator('.transport-route-search input').fill('no-such-route');
      assert.equal(await page.locator('.transport-route-list li').count(), 0);
      await page.locator('.transport-route-search input').fill('');
      await one.getByRole('button').click();
      await page.locator('.layers-popover').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('.bus-stop-marker').length === 1);
      await page.evaluate(mode => {
        if (mode === '2d') window.__map.setView([22.4, 114.25], 16, { animate: false });
        else window.__nativeMap.jumpTo({ center: [114.25, 22.4], zoom: 15 });
      }, mode);
      await open();
      await page.getByRole('checkbox', { name: language === 'en' ? /^Show 3 KMB/ : /^顯示 3 九巴/ }).waitFor();
      assert.equal(await one.getByRole('checkbox').isChecked(), true, 'An explicitly selected route stays available after moving to another area');
      await page.locator('#transport-mode').selectOption('rail');
      await page.getByRole('button', { name: language === 'en' ? 'Hide all routes' : '隱藏所有路線', exact: true }).click();
      const twl = page.getByRole('checkbox', { name: /TWL/ });
      const eal = page.getByRole('checkbox', { name: /EAL/ });
      await twl.check(); await eal.check();
      assert.equal(await page.locator('.transport-route-list input:checked').count(), 2);
      const bounds = await page.locator('.layers-popover').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, JSON.stringify(bounds));
      await page.screenshot({ path: `${evidence}/${prefix}.png` });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.transport-layers').waitFor();
      await page.waitForFunction(mode => mode === '2d' ? window.__map?._loaded : window.__nativeMap?.getLayer('hk-transport-lines') && document.querySelector('.native-map-area .zoom-buttons button:not(:disabled)'), mode);
      assert.equal(await page.locator('#transport-mode').inputValue(), 'rail');
      assert.equal(await page.locator('.transport-route-list input:checked').count(), 2);
      await page.locator('.transport-route-list li').filter({ has: twl }).getByRole('button').click();
      await page.waitForFunction(mode => Math.abs((mode === '2d' ? window.__map.getCenter() : window.__nativeMap.getCenter()).lng - 114.25) > .001, mode);
      await page.evaluate(mode => {
        if (mode === '2d') window.__map.setView([22.4, 114.25], 16, { animate: false });
        else window.__nativeMap.jumpTo({ center: [114.25, 22.4], zoom: 15 });
      }, mode);
      await close();
      await page.getByTestId('map-mode-toggle').click();
      await page.waitForFunction(mode => mode === '2d' ? window.__nativeMap?.getLayer('hk-transport-lines') : window.__map?._loaded && document.querySelector('.leaflet-container'), mode);
      const switchedView = await page.evaluate(mode => {
        const center = mode === '2d' ? window.__nativeMap.getCenter() : window.__map.getCenter();
        return { lng: center.lng, lat: center.lat, zoom: mode === '2d' ? window.__nativeMap.getZoom() + 1 : window.__map.getZoom() };
      }, mode);
      assert.ok(Math.abs(switchedView.lng - 114.25) < .00001 && Math.abs(switchedView.lat - 22.4) < .00001 && switchedView.zoom === 16, 'Switching renderers preserves a manual pan after route zoom: ' + JSON.stringify(switchedView));
      await open();
      assert.equal(await page.locator('.transport-route-list input:checked').count(), 2);
      await page.locator('#transport-mode').selectOption('ferry');
      assert.equal(await page.locator('.transport-route-list li').count(), 16);
      await page.locator('#transport-mode').selectOption('tram');
      assert.equal(await page.locator('.transport-route-list li').count(), 6);
      assert.deepEqual(errors, []);
      results.push({ name: prefix, ok: true }); console.log('PASS ' + prefix);
    } catch (error) { results.push({ name: prefix, ok: false, error: error.stack }); console.error('FAIL ' + prefix + '\n' + error.stack); await page.screenshot({ path: `${evidence}/${prefix}-failed.png` }); }
    finally { await context.close(); }
  }
} finally { await browser.close(); await fs.writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2)); }
if (results.some(result => !result.ok)) process.exitCode = 1;
