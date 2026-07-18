// Minimal service worker - enables "Add to Home Screen" / PWA installability.
// Caching kept intentionally light since this app's data changes frequently.
const CACHE_NAME = 'fantasy-app-v1';
const STATIC_ASSETS = ['css/style.css', 'js/api.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first for API calls, cache-first for static assets
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
