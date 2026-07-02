// ── CETPA Service Worker — Offline-first with stale-while-revalidate ─────────
// Version bump triggers cache refresh on deploy
const CACHE_VERSION = 'cetpa-v6';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// Assets that must be available offline immediately
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/cetpalogo.avif',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// ── Install: pre-cache critical shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET, our own /api/ (live data), and ANY cross-origin request.
  // SW only manages this origin's assets — third-party scripts (Google
  // Sign-In's apis.google.com/accounts.google.com, fonts.gstatic.com,
  // Firebase/Google APIs) must load natively so the browser applies the
  // page's script-src/connect-src CSP directly. A SW-mediated fetch() is
  // ALWAYS bound by connect-src regardless of resource type, so the old
  // per-domain googleapis.com skip-list silently let apis.google.com's
  // .js request fall through to the generic cache handler below, which
  // re-fetched it inside the SW and got CSP-blocked (connect-src lacked
  // apis.google.com) — breaking Google sign-in with auth/internal-error.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // HTML shell → NETWORK FIRST. Cache-first here is what broke every deploy:
  // the cached index.html kept referencing deleted chunk hashes forever.
  // Offline'da cache'e düşer; online'da her zaman taze index.html gelir.
  if (url.pathname === '/' || url.pathname === '/index.html' || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // Diğer shell varlıkları (ikon/manifest) → Cache First (içerikleri değişmez)
  if (PRECACHE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // JS/CSS chunks → Stale-While-Revalidate (fast loads, stays fresh)
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.avif') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.open(DYNAMIC_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(response => {
            // Zehirlenme koruması: .js isteğine HTML dönerse (eski sunucu SPA
            // fallback'i) ASLA cache'leme — yoksa bozuk yanıt kalıcılaşır.
            const ct = response.headers.get('content-type') || '';
            const isJsCss = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
            if (response.ok && !(isJsCss && ct.includes('text/html'))) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached); // offline fallback to cached version
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Everything else → Network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── Background Sync: queue offline writes for retry ──────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'cetpa-sync-queue') {
    event.waitUntil(
      // Notify the app to drain its pending sync queue
      self.clients.matchAll().then(clients =>
        clients.forEach(client =>
          client.postMessage({ type: 'DRAIN_SYNC_QUEUE' })
        )
      )
    );
  }
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'CETPA', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'cetpa-notification',
      renotify: false,
      data: data.url ? { url: data.url } : undefined,
      actions: data.actions || [],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── App messages (from main thread) ──────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    event.waitUntil(
      caches.open(DYNAMIC_CACHE).then(cache =>
        Promise.all(urls.map((u) => cache.add(u).catch(() => {})))
      )
    );
  }
});
