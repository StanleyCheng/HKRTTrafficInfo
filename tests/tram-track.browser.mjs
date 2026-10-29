// PLAYWRIGHT_MODULE points to an existing Playwright runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import data from '../data/tram-track-geometry.json' with { type: 'json' };
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = process.argv[3] || '/tmp/hkrt-tram-tracks';
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQAAAABJRU5ErkJggg==', 'base64');
try {
  for (const mode of ['2d', '3d']) for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ mode, language }) => {
      localStorage.setItem('hk-traffic-language-v1', language);
      localStorage.setItem('hk-traffic-basemap-v1', 'osm');
      localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ tram: true }));
      localStorage.setItem('hk-traffic-session-v1', JSON.stringify({ version: 1, mapMode: mode, view: { lng: 114.18, lat: 22.28, zoom: 15 }, followLocation: false, openControl: 'layers', layerCategory: 'tram', routeVisibility: { 'all:tram': false, 'tram:4002': true } }));
      let leaflet;
      Object.defineProperty(window, 'L', { configurable: true, get: () => leaflet, set(value) { leaflet = value; value.Map.addInitHook(function () { window.__map = this; }); } });
    }, { mode, language });
    await context.route('**/app/traffic-map-3d.tsx*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('map.current = m;', 'map.current = m; window.__nativeMap = m;') }); });
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
    await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, body: 'Unrelated fixture' }));
    await context.route('**/api/**', route => route.fulfill({ json: { ok: true, cameras: [], boards: [], trains: [], stops: [], vessels: [], piers: [], notices: [], warnings: [] } }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const read = () => page.evaluate(mode => {
      if (mode === '3d') return window.__nativeMap?.getSource('hk-transport')?.serialize().data.features.filter(f => f.properties.color === '#278273').map(f => f.geometry.coordinates) ?? [];
      const paths = []; window.__map?.eachLayer(layer => { if (layer.options.color === '#278273' && layer.getLatLngs) paths.push(layer.getLatLngs().map(point => [point.lng, point.lat])); }); return paths;
    }, mode);
    const expected = id => [`${id}-1`, `${id}-2`].map(key => data.routes[key].coordinates);
    await page.waitForFunction(({ mode, n }) => {
      if (mode === '3d') return window.__nativeMap?.getSource('hk-transport')?.serialize().data.features.filter(f => f.properties.color === '#278273').length === n;
      let count = 0; window.__map?.eachLayer(layer => { if (layer.options.color === '#278273' && layer.getLatLngs) count++; }); return count === n;
    }, { mode, n: 2 });
    assert.deepEqual(await read(), expected('4002'), 'Both Happy Valley–Shau Kei Wan tracks render from the matched data');
    await page.locator('.transport-route-list input:checked').uncheck();
    const next = page.locator('.transport-route-list li').filter({ hasText: language === 'en' ? 'Kennedy Town - Happy Valley' : '堅尼地城 - 跑馬地' }).getByRole('checkbox');
    await next.check();
    await page.waitForFunction(({ mode, first }) => {
      if (mode === '3d') return window.__nativeMap?.getSource('hk-transport')?.serialize().data.features.some(f => f.properties.color === '#278273' && Math.abs(f.geometry.coordinates[0][0] - first) < 1e-7);
      let found = false; window.__map?.eachLayer(layer => { if (layer.options.color === '#278273' && layer.getLatLngs && Math.abs(layer.getLatLngs()[0].lng - first) < 1e-7) found = true; }); return found;
    }, { mode, first: data.routes['4003-1'].coordinates[0][0] });
    assert.deepEqual(await read(), expected('4003'), 'Route selection switches both directional tracks');
    await next.locator('xpath=ancestor::li').getByRole('button', { name: /^(Zoom to route|縮放至路線)/ }).click();
    await page.locator('.layers-popover').waitFor({ state: 'detached' });
    await page.screenshot({ path: `${evidence}/tram-${mode}-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${language} ${mode}: matched tram tracks and route selection`);
    await context.close();
  }
} finally { await browser.close(); }
