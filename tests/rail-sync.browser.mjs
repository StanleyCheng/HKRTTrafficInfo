// With dev running: node tests/rail-sync.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package or file URL; PLAYWRIGHT_CHANNEL defaults to chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openLayers } from './browser-controls.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const evidence = path.resolve(process.argv[3] || '.impeccable/review/rail');
const filter = process.env.RAIL_TEST_FILTER ? new RegExp(process.env.RAIL_TEST_FILTER) : null;
const results = [];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const contexts = [];
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAI7mY6QAAAABJRU5ErkJggg==', 'base64');

async function create(kind = 'mtr', response = () => 'complete', language = 'en') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  await context.route(url => url.hostname.endsWith('.gov.hk'), route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Fixture: original feeds unavailable' }));
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await context.addInitScript(language => {
    localStorage.setItem('hk-traffic-language-v1', language);
    localStorage.setItem('hk-traffic-basemap-v1', 'osm');
    window.__errors = [];
    window.addEventListener('error', event => window.__errors.push(event.message));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition() { return 0; }, clearWatch() {} } });
    let leaflet;
    Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; }, set(value) { leaflet = value; value.Map.addInitHook(function() { window.__map = this; }); } });
  }, language);
  const page = await context.newPage();
  await page.clock.install();
  const calls = [], held = [];
  await context.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/')[2];
    if (endpoint !== 'mtr' && endpoint !== 'lrt') return route.fulfill({ status: 503, body: 'Fixture: unrelated feeds unavailable' });
    const at = await page.evaluate(() => Date.now());
    const status = endpoint === kind ? response(calls.push({ at, language: new URL(route.request().url()).searchParams.get('lang') })) : 'complete';
    if (status === 'fail') return route.fulfill({ status: 503, body: 'Fixture: rail feed failed' });
    const observedAt = new Date(at - 60000).toISOString();
    const train = { id: 'fixture', line: 'TWL', dest: 'TSW', plat: '1', ttnt: 3, observedAt, delay: false, timeType: 'A', anchor: 'ADM', path: ['CEN', 'ADM', 'TST'], hold: ['CEN', 'ADM', 'TST'] };
    const boards = endpoint === 'mtr'
      ? [{ line: 'TWL', station: 'ADM', observedAt, message: '', trains: [{ dest: 'TSW', plat: '1', ttnt: 3, delay: false, timeType: 'A' }] }]
      : [{ station: '1', observedAt, calls: [{ route: '610', dest: '2', destTc: '兆康', destEn: 'Siu Hong', plat: '1', ttnt: 3, timeType: 'A' }] }];
    const json = { ok: true, complete: status !== 'incomplete', stale: status === 'stale', fetchedAt: new Date(at).toISOString(), observedAt, trains: endpoint === 'mtr' ? [train] : [], boards };
    if (status === 'hold') { held.push({ route, json }); return; }
    return route.fulfill({ json });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await openLayers(page);
  if (kind === 'lrt') await page.locator('.layer-card.lrt [role="switch"]').evaluate(element => element.click());
  await until(() => calls.length >= 1);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  return { page, context, calls, held, card: page.locator(`.layer-card.${kind}`), toggle: page.locator(`.layer-card.${kind} [role="switch"]`) };
}

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(await condition(), 'Expected browser request did not arrive');
}
async function advance(state, milliseconds, expected) {
  await state.page.clock.runFor(milliseconds);
  if (expected !== undefined) await until(() => state.calls.length >= expected);
  await new Promise(resolve => setTimeout(resolve, 50));
}
async function test(name, run) {
  if (filter && !filter.test(name)) return;
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  for (const kind of ['mtr', 'lrt']) {
    await test(`${kind}: incomplete initial coverage recovers automatically on the polling cadence`, async () => {
      const state = await create(kind, call => call === 1 ? 'incomplete' : 'complete');
      await state.card.locator('[role="alert"]').waitFor();
      await advance(state, 35000, 2);
      await state.card.locator('[role="alert"]').waitFor({ state: 'hidden' });
      await advance(state, 35000, 3);
      assert.ok(state.calls.length >= 3, 'A visible rail layer keeps polling about every 30 seconds');
      assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
      await state.context.close();
    });
  }
  await test('MTR failures auto-retry while enabled; disabling stops polling and re-enabling refetches', async () => {
    const state = await create('mtr', () => 'fail');
    await state.card.locator('[role="alert"]').waitFor();
    await advance(state, 35000, 2);
    assert.ok(state.calls.length >= 2, 'Failures retry automatically on the cadence');
    await state.toggle.evaluate(element => element.click());
    const off = state.calls.length;
    await state.page.clock.fastForward(60000);
    assert.equal(state.calls.length, off, 'A disabled layer stops polling');
    await state.toggle.evaluate(element => element.click());
    await until(() => state.calls.length === off + 1);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  await test('Stale MTR data recovers automatically at the next cadence poll', async () => {
    const state = await create('mtr', call => call === 1 ? 'stale' : 'complete');
    await state.card.locator('[role="alert"]').waitFor();
    await advance(state, 35000, 2);
    await state.card.locator('[role="alert"]').waitFor({ state: 'hidden' });
    assert.ok(state.calls.length >= 2, 'The 30-second cadence replaces stale data without a manual refresh');
    await state.context.close();
  });
  await test('Disabling cancels an in-flight rail load; re-enabling refetches immediately', async () => {
    const state = await create('mtr', call => call === 1 ? 'hold' : 'complete');
    await state.toggle.evaluate(element => element.click());
    await state.page.clock.fastForward(30000);
    assert.equal(state.calls.length, 1, 'A disabled layer neither polls nor duplicates the held request');
    await state.held[0].route.abort().catch(() => {});
    await state.toggle.evaluate(element => element.click());
    await until(() => state.calls.length === 2);
    await until(async () => (await state.page.locator('.vehicle-marker.rail-marker').count()) === 1);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  for (const language of ['en', 'zh']) {
    await test(`${language}: rail station and train native delayed hover includes source time and ETA`, async () => {
      const { page, context } = await create('mtr', () => 'complete', language);
      const station = page.locator('[data-marker-id="mtr-ADM"]');
      const train = page.locator('.vehicle-marker.rail-marker');
      await station.waitFor({ state: 'attached' });
      await train.waitFor({ state: 'attached' });
      for (const marker of [station, train]) {
        const title = await marker.getAttribute('title');
        assert.equal(await marker.getAttribute('aria-label'), title);
        assert.equal(title.split('\n').length, 3);
        assert.match(title, language === 'en' ? /^Admiralty\nNext train ETA:.*\nRecord updated:/ : /^金鐘\n下一班列車預計到站:.*\n記錄更新:/);
        assert.ok(!title.includes(language === 'en' ? 'Source time unavailable' : '來源未提供更新時間'));
      }
      assert.equal(await page.locator('.leaflet-tooltip').count(), 0, 'Native delayed titles must replace instant rail tooltips');
      await context.close();
    });
  }
} finally {
  await fs.writeFile(path.join(evidence, 'rail-sync-results.json'), JSON.stringify(results, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}
if (results.some(result => !result.ok)) process.exitCode = 1;
