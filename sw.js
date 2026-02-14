const CACHE_VERSION = 'blink-v5';
const PRECACHE_ASSETS = [
  'css/style.css',
  'js/main.js',
  'js/sync.js',
  'js/storage.js',
  'js/youtube.js',
  'manifest.json',
  'images/icon-192.png',
  'images/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Network-first for navigation (HTML pages) so reloads get fresh content
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Stale-while-revalidate for all other same-origin assets
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
