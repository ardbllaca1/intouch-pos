const CACHE_NAME = 'intouch-pwa-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/index-sr.html',
  '/dashboard.html',
  '/dashboard-sr.html',
  '/admin.html',
  '/admin-sr.html',
  '/details.html',
  '/details-sr.html',
  '/kitchen.html',
  '/kitchen-sr.html',
  '/orders.html',
  '/orders-sr.html',
  '/pos.html',
  '/pos-sr.html',
  '/products.html',
  '/products-sr.html',
  '/tables.html',
  '/tables-sr.html',
  '/offline.html',
  '/offline-sr.html',
  '/manifest.webmanifest',
  '/pwa.js',
  '/icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/') || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => {
          if (cached) return cached;
          return caches.match(url.pathname.includes('-sr') ? '/offline-sr.html' : '/offline.html');
        }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        });
        return cached || network;
      })
    );
  }
});
