// With dev running: node tests/rail-geography.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package or file URL; PLAYWRIGHT_CHANNEL defaults to chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/rail-geography');
const network = JSON.parse(await fs.readFile(new URL('../data/mtr-network.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const results = [];
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');

async function until(condition) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(await condition(), 'Expected rail update did not arrive');
}

async function create(viewport) {
  const context = await browser.newContext({ viewport });
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Fixture: unrelated feeds unavailable' }));
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eff3f4' } }] } }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en');
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = [];
    window.addEventListener('error', event => window.__errors.push(event.message));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.clock.install();
  const calls = { mtr: 0, lrt: 0 }, held = [];
  await context.route('**/api/**', async route => {
    const kind = new URL(route.request().url()).pathname.split('/')[2];
    if (!(kind in calls)) return route.fulfill({ status: 503, body: 'Fixture: unrelated feeds unavailable' });
    calls[kind]++;
    const observedAt = new Date(await page.evaluate(() => Date.now())).toISOString();
    const trains = kind === 'mtr'
      ? [{ id: 'curve-mtr', line: 'ISL', dest: 'ADM', plat: '1', anchor: 'CEN', path: ['SHW', 'CEN', 'ADM'], hold: ['SHW', 'CEN', 'ADM'] }]
      : [{ id: 'curve-lrt', line: '507', dest: '260', plat: '1', anchor: '250', path: ['1', '240', '250', '260'], hold: ['1', '240', '250', '260'] }];
    const json = { ok: true, complete: true, fetchedAt: observedAt, observedAt, boards: [], trains: trains.map(train => ({ ...train, ttnt: calls[kind] === 1 ? .6 : .65, observedAt, delay: false, timeType: 'A' })) };
    if (calls[kind] === 2) { held.push({ route, json }); return; }
    return route.fulfill({ json });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.locator('.layer-card.lrt [role="switch"]').evaluate(element => element.click());
  await until(() => calls.mtr >= 1 && calls.lrt >= 1);
  await page.waitForFunction(() => document.querySelectorAll('.vehicle-marker.rail-marker').length === 2);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  return { context, page, calls, held };
}

// Read the actual Leaflet layers, including the Canvas renderer's painted pixels.
async function overview(page) {
  return page.evaluate(() => {
    const lines = [], halos = [];
    window.__map.eachLayer(layer => {
      if (layer.options?.className === 'rail-route-polyline') lines.push(layer);
      if (layer.options?.className === 'rail-route-halo') halos.push(layer);
    });
    const summary = lines.map(line => {
      const points = line.getLatLngs(), canvas = line._renderer._container;
      const bounds = canvas.getBoundingClientRect(), mapBounds = window.__map.getContainer().getBoundingClientRect();
      const context = canvas.getContext('2d'), ratio = canvas.width / bounds.width;
      const color = line.options.color.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16));
      let painted = false;
      for (const point of points) {
        const projected = window.__map.latLngToContainerPoint(point);
        if (projected.x < 8 || projected.y < 8 || projected.x > mapBounds.width - 8 || projected.y > mapBounds.height - 8) continue;
        const x = Math.round((mapBounds.left + projected.x - bounds.left) * ratio), y = Math.round((mapBounds.top + projected.y - bounds.top) * ratio);
        const pixels = context.getImageData(x - 3, y - 3, 7, 7).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 150 && color.every((channel, index) => Math.abs(pixels[i + index] - channel) < 24)) { painted = true; break; }
        }
        if (painted) break;
      }
      return { color: line.options.color, vertices: points.length, smoothFactor: line.options.smoothFactor, opacity: line.options.opacity, painted };
    });
    return { lines: summary, halos: halos.length };
  });
}

