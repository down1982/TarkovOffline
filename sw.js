// EFT Tactical Offline Assistant - Service Worker
const CACHE_NAME = 'eft-offline-cache-v10';

const PRECACHE_URLS = [
  './',
  './index.html',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
  './css/style.css',
  './css/task-hideout.css',
  './js/custom-select.js',
  './js/app.js',
  './js/task-viewer.js',
  './js/hideout-viewer.js',
  './js/collection-viewer.js',
  './js/command-palette.js',
  './js/scanner-controller.js',
  './js/gdrive-sync.js',
  './data/tasks.json',
  './data/traders.json',
  './data/sections.json',
  './data/hideout.json',
  './data/collection.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching core offline assets...');
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip cross-origin requests (e.g., Google OAuth / Drive API) and backend API calls
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  const isCodeAsset =
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  // Network-first for HTML/CSS/JS so updates apply immediately, with offline cache fallback
  if (isCodeAsset) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Cache-first with background revalidation for static JSON & image assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
