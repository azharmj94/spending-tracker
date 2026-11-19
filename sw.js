/* Offline support for your own hosting (not used inside Claude).
 * App files: network first, saved copy when there is no internet.
 * Libraries from CDNs (fonts, PDF reader, receipt text reader, Firebase SDK): saved copy first.
 */
const CACHE = 'spending-tracker-v5';
const SHELL = ['./', 'index.html', 'app.js', 'store.js', 'report.js', 'firebase-config.js', 'vendor/pdf-lib.min.js', 'seed.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'vendor/ocr/tesseract.min.js', 'vendor/ocr/worker.min.js', 'vendor/ocr/tesseract-core-simd-lstm.wasm.js', 'vendor/ocr/tesseract-core-lstm.wasm.js', 'vendor/ocr/eng.traineddata.gz'];
const LIBS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin, lib = LIBS.includes(url.hostname);
  if (!own && !lib) return;
  const keep = (res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } return res; };
  if (lib) e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
  else e.respondWith(fetch(req).then(keep).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

/* Reminder notifications: tapping one opens the app on the month view. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
