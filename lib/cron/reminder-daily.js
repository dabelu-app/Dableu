const fetch   = require('node-fetch');
const webpush = require('web-push');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

webpush.setVapidDetails(
  'mailto:tasks@dabelu.pro',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// נרמול טלפון לפורמט 972XXXXXXXXX
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

// מצא userId של תזכורת — מהשדה ישיר או דרך chatId
async function resolveUserId(fields) {
  const userId = fields.userId?.stringValue || '';
  if (userId) return userId;
  const chatId = normalizePhone(fields.chatId?.stringValue || '');
  if (!chatId) return null;
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: { fieldFilter: { field: { fieldPath: 'chatId' }, op: 'EQUAL', value: { stringValue: chatId } } },
            limit: 1
          }
        })
      }
    );
    const data = await r.json();
    if (Array.isArray(data) && data[0]?.document) {
      return data[0].document.name.split('/').pop();
    }
  } catch (e) {}
  return null;
}

// שלח Push לכל המכשירים של userId
async function sendPush(userId, title, body) {
  if (!userId) return 0;
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'pushSubscriptions' }],
            where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
            limit: 10
          }
        })
      }
    );
    const subs = await r.json();
    let sent = 0;
    for (const item of (Array.isArray(subs) ? subs : [])) {
      if (!item.document) continue;
      const f = item.document.fields;
      try {
        await webpush.sendNotification(
          { endpoint: f.endpoint?.stringValue, keys: JSON.parse(f.keys?.stringValue || '{}') },
          JSON.stringify({ id: notifId, type: 'reminder', title, body, url: '/tax_manager_app.html' })
        );
        sent++;
      } catch (e) {
        if (e.statusCode === 410) {
          const docId = item.document.name.split('/').pop();
          await fetch(
            `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/pushSubscriptions/${docId}?key=${FIREBASE_API_KEY}`,
            { method: 'DELETE' }
          ).catch(() => {});
        }
      }
    }
    return sent;
  } catch (e) { return 0; }
}

// ─────────────────────────────────────────────────────────────
// סיכום תזכורות בוקרי — כל בוקר: תזכורות להיום + תזכורות למחר
// ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const nowIL    = new Date(Date.now() + 3 * 60 * 60 * 1000); // ישראל UTC+3
  const today    = nowIL.toISOString().split('T')[0];
  const tomorrow = new Date(nowIL.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // שלוף את כל הפריטים בתאריך היום..מחר (טווח על שדה אחד — בלי צורך באינדקס מורכב)
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: today } } },
                { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL',    value: { stringValue: tomorrow } } }
              ]
            }
          }
        }
      })
    }
  );

  const data = await resp.json();
  const items = Array.isArray(data) ? data.filter(d => d.document) : [];

  // קבץ תזכורות לפי משתמש
  const byUser = {}; // userId -> { today: [], tomorrow: [] }
  for (const item of items) {
    const f = item.document.fields;
    if ((f.type?.stringValue || '') !== 'reminder') continue; // רק תזכורות
    const date  = f.date?.stringValue  || '';
    const title = f.title?.stringValue || 'תזכורת';
    const time  = f.time?.stringValue  || '';
    const userId = await resolveUserId(f);
    if (!userId) continue;
    if (!byUser[userId]) byUser[userId] = { today: [], tomorrow: [] };
    const label = time ? `${time} · ${title}` : title;
    if (date === today)         byUser[userId].today.push(label);
    else if (date === tomorrow) byUser[userId].tomorrow.push(label);
  }

  let notified = 0;
  for (const userId of Object.keys(byUser)) {
    const t  = byUser[userId].today;
    const tm = byUser[userId].tomorrow;
    if (!t.length && !tm.length) continue;

    const parts = [];
    if (t.length)  parts.push(`📅 היום:\n${t.join('\n')}`);
    if (tm.length) parts.push(`📆 מחר:\n${tm.join('\n')}`);
    const body  = parts.join('\n\n').slice(0, 800);
    const title = `🔔 ${t.length + tm.length} תזכורות · ${t.length} היום, ${tm.length} מחר`;
    const s = await sendPush(userId, title, body);
    if (s > 0) notified++;
  }

  return res.status(200).json({ ok: true, notified, totalReminders: items.length, today, tomorrow });
};
