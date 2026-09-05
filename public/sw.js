/*
 * Service Worker: die Hülle offline halten.
 *
 * Die Daten liegen ohnehin in IndexedDB — offline fehlt nur das Gerüst. Deshalb
 * "network first, cache als Rückfall": Wer online ist, bekommt die neue
 * Version, wer nicht, bekommt die letzte. Cache-first würde nach einem Deploy
 * tagelang die alte App ausliefern.
 */
const CACHE = 'cllctr-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match('/index.html')),
      ),
  );
});
