const CACHE_NAME = 'dabelu-v50';
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

  // דלג על בקשות חיצוניות + נתיבי Firebase Auth (/__/auth/handler, iframe וכו')
  // ה-SW אסור שיחטוף את הנתיבים האלה — אחרת כניסה עם Google (signInWithRedirect) נשברת
  if (
    url.hostname !== self.location.hostname ||
    url.pathname.startsWith('/__/') ||
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

// ── שמור התראה ב-IndexedDB כדי שתופיע בפעמון גם אם האפליקציה סגורה ──
function storeNotifInIDB(notif) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('dabelu-notifs', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notifs')) {
          db.createObjectStore('notifs', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('notifs', 'readwrite');
        tx.objectStore('notifs').put(notif);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

// ── Push notifications ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const notif = {
    // אם השרת שלח id (כדי לאחד שני subscriptions של אותה התראה) — נשתמש בו.
    // אחרת נחזור על ברירת המחדל — Date.now().
    id:    data.id || Date.now(),
    title: data.title || 'Dabelu',
    body:  data.body  || 'יש עדכונים חדשים',
    time:  new Date().toISOString(),
    read:  false
  };
  // אייקון גדול לפי סוג ההתראה: משימה=וי, פגישה=יומן, תזכורת=פעמון (עיגול סגול)
  const ICONS = 'https://dabelu.web.app/icons/';
  let iconUrl;
  if (data.type === 'task')                                     iconUrl = ICONS + 'check-purple.png';
  else if (data.type === 'meeting' || data.type === 'appointment') iconUrl = ICONS + 'calendar-purple.png';
  else                                                          iconUrl = ICONS + 'bell-purple.png'; // reminder / ברירת מחדל
  // אייקון קטן (badge) — סגול, תואם לסוג
  const badgeUrl = iconUrl;
  const typeEmoji = data.type === 'reminder' ? '🔔' : data.type === 'task' ? '✅' : '';
  // הוסף אימוג'י רק אם הכותרת לא כבר מתחילה בסמל/אימוג'י (למנוע כפילות)
  const startsWithLetter = /^[\p{L}]/u.test((notif.title || '').trim());
  const displayTitle = (typeEmoji && startsWithLetter) ? typeEmoji + ' ' + notif.title : notif.title;

  event.waitUntil(
    Promise.all([
      storeNotifInIDB(notif),
      self.registration.showNotification(displayTitle, {
        body:    notif.body,
        icon:    iconUrl,
        badge:   badgeUrl,
        dir:     'rtl',
        lang:    'he',
        vibrate: [200, 100, 200],
        // tag ייחודי לכל התראה — כך התראות לא דורסות אחת את השנייה
        tag:     'dabelu-' + notif.id,
        // requireInteraction = true → התראה נשארת על המסך עד שהמשתמש לוחץ עליה
        requireInteraction: true,
        // renotify = true → כל התראה חדשה תרעיד ותצלצל גם אם יש דומות
        renotify: true,
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
