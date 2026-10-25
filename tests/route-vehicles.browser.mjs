// PLAYWRIGHT_MODULE points to the external runtime; run with Node's TypeScript stripping.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mtrBusStops, commuterCatalogue } from '../lib/commuter-catalogue.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://localhost:5173';
const evidence = process.argv[3] || '/tmp/hkrt-route-vehicles';
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');
const selection = code => ({ operator: 'kmb', route: code, stopId: 'B', company: 'KMB', bound: 'O', serviceType: '1', stopSeq: 2 });
const shape = code => ({ key: `kmb:${code}:O:1::`, operator: 'kmb', route: code, selection: selection(code), company: 'KMB', geometry: 'road', coordinates: [[114.155, 22.3], [114.16, 22.3], [114.165, 22.3 + (code === '2' ? .002 : 0)]], stops: [
  { id: 'A', seq: 1, nameTc: '起點', nameEn: 'Origin', lng: 114.155, lat: 22.3, distance: 0 },
  { id: 'B', seq: 2, nameTc: '中途站', nameEn: 'Intermediate stop', lng: 114.16, lat: 22.3, distance: 500 },
  { id: 'C', seq: 3, nameTc: '終點', nameEn: 'Terminus', lng: 114.165, lat: 22.3, distance: 1000 },
] });
try {
  for (const [width, language, mode] of [[1440, 'en', '2d'], [390, 'zh', '2d'], [1440, 'en', '3d'], [390, 'zh', '3d']]) {
    const context = await browser.newContext({ viewport: { width, height: width > 700 ? 960 : 844 }, hasTouch: width < 700, reducedMotion: 'no-preference' });
    const page = await context.newPage(), errors = [], calls = [], gates = new Map(), controls = { state: 'live' };
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ language, mode }) => {
      localStorage.setItem('hk-traffic-language-v1', language);
      localStorage.setItem('hk-traffic-basemap-v1', 'osm');
      localStorage.setItem('hk-traffic-layers-v1', JSON.stringify({ kmb: true }));
      localStorage.setItem('hk-traffic-session-v1', JSON.stringify({ version: 1, mapMode: mode, view: { lng: 114.16, lat: 22.3, zoom: 16 }, followLocation: false, routeVisibility: { 'all:bus': false } }));
      const realNow = Date.now.bind(Date); window.__timeOffset = 0; Date.now = () => realNow() + window.__timeOffset;
      let leaflet;
      Object.defineProperty(window, 'L', { configurable: true, get: () => leaflet, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
    }, { language, mode });
    await context.route('**/app/traffic-map-3d.tsx*', async route => { const response = await route.fetch(), source = await response.text(); await route.fulfill({ response, body: source.replace('map.current = m;', 'map.current = m; window.__nativeMap = m;') }); });
    await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, body: 'Unrelated fixture' }));
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), kind = url.pathname.split('/').at(-1), code = url.searchParams.get('route'), at = Date.now(), observedAt = new Date(at).toISOString();
      const base = { ok: true, observedAt, fetchedAt: observedAt, stale: false };
      if (kind === 'bus-route-paths') return route.fulfill({ json: { ok: true, routes: [shape(code)] } });
      if (kind === 'route-vehicles') {
        calls.push(code);
        if (url.searchParams.get('operator') === 'mtr-bus') {
          const last = mtrBusStops.filter(stop => stop.route === code && stop.direction === 'O').sort((a, b) => a.seq - b.seq).at(-1);
          const cameras = commuterCatalogue('mtr-bus').filter(camera => camera.routes.includes(code)).map(camera => ({ ...camera, dataUpdated: observedAt, arrivals: camera.sourceId === last.id ? [{ route: code, destination: last.tc, destinationEn: last.en, minutes: 1, eta: new Date(at + 60000).toISOString(), observedAt, scheduled: true }] : [] }));
          return route.fulfill({ json: { ...base, snapshot: { kind: 'mtr-bus', data: { cameras, count: cameras.length, expectedCount: cameras.length, fetchedAt: observedAt, observedAt, stale: false, sourceLastModified: null, source: 'fixture', complete: true } } } });
        }
        if (!gates.has(code)) { let release; const pending = new Promise(resolve => { release = resolve; }); gates.set(code, { pending, release }); }
        await gates.get(code).pending;
        if (controls.state === 'error') return route.fulfill({ status: 503, json: { ok: false } }).catch(() => {});
        const vehicles = controls.state === 'empty' ? [] : [{ id: `live-${code}`, fromDistance: 0, toDistance: 1000, departureAt: at - 60000, arrivalAt: at + 240000, validUntil: at + 180000 }];
        return route.fulfill({ json: { ...base, snapshot: { kind: 'bus', data: { ...base, route: shape(code), vehicles, reverse: [] } } } }).catch(() => {});
      }
      if (kind === 'kmb') return route.fulfill({ json: { ...base, stops: [{ id: 'B', nameTc: '中途站', nameEn: 'Intermediate stop', lat: 22.3, lng: 114.16, routes: ['1', '2'], calls: ['1', '2'].map(code => ({ route: code, destTc: '終點', destEn: 'Terminus', minutes: 1, eta: new Date(at + 60000).toISOString(), scheduled: false, tracking: selection(code) })) }] } });
      if (kind === 'mtr-bus') return route.fulfill({ json: { ...base, cameras: [] } });
      return route.fulfill({ json: { ...base, boards: [], trains: [], stops: [], piers: [], vessels: [], warnings: [], features: [] } });
    });
    const name = `${width}-${language}-${mode}`;
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(mode => mode === '2d' ? window.__map?._loaded : window.__nativeMap?.getLayer('hk-transport-lines') && document.querySelector('.native-map-area .zoom-buttons button:not(:disabled)'), mode);
      const open = async () => { if (!await page.locator('.layers-popover').count()) await page.locator('.map-toolbar button').first().click(); await page.locator('#layer-category').selectOption('bus'); await page.locator('.transport-layers').waitFor(); };
      const close = async () => { if (await page.locator('.layers-popover').count()) await page.locator('.layers-popover .close-button').click(); };
      const markers = code => page.locator(`.vehicle-marker[data-marker-id^="selected-vehicle:bus:kmb:${code}:"]`);
      const check = code => page.getByRole('checkbox', { name: new RegExp(`^(Show|顯示) ${code} `) });
      await open(); await check('1').check();
      await markers('1').first().waitFor();
      assert.ok(calls.includes('1'), 'Selecting a route requests its estimates immediately');
      assert.ok(gates.has('1'), 'The complete response is still blocked while viewport ETA icons are already drawn');
      await page.locator('.route-position-status').filter({ hasText: /Loading vehicle|正在載入車輛/ }).waitFor();
      await close();
      await page.locator('.background-activity').waitFor();
      await page.locator('.brand-toggle').click();
      assert.equal(await page.locator('.topbar').getAttribute('class'), 'topbar collapsed');
      assert.ok(await page.locator('.background-activity').isVisible(), 'Processing stays visible with the header collapsed');
      const samples = await markers('1').first().evaluate(node => new Promise(resolve => { const values = []; const frame = () => { values.push(node.style.transform); if (values.length === 18) resolve(values); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); }));
      assert.ok(new Set(samples).size > 5, 'ETA icons animate before the complete route response');
      await markers('1').first().locator('img').evaluate(img => img.decode());
      assert.match(await markers('1').first().locator('img').getAttribute('src'), /bus-kmb.webp$/);
      await page.screenshot({ path: `${evidence}/${name}-processing.png` });
      gates.get('1').release();
      await page.waitForFunction(() => document.querySelector('[data-marker-id*="live-1"]'));
      await page.locator('.brand-toggle').click();
      await open(); await check('2').check(); await markers('2').first().waitFor();
      assert.ok(calls.includes('2'));
      assert.ok(await markers('1').count() && await markers('2').count(), 'Several selected routes display independently');
      gates.get('2').release();
      await page.waitForFunction(() => document.querySelector('[data-marker-id*="live-2"]'));
      await check('1').uncheck();
      assert.equal(await markers('1').count(), 0, 'Hiding a route clears its vehicle icons immediately');
      await check('K12').check();
      const mtr = page.locator('.vehicle-marker[data-marker-id^="selected-vehicle:bus:mtr-bus:K12:"]');
      await mtr.first().waitFor(); await mtr.first().locator('img').evaluate(img => img.decode());
      assert.match(await mtr.first().locator('img').getAttribute('src'), /bus-mtr.webp$/);
      await check('K12').uncheck();
      controls.state = 'error';
      await page.evaluate(() => { window.__timeOffset += 31000; document.dispatchEvent(new Event('visibilitychange')); });
      await page.getByText(language === 'en' ? 'Vehicle update unavailable' : '未能更新車輛位置', { exact: true }).waitFor();
      assert.ok(await markers('2').count(), 'A failed refresh keeps unexpired estimates');
      controls.state = 'empty';
      await page.getByRole('button', { name: /^(Retry vehicle positions|重試車輛位置) 2$/ }).click();
      await page.waitForFunction(() => !document.querySelector('[data-marker-id^="selected-vehicle:bus:kmb:2:"]'));
      await page.getByText(language === 'en' ? 'No current position estimate' : '暫無位置估算', { exact: true }).waitFor();
      await close();
      await page.locator('.background-activity').waitFor({ state: 'detached', timeout: 30000 });
      assert.deepEqual(errors, []);
      results.push({ name, ok: true }); console.log('PASS ' + name);
    } catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: `${evidence}/${name}-failed.png` }); }
    finally { for (const gate of gates.values()) gate.release(); await context.close(); }
  }
} finally { await browser.close(); await fs.writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2)); }
if (results.some(result => !result.ok)) process.exitCode = 1;
