/* Miette — cache everything once, then never need the network again.
   The whole point: it opens in a Paris side street with no signal. */
const V = 'miette-v20';
const SHELL = [
  './', './index.html', './app.js', './i18n.js', './manifest.webmanifest',
  './data/paris.json', './data/places.json', './data/competitions.json', './data/streets.json', './data/awards.json',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts may or may not be reachable; serve whatever we have, refresh when we can
  const sameOrigin = url.origin === self.location.origin;
  const keep = res => {
    if (res && res.status === 200 && (sameOrigin || res.type === 'cors' || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(V).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  };
  // Our own files: ask the network first so an update lands on the next open, and
  // fall back to the cache the moment there is no signal — which is the whole point.
  if (sameOrigin) {
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req)));
    return;
  }
  // Fonts and the like: cache first, refreshed quietly behind the page.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)));
});
