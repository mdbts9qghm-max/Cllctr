/*
 * Service Worker für Cllctr.
 *
 * Ziel ist nicht Geschwindigkeit, sondern Verfügbarkeit: Die App muss auch in
 * der Umkleide ohne Empfang aufgehen. Die Daten liegen ohnehin lokal in
 * IndexedDB — fehlt hier nur die Hülle, ist alles unerreichbar.
 *
 * Beim Anheben von VERSION werden alte Caches beim nächsten Start verworfen.
 */
const VERSION = 'cllctr-v1';

/* Die Seiten, die offline verfügbar sein müssen. */
const CORE = [
  '/',
  '/plan',
  '/aufgaben',
  '/statistik',
  '/seelen',
  '/schicht',
  '/setup',
  '/daten',
  '/manifest.json',
  '/icon-192.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // Einzeln statt addAll: Ein fehlender Eintrag darf nicht die gesamte
      // Installation scheitern lassen.
      Promise.all(CORE.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Seitenaufrufe: erst das Netz, damit eine neue Version sofort ankommt;
   * ohne Empfang die zwischengespeicherte Seite, notfalls der Startbildschirm.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('/')) ?? Response.error()),
    );
    return;
  }

  /*
   * Gebaute Dateien tragen einen Hash im Namen und ändern sich nie —
   * hier ist der Cache immer richtig.
   */
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  /* Alles Übrige: aus dem Cache antworten und im Hintergrund erneuern. */
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
