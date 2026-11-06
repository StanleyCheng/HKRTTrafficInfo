/* Only the offline page and app identity are cached. Live traffic is network-only. */
const scopeUrl = new URL(self.registration.scope);
const cachePrefix = `hk-traffic-pwa:${scopeUrl.pathname}:`;
const cacheName = `${cachePrefix}v1`;
const offlineUrl = new URL('offline.html', scopeUrl).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll([
    offlineUrl, new URL('app-icon-192.png', scopeUrl).href,
    new URL('app-icon-512.png', scopeUrl).href,
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;
  const path = url.pathname.slice(scopeUrl.pathname.length);
  if (path.startsWith('api/') || path.startsWith('_next/') || path.startsWith('assets/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(offlineUrl)) || Response.error()));
  } else if (['app-icon-192.png', 'app-icon-512.png'].includes(path)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
