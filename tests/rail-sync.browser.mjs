// With dev running: node tests/rail-sync.browser.mjs [baseURL] [evidenceDir]
// PLAYWRIGHT_MODULE accepts a package or file URL; PLAYWRIGHT_CHANNEL defaults to chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
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
  let recording = false;
  await context.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/')[2];
    if (endpoint !== 'mtr' && endpoint !== 'lrt') return route.fulfill({ status: 503, body: 'Fixture: unrelated feeds unavailable' });
    const at = await page.evaluate(() => Date.now());
    const status = recording && endpoint === kind ? response(calls.push({ at, language: new URL(route.request().url()).searchParams.get('lang') })) : 'complete';
    if (status === 'hold') { held.push(route); return; }
    if (status === 'fail') return route.fulfill({ status: 503, body: 'Fixture: rail feed failed' });
    const observedAt = new Date(at - 60000).toISOString();
    const train = { id: 'fixture', line: 'TWL', dest: 'TSW', plat: '1', ttnt: 3, observedAt, delay: false, timeType: 'A', anchor: 'ADM', path: ['CEN', 'ADM', 'TST'], hold: ['CEN', 'ADM', 'TST'] };
    const boards = endpoint === 'mtr'
      ? [{ line: 'TWL', station: 'ADM', observedAt, message: '', trains: [{ dest: 'TSW', plat: '1', ttnt: 3, delay: false, timeType: 'A' }] }]
      : [{ station: '1', observedAt, calls: [{ route: '610', dest: '2', destTc: '兆康', destEn: 'Siu Hong', plat: '1', ttnt: 3, timeType: 'A' }] }];
    return route.fulfill({ json: { ok: true, complete: status !== 'incomplete', stale: status === 'stale', fetchedAt: new Date(at).toISOString(), observedAt, trains: endpoint === 'mtr' ? [train] : [], boards } });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?._loaded);
  await page.locator('.layer-card.mtr [role="switch"]').click();
  recording = true;
  await page.locator(`.layer-card.${kind} [role="switch"]`).click();
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
    await test(`${kind}: three startup retries, then normal polling recovers a cold network`, async () => {
      const state = await create(kind, call => call <= 4 ? 'incomplete' : 'complete');
      await state.card.locator('[role="alert"]').waitFor();
      await advance(state, 14000);
      assert.equal(state.calls.length, 1, `Regular polling must not duplicate a pending startup retry: ${JSON.stringify(state.calls)}`);
      await advance(state, 2000, 2);
      await advance(state, 16000, 3);
      await advance(state, 16000, 4);
      for (let index = 1; index < 4; index++) assert.ok(state.calls[index].at - state.calls[index - 1].at >= 16000, 'Startup retries must be spaced at least 16 seconds apart');
      await advance(state, 16000);
      assert.equal(state.calls.length, 4, 'Only the initial request and three extra startup retries are allowed');
      assert.equal(await state.card.locator('[role="alert"]').count(), 1, 'Incomplete coverage must remain visibly incomplete');
      await advance(state, 16000, 5);
      await state.card.locator('[role="alert"]').waitFor({ state: 'hidden' });
      await advance(state, 16000, 6);
      assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
      await state.context.close();
    });
  }
  await test('MTR HTTP failure retries and manual retry resets the bounded sequence', async () => {
    const state = await create('mtr', () => 'fail');
    await state.card.locator('[role="alert"]').waitFor();
    for (const expected of [2, 3, 4]) await advance(state, 16000, expected);
    await advance(state, 16000);
    assert.equal(state.calls.length, 4);
    await state.card.getByRole('button', { name: 'Retry', exact: true }).click();
    await until(() => state.calls.length === 5);
    await until(() => state.page.locator('.sidebar-footer > button').isEnabled());
    for (const expected of [6, 7, 8]) await advance(state, 16000, expected);
    await advance(state, 16000);
    assert.equal(state.calls.length, 8, 'Manual retry must permit three new extra retries');
    await state.toggle.click();
    await advance(state, 60000);
    assert.equal(state.calls.length, 8, 'Disabling must cancel polling and pending retry timers');
    await state.toggle.click();
    await until(() => state.calls.length === 9);
    await advance(state, 16000, 10);
    assert.deepEqual(await state.page.evaluate(() => window.__errors), []);
    await state.context.close();
  });
  await test('A complete retry ends startup retries and resumes regular polling', async () => {
    const state = await create('mtr', call => call === 1 ? 'stale' : 'complete');
    await state.card.locator('[role="alert"]').waitFor();
    await advance(state, 16000, 2);
    await state.card.locator('[role="alert"]').waitFor({ state: 'hidden' });
    await advance(state, 14000);
    assert.equal(state.calls.length, 2);
    await advance(state, 15000, 3);
    assert.ok(state.calls[2].at - state.calls[1].at >= 15000);
    await state.context.close();
  });
  await test('Disabling cancels an in-flight rail request and ignores a late response', async () => {
    const state = await create('mtr', call => call === 1 ? 'hold' : 'complete');
    await state.toggle.click();
    await advance(state, 60000);
    assert.equal(state.calls.length, 1);
    await state.held[0].fulfill({ json: { ok: true, complete: true, observedAt: new Date().toISOString(), trains: [], boards: [] } }).catch(() => {});
    await advance(state, 16000);
    assert.equal(state.calls.length, 1, 'The canceled completion must not schedule more retries');
    assert.equal(await state.page.locator('.vehicle-marker.rail-marker').count(), 0);
    await state.toggle.click();
    await until(() => state.calls.length === 2);
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
