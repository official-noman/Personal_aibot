/* Persona service worker — offline caching + notification clicks */
const CACHE = 'persona-v19';
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

/* Cache-first for app shell; network fallback for everything else. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  /* /api/* (Gemini proxy) kokhono cache ba shell-fallback kora jabe na —
     na hole net gele API error er bodole HTML shell ferot ashto. */
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).catch(() => caches.match('./'))
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