// Geographic distance to a route segment, sampled during the polling correction.
async function startSamples(page) {
  await page.evaluate(() => {
    const lines = [], markers = [];
    window.__map.eachLayer(layer => {
      if (layer.options?.className === 'rail-route-polyline') lines.push(layer);
      if (layer.options?.icon?.options?.className?.includes('vehicle-marker') && layer.options.icon.options.className.includes('rail-marker')) markers.push(layer);
    });
    const byColor = new Map();
    lines.forEach(line => { const points = byColor.get(line.options.color) ?? []; points.push(line.getLatLngs()); byColor.set(line.options.color, points); });
    window.__railSamples = [];
    window.__samplingRail = true;
    const sample = () => {
      window.__railSamples.push(markers.map(marker => {
        const position = marker.getLatLng();
        const color = getComputedStyle(marker.getElement().querySelector('.marker-inner')).getPropertyValue('--marker-color').trim();
        let nearest = Infinity;
        for (const points of byColor.get(color) ?? []) {
          for (let i = 1; i < points.length; i++) {
            const xScale = Math.cos(position.lat * Math.PI / 180) * 111195, yScale = 111195;
            const a = { x: (points[i - 1].lng - position.lng) * xScale, y: (points[i - 1].lat - position.lat) * yScale };
            const b = { x: (points[i].lng - position.lng) * xScale, y: (points[i].lat - position.lat) * yScale };
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
            nearest = Math.min(nearest, Math.hypot(a.x + dx * t, a.y + dy * t));
          }
        }
        return { lat: position.lat, lng: position.lng, nearest, connected: marker.getElement().isConnected };
      }));
      if (window.__samplingRail) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

try {
  await fs.mkdir(evidence, { recursive: true });
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    let context;
    try {
      const state = await create(viewport);
      context = state.context;
      const { page } = state;
      await page.evaluate(() => { window.__map.setView([22.36, 114.12], 10, { animate: false }); });
      await page.clock.runFor(100);
      const routes = await overview(page);
      assert.ok(routes.lines.length > 100, 'MTR and Light Rail track sections all reach the map');
      assert.equal(routes.halos, routes.lines.length, 'Every rail path has a readable casing');
      assert.ok(routes.lines.filter(line => line.vertices > 2).length > routes.lines.length * .8, 'Rail lines follow geographic track vertices instead of straight station chords');
      assert.ok(routes.lines.every(line => line.smoothFactor === 0 && line.opacity >= .9), 'Both viewports retain all geometry and clear route colors');
      for (const { color } of Object.values(network.lines)) {
        assert.ok(routes.lines.some(line => line.color === color), `The ${color} MTR line is rendered`);
        assert.ok(routes.lines.some(line => line.color === color && line.painted), `The ${color} MTR route paints visible pixels at network scale`);
      }
      assert.ok(await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').count(), 'Rail geometry is attributed');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Rail routes fit the viewport');
      await page.screenshot({ path: path.join(evidence, `${label}-rail-network.png`) });
      await page.clock.runFor(31000);
      await until(() => state.held.length === 2);
      await startSamples(page);
      await Promise.all(state.held.map(({ route, json }) => route.fulfill({ json })));
      await new Promise(resolve => setTimeout(resolve, 100));
      await page.clock.runFor(1200);
      const samples = await page.evaluate(() => { window.__samplingRail = false; return window.__railSamples; });
      assert.ok(samples.length > 20, 'Polling correction is checked frame by frame');
      assert.ok(samples.flat().every(sample => sample.nearest < .25 && sample.connected), 'Every train stays on its colored geographic route throughout a feed correction');
      assert.ok(new Set(samples.map(sample => JSON.stringify(sample.map(point => [point.lat, point.lng])))).size > 10, 'Feed correction preserves moving train markers');
      await page.evaluate(() => { window.__map.setView([22.285, 114.155], 16, { animate: false }); });
      await page.clock.runFor(100);
      await page.screenshot({ path: path.join(evidence, `${label}-rail-curves.png`) });
      await page.locator('.basemap-toggle').click();
      await page.waitForFunction(() => document.querySelector('.map-canvas')?.dataset.basemap === 'positron');
      await until(async () => (await page.locator('.leaflet-control-attribution').textContent()).includes('OpenFreeMap'));
      assert.ok(await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').count(), 'OSM rail attribution survives switching to Positron');
      assert.deepEqual(await page.evaluate(() => window.__errors), [], 'Geographic rail rendering has no browser errors');
      results.push({ label, ok: true, paths: routes.lines.length, vertices: routes.lines.reduce((sum, line) => sum + line.vertices, 0), maxTrainOffsetMetres: Math.max(...samples.flat().map(sample => sample.nearest)) });
      console.log(`PASS ${label}: geographic rail paths, painted colors, polling movement, and attribution`);
    } catch (error) {
      results.push({ label, ok: false, error: error.stack });
      console.error(`FAIL ${label}: ${error.stack}`);
    } finally { await context?.close(); }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(evidence, 'rail-geography-results.json'), JSON.stringify({ origin, results, fixture: 'Deterministic rail countdowns and empty basemap tiles; production geometry, interpolation, Canvas pixels, responsive layout, and polling.' }, null, 2));
}
if (results.some(result => !result.ok)) process.exitCode = 1;
