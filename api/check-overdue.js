const fetch    = require('node-fetch');
const webpush  = require('web-push');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';
const ADMIN_CHAT_ID    = '972502127441@c.us';

webpush.setVapidDetails(
  'mailto:tasks@dabelu.pro',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

async function firestoreQuery(body) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
  );
  return r.json();
}

async function sendWhatsApp(message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chatId: ADMIN_CHAT_ID, message }) }
  );
}

module.exports = async (req, res) => {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // שלוף משימות שלא טופלו מעל 48 שעות
  const taskDocs = await firestoreQuery({
    structuredQuery: {
      from: [{ collectionId: 'tasks' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
            { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { stringValue: cutoff } } }
          ]
        }
      },
      limit: 20
    }
  });

  const overdue = taskDocs.filter(d => d.document).map(d => d.document.fields?.title?.stringValue).filter(Boolean);
  if (overdue.length === 0) return res.status(200).json({ ok: true, message: 'אין משימות שלא טופלו' });

  const list = overdue.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const msgText = `⚠️ תזכורת — משימות שלא טופלו מעל 48 שעות:\n\n${list}`;

  // שלח וואטסאפ
  await sendWhatsApp(msgText);

  // שלח push notifications
  const subDocs = await firestoreQuery({
    structuredQuery: { from: [{ collectionId: 'pushSubscriptions' }], limit: 50 }
  });

  for (const d of subDocs) {
    if (!d.document) continue;
    const f = d.document.fields;
    try {
      await webpush.sendNotification(
        { endpoint: f.endpoint?.stringValue, keys: JSON.parse(f.keys?.stringValue || '{}') },
        JSON.stringify({ title: '⚠️ משימות ממתינות לטיפול', body: `${overdue.length} משימות לא טופלו מעל 48 שעות` })
      );
    } catch (e) { console.error('push failed:', e.message); }
  }

  return res.status(200).json({ ok: true, sent: overdue.length });
};
