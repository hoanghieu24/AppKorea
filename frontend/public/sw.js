const CACHE = 'hanquoc-classroom-v3-production';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network-first để người dùng nhận bản deploy mới. Chỉ fallback HTML cho navigation,
  // không trả index.html cho JS/CSS vì sẽ gây lỗi MIME khi offline.
  event.respondWith(
    fetch(event.request).catch(async () => {
      const exact = await caches.match(event.request);
      if (exact) return exact;
      if (event.request.mode === 'navigate') return caches.match('/');
      return Response.error();
    }),
  );
});
