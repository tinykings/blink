const CACHE_VERSION = 'blink-v11.11';
const PRECACHE_ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/sync.js',
  'js/storage.js',
  'js/youtube.js',
  'manifest.json',
  'images/icon-192.png',
  'images/icon-512.png'
];

const APP_SHELL_ASSETS = ['./', 'index.html'];

function cacheAppShell() {
  return APP_SHELL_ASSETS.reduce(
    (promise, asset) => promise.then((cached) => cached || caches.match(asset)),
    Promise.resolve(undefined)
  );
}

function recoverNavigation(fallbackResponse) {
  return cacheAppShell().then((cached) => cached || fallbackResponse || Response.error());
}

function isHtmlRequest(request) {
  return request.mode === 'navigate'
    || request.destination === 'document'
    || (request.headers.get('accept') || '').includes('text/html');
}

function isStaticAssetRequest(request, url) {
  return ['font', 'image', 'manifest', 'script', 'style', 'worker'].includes(request.destination)
    || PRECACHE_ASSETS.some((asset) => new URL(asset, location.href).pathname === url.pathname);
}

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
  if (event.request.method !== 'GET') return;

  // Network-first for navigations/documents/HTML so reloads get fresh content.
  // Fall back to the app shell for installed/offline launches.
  if (isHtmlRequest(event.request)) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
          return response;
        }
        return recoverNavigation(response);
      }).catch(() => caches.match(event.request).then((cached) => cached || recoverNavigation()))
    );
    return;
  }

  if (!isStaticAssetRequest(event.request, url)) return;

  // Stale-while-revalidate for same-origin static assets.
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
