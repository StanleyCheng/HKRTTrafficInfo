// With a dev server running: node tests/map-empty.browser.mjs [baseURL] [evidenceDir]
// The map-centre empty notice must only appear when map content is genuinely
// expected: all layers off, an enabled layer failing, or an ungated camera
// layer that loaded healthy but empty. Viewport-gated bus feeds and layers
// that never place cameras (weather warnings) must keep the map quiet.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openLayers } from './browser-controls.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || 'outputs/map-empty');
const results = [];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const contexts = [];

async function create({ mobile = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile });
  contexts.push(context);
  const observedAt = new Date().toISOString();
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split('/')[2];
    // Healthy bus envelope with no stops: loads fine, places nothing.
    if (['kmb', 'citybus', 'gmb', 'nlb'].includes(kind)) return route.fulfill({ json: { ok: true, observedAt, stops: [] } });
    return route.fulfill({ json: { ok: true, observedAt, fetchedAt: observedAt, boards: [], trains: [], stops: [], piers: [], vessels: [], warnings: [], notices: [], features: [], segments: [] } });
  });
  await context.route('**tile.openstreetmap.org**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64') }));
  await context.addInitScript(() => {
    localStorage.setItem('hk-traffic-language-v1', 'en');
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  });
  const page = await context.newPage();
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded, null, { timeout: 30000 });
  return { context, page };
}

async function settle(page) {
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('.layer-card')];
    return cards.length > 0 && cards.every(card => !card.querySelector('.spin'));
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

async function toggle(page, kind, on) {
  const card = page.locator(`.layer-card.${kind} [role="switch"]`);
  if ((await card.getAttribute('aria-checked')) !== String(on)) await card.click();
}

async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  await test('Gated bus layers with every roads layer off keep the map quiet', async () => {
    const { page, context } = await create();
    await page.evaluate(() => { window.__map.setView([22.355, 114.13], 11, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await settle(page);
    const notice = page.locator('.map-empty');
    assert.equal(await notice.count(), 0, 'A zoom-gated bus feed is healthy and must not raise the no-locations notice');
    await page.screenshot({ path: path.join(evidence, 'gated-bus-quiet.png') });
    await context.close();
  });
  await test('Weather warnings alone never raise the no-locations notice', async () => {
    const { page, context } = await create();
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'weather-warning', true);
    await settle(page);
    assert.equal(await page.locator('.map-empty').count(), 0, 'A layer that places no cameras by design must not raise the notice');
    await context.close();
  });
  await test('Every layer off still explains how to turn layers on', async () => {
    const { page, context } = await create();
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /All layers are off/, 'The all-off hint stays available');
    await context.close();
  });
  await test('An ungated bus layer that loads healthy but empty keeps the honest notice', async () => {
    const { page, context } = await create();
    await page.evaluate(() => { window.__map.setView([22.3, 114.17], 14, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /No camera location data is available/, 'Genuinely empty loaded layers still explain themselves');
    await context.close();
  });
  await test('Mobile: gated bus layers keep the map quiet', async () => {
    const { page, context } = await create({ mobile: true });
    await page.evaluate(() => { window.__map.setView([22.355, 114.13], 11, { animate: false }); });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await toggle(page, 'kmb', true);
    await settle(page);
    assert.equal(await page.locator('.map-empty').count(), 0, 'The mobile map stays quiet with only a gated bus feed on');
    await context.close();
  });
  await test('Mobile: every layer off still explains how to turn layers on', async () => {
    const { page, context } = await create({ mobile: true });
    await openLayers(page);
    for (const kind of ['flow', 'incident', 'mtr']) await toggle(page, kind, false);
    await settle(page);
    const notice = page.locator('.map-empty');
    await notice.waitFor();
    assert.match(await notice.innerText(), /All layers are off/, 'The all-off hint stays available on mobile');
    await context.close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close();
  await fs.writeFile(path.join(evidence, 'map-empty-results.json'), JSON.stringify({ origin, results, fixture: 'All /api feeds answered with deterministic healthy-but-empty envelopes; gating and rendering use production code.' }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length }));
if (results.some(result => !result.ok)) process.exitCode = 1;
