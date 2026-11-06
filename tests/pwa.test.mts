import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker(base: string) {
  const listeners: Record<string, (event: { request?: unknown; respondWith?: (result: Promise<unknown>) => void; waitUntil?: (result: Promise<unknown>) => void }) => void> = {};
  const cached: string[] = [], removed: string[] = [];
  const offline = new Response('offline page');
  vm.runInNewContext(code, {
    URL, Response,
    self: { registration: { scope: base }, addEventListener: (name: string, callback: typeof listeners[string]) => { listeners[name] = callback; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      open: async () => ({ addAll: async (urls: string[]) => cached.push(...urls) }),
      keys: async () => ['unrelated', `hk-traffic-pwa:${new URL(base).pathname}:old`, 'hk-traffic-pwa:/other/:v1'],
      delete: async (name: string) => removed.push(name),
      match: async (url: string) => url === `${base}offline.html` ? offline : undefined,
    },
    fetch: async () => { throw new Error('offline'); },
  });
  return { listeners, cached, removed, offline };
}

for (const path of ['/', '/HKRTTrafficInfo/']) {
  test(`PWA navigation fallback and cache isolation under ${path}`, async () => {
    const base = `https://example.test${path}`, state = worker(base);
    let pending: Promise<unknown> | undefined;
    state.listeners.install({ waitUntil: promise => { pending = promise; } }); await pending;
    assert.equal(state.cached[0], `${base}offline.html`);
    assert.equal(state.cached.some(url => url.includes('/api/') || url.includes('tiles')), false);
    state.listeners.activate({ waitUntil: promise => { pending = promise; } }); await pending;
    assert.deepEqual(state.removed, [`hk-traffic-pwa:${path}:old`]);
    state.listeners.fetch({ request: { url: base, method: 'GET', mode: 'navigate' }, respondWith: promise => { pending = promise; } });
    assert.equal(await pending, state.offline);
    for (const url of [`${base}api/mtr`, `${base}_next/static/app.js`, 'https://www.als.gov.hk/lookup?q=test', 'https://tdcctv.data.one.gov.hk/H106F.JPG']) {
      let intercepted = false;
      state.listeners.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith: () => { intercepted = true; } });
      assert.equal(intercepted, false, url);
    }
    const manifest = JSON.parse(readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'));
    assert.equal(new URL(manifest.start_url, `${base}site.webmanifest`).href, base);
    assert.equal(new URL(manifest.scope, `${base}site.webmanifest`).href, base);
  });
}
