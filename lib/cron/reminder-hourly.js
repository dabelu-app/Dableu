const fetch   = require('node-fetch');
const webpush = require('web-push');
const { fallbackNotify } = require('./_fallback');
const { fsFetch } = require('../firestore');

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
    const r = await fsFetch(
      `:runQuery`,
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
  } catch(e) {}
  return null;
}

// שלח Push לכל המכשירים של userId
async function sendPush(userId, title, body, type = 'reminder', allowFallback = true) {
  if (!userId) return 0;
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  try {
    const r = await fsFetch(
      `:runQuery`,
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
          JSON.stringify({ id: notifId, type, title, body, url: '/tax_manager_app.html' })
        );
        sent++;
      } catch(e) {
        if (e.statusCode === 410) {
          const docId = item.document.name.split('/').pop();
          await fsFetch(
            `/pushSubscriptions/${docId}`,
            { method: 'DELETE' }
          ).catch(() => {});
        }
      }
    }
    if (sent === 0 && allowFallback) { try { await fallbackNotify(userId, title, body); } catch(e) {} }
    return sent;
  } catch(e) { return 0; }
}

module.exports = async (req, res) => {
  // עבודה ב-UTC. בישראל = UTC+3 (שעון קיץ). הקרון רץ ב-HH:00 UTC = (HH+3):00 IL.
  // נבדוק תזכורות שזמנן בטווח של 45-75 דקות מעכשיו (כדי לתפוס "שעה לפני")
  const nowUTC = new Date();
  const nowIL  = new Date(nowUTC.getTime() + 3 * 60 * 60 * 1000);
  const today  = nowIL.toISOString().split('T')[0];

  // עכשיו + 60 דקות (חלון "שעה לפני")
  const targetIL = new Date(nowIL.getTime() + 60 * 60 * 1000);
  // בלתי תלוי בדקות — נחשב את כל השעה הבאה (כל מי שזמנו בטווח של 45 עד 75 דקות)
  const targetHH = String(targetIL.getUTCHours()).padStart(2, '0');

  // שלוף את כל התזכורות (type='reminder') של היום עם שעה
  const resp = await fsFetch(
    `:runQuery`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: today } } }
        }
      })
    }
  );

  const data = await resp.json();
  const allRems = Array.isArray(data) ? data.filter(d => d.document) : [];

  // סנן רק תזכורות שזמנן בשעה הבאה (HH+1)
  const dueSoon = allRems.filter(d => {
    const time = d.document.fields?.time?.stringValue || '';
    if (!time) return false;
    const hh = time.split(':')[0];
    return hh === targetHH;
  });

  let sent = 0;
  for (const item of dueSoon) {
    const f = item.document.fields;
    const docId = item.document.name.split('/').pop();
    // דלג אם כבר שלחנו התראת "שעה לפני" לתזכורת הזו
    if (f.hourBeforeSent?.booleanValue === true) continue;

    const userId = await resolveUserId(f);
    const itemType   = f.type?.stringValue || 'appointment';
    const isReminder = itemType === 'reminder';
    const time   = f.time?.stringValue || '';
    const title  = f.title?.stringValue || (isReminder ? 'תזכורת' : 'פגישה');
    const client = f.clientName?.stringValue || '';

    // פגישה → "פגישה בעוד שעה"; תזכורת → "תזכורת בעוד שעה"
    const pushTitle = isReminder ? '⏰ תזכורת בעוד שעה' : '⏰ פגישה בעוד שעה';
    const pushBody  = isReminder
      ? `${title}${time ? ' בשעה ' + time : ''}`
      : `${time ? time + ' · ' : ''}${title}${client ? ' — ' + client : ''}`;

    const pushSent = await sendPush(userId, pushTitle, pushBody, isReminder ? 'reminder' : 'meeting');

    if (pushSent > 0 || userId) {
      // סמן שכבר נשלחה התראת "שעה לפני"
      await fsFetch(
        `/appointments/${docId}?updateMask.fieldPaths=hourBeforeSent`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { hourBeforeSent: { booleanValue: true } } })
        }
      );
      sent++;
    }
  }

  return res.status(200).json({ ok: true, sent, checked: allRems.length, targetHour: targetHH });
};
