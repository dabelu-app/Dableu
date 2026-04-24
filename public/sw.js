self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Dabelu - תזכורת';
  const options = {
    body: data.body || 'יש משימות שמחכות לטיפול',
    icon: 'https://via.placeholder.com/192x192/4CAF50/ffffff?text=D',
    badge: 'https://via.placeholder.com/72x72/4CAF50/ffffff?text=D',
    dir: 'rtl',
    lang: 'he',
    vibrate: [200, 100, 200],
    tag: 'dabelu-reminder',
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'פתח משימות' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/tax_manager_app.html'));
});

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
