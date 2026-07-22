/* Service worker for Sugarcane Farm Manager.
   Caches the app shell so it opens instantly and works offline after the first visit.
   Bump CACHE_NAME whenever index.html changes so old caches get cleared out. */
const CACHE_NAME = 'sugarcane-farm-v24';
const APP_SHELL = ['./', './index.html', './onboarding.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* App shell: cache-first, so the app itself always opens even with zero signal.
   Everything else (weather API, map tiles, CDN scripts): network-first, falling back
   to cache if offline, so data stays as fresh as possible when there IS a connection. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const isAppShell = APP_SHELL.some((path) => req.url.endsWith(path.replace('./', '')));

  if (isAppShell) {
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
