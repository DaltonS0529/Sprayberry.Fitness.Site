const CACHE_NAME = 'sprayberry-app-shell-v1';
const SHELL_URLS = ['/tracker.html', '/coach.html', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Network-first for everything: always try to get fresh data/HTML, only
// fall back to the cached shell if the network request fails (offline).
// API calls to /.netlify/functions/* are never cached — they should just fail
// cleanly offline so the page's own error handling can show a message.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.pathname.indexOf('/.netlify/functions/') === 0) return;

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
