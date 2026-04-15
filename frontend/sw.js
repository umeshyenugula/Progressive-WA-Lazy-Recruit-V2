const CACHE_VERSION = 'crm-static-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/main.css',
  './css/login.css',
  './css/tables.css',
  './js/api.js',
  './js/utils.js',
  './js/sidebar.js',
  './admin/dashboard.html',
  './admin/candidates.html',
  './superadmin/dashboard.html',
  './superadmin/candidates.html',
  './superadmin/admins.html',
  './superadmin/domains.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then((res) => {
      if (!res || res.status !== 200 || res.type !== 'basic') return res;
      const copy = res.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
