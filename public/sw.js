const CACHE_NAME = 'dabelu-v2';
const APP_SHELL = [
  '/tax_manager_app.html',
  '/manifest.json',
  '/logo.png',
  'https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600&display=swap'
];

// ── התקנה: שמור app shell בקאש ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL).catch(() => {})
    )
  );
});

// ── הפעלה: נקה קאש ישן ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// ── קריאות רשת: cache-first לנכסים סטטיים, network-first לשאר ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // דלג על בקשות ל-API, Firebase, Firestore, חיצוני
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('greenapi') ||
    url.hostname.includes('groq') ||
    event.request.method !== 'GET'
  ) return;

  // נכסים סטטיים — cache first
  if (
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
      )
    );
    return;
  }

  // דף האפליקציה — network first, fallback לקאש
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return resp;
      })
      .catch(() => caches.match(event.request).then(c => c || caches.match('/tax_manager_app.html')))
  );
});

// ── Push notifications ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dabelu', {
      body:    data.body || 'יש עדכונים חדשים',
      icon:    '/logo.png',
      badge:   '/logo.png',
      dir:     'rtl',
      lang:    'he',
      vibrate: [200, 100, 200],
      tag:     'dabelu-notification',
      requireInteraction: false,
      data:    { url: data.url || '/tax_manager_app.html' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/tax_manager_app.html';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.url.includes('tax_manager_app') && 'focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});
