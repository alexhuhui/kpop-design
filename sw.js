/* ===========================================================================
   Alex Designs — offline cache
   McMaster-Carr's repeat-visit trick, with no dependency: a second visit paints
   from disk instead of from the network.

   Two rules, one per kind of file:

   - An image URL carries ?v=<sha1>, so its bytes can never change under the
     same URL. Cache first, forever. These are nearly all of the bytes.
   - Everything else (the page, app.js, style.css, designs.json) can change on
     any deploy under the same URL. Network first, so a deploy is live on the
     next load; the cache only answers when the network does not.
   =========================================================================== */

'use strict';

// Bump to throw away every cached response on the next visit.
var CACHE = 'alex-designs-v1';

// About 80 designs at up to five files each. Past this, the oldest entries go,
// so an image replaced many times over cannot fill a phone.
var MAX_ENTRIES = 400;

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Cache.keys() is in insertion order, so the front of the list is the oldest.
function trim(cache) {
  return cache.keys().then(function (keys) {
    var extra = keys.length - MAX_ENTRIES;
    if (extra <= 0) return;
    return Promise.all(keys.slice(0, extra).map(function (k) { return cache.delete(k); }));
  });
}

function store(req, res) {
  // Only a complete, same-origin answer. An opaque or partial (206) response
  // would be replayed as if it were the whole file.
  if (!res || res.status !== 200 || res.type !== 'basic') return;
  var copy = res.clone();
  caches.open(CACHE).then(function (cache) {
    return cache.put(req, copy).then(function () { return trim(cache); });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) { store(req, res); return res; });
  });
}

function networkFirst(req) {
  return fetch(req)
    .then(function (res) { store(req, res); return res; })
    .catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        throw new Error('offline and not cached: ' + req.url);
      });
    });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // Never another origin. The page loads nothing from one, and this worker
  // should not start.
  if (url.origin !== self.location.origin) return;

  var versioned = url.pathname.indexOf('/images/_derived/') !== -1 && url.searchParams.has('v');
  e.respondWith(versioned ? cacheFirst(req) : networkFirst(req));
});
