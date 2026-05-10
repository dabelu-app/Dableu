const CACHE_NAME = 'dabelu-v21';
const STATIC_ASSETS = [
  '/manifest.json',
  '/logo.png',
  '/icon-w.png',
  '/icon-w.svg',
  '/splash-icon.png'
];

// ── התקנה: שמור רק נכסים סטטיים (לא HTML!) ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(() => {})
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

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // דלג על בקשות חיצוניות
  if (
    url.hostname !== self.location.hostname ||
    url.pathname.startsWith('/api/') ||
    event.request.method !== 'GET'
  ) return;

  // HTML — תמיד מהרשת (אין קאש!) כדי לקבל עדכונים מייד
  if (url.pathname.endsWith('.html') || url.pathname === '/' || !url.pathname.includes('.')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/tax_manager_app.html')
      )
    );
    return;
  }

  // נכסים סטטיים (תמונות, SVG, manifest) — cache first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return resp;
      })
    )
  );
});

// ── Push notifications ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const notif = {
    id:    Date.now(),
    title: data.title || 'Dabelu',
    body:  data.body  || 'יש עדכונים חדשים',
    time:  new Date().toISOString(),
    read:  false
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(notif.title, {
        body:    notif.body,
        icon:    '/icon-w.png',
        badge:   '/icon-w.png',
        dir:     'rtl',
        lang:    'he',
        vibrate: [200, 100, 200],
        tag:     'dabelu-notification',
        requireInteraction: true,
        data:    { url: data.url || '/tax_manager_app.html' }
      }),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(allClients => {
        allClients.forEach(client => client.postMessage({ type: 'PUSH_RECEIVED', notif }));
      })
    ])
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
