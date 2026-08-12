/* Persona service worker — offline caching + notification clicks */
const CACHE = 'persona-v25-fixed-mobile-nav';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './alarm.js',
  './chat.js',
  './geo.js',
  './memory.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* App shell network-first: phone PWA te purono CSS/JS cache dhore scroll bug rekhe dito. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  const isAppAsset = url.origin === location.origin &&
    (url.pathname === '/' ||
     url.pathname.endsWith('.html') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.json'));

  if (isAppAsset || e.request.url.includes('/fonts/')) {
    e.respondWith(
      fetch(e.request).then(resp =>
        caches.open(CACHE).then(c => { c.put(e.request, resp.clone()); return resp; })
      ).catch(() => caches.match(e.request).then(cached => cached || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then(resp => {
        // Dynamically cache new assets (icons, etc)
        return caches.open(CACHE).then(c => { c.put(e.request, resp.clone()); return resp; });
      }).catch(() => caches.match('./'))
    )
  );
});

/* Notification e click korle app-e niye ashe — ar kon task ta bajlo shetao pathai,
   jate app khulei alarm screen ta dekhay. */
self.addEventListener('notificationclick', (e) => {
  const taskId = e.notification.data && e.notification.data.taskId;
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { c.postMessage({ type: 'alarm-click', taskId }); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow('./?alarm=' + (taskId || ''));
    })
  );
});
