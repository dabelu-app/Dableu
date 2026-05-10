const fetch   = require('node-fetch');
const webpush = require('web-push');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

webpush.setVapidDetails(
  'mailto:tasks@dabelu.pro',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

// שלוף את userId של הפגישה — מהפגישה עצמה, או לפי chatId מאוסף users
async function resolveUserId(fields) {
  // פגישות שנוצרו מהאפליקציה — יש userId ישיר
  const userId = fields.userId?.stringValue || '';
  if (userId) return userId;

  // פגישות שנוצרו מ-WhatsApp — יש chatId, נחפש userId ב-users
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
  } catch(e) { console.error('resolveUserId error:', e); }
  return null;
}

// שלח Push Notification לכל המכשירים שרשומים תחת userId
async function sendPush(userId, title, body) {
  if (!userId) return 0;
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
          JSON.stringify({ title, body, url: '/tax_manager_app.html' })
        );
        sent++;
      } catch(e) {
        console.error('push send error:', e.message);
        // אם הסאבסקריפציה פגה — מחק אותה
        if (e.statusCode === 410) {
          const docId = item.document.name.split('/').pop();
          await fetch(
            `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/pushSubscriptions/${docId}?key=${FIREBASE_API_KEY}`,
            { method: 'DELETE' }
          );
        }
      }
    }
    return sent;
  } catch(e) {
    console.error('sendPush error:', e);
    return 0;
  }
}

module.exports = async (req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // שאיל פגישות למחר — לפי תאריך בלבד, נסנן reminderSent בקוד
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'EQUAL',
              value: { stringValue: tomorrowStr }
            }
          }
        }
      })
    }
  );

  const data = await resp.json();
  const appointments = Array.isArray(data) ? data.filter(d => d.document) : [];

  let sent = 0;
  for (const item of appointments) {
    const doc    = item.document;
    const fields = doc.fields;
    const docId  = doc.name.split('/').pop();

    // דלג אם תזכורת כבר נשלחה
    if (fields.reminderSent?.booleanValue === true) continue;

    const time   = fields.time?.stringValue  || '';
    const title  = fields.title?.stringValue || 'פגישה';
    const client = fields.clientName?.stringValue || '';

    // מצא את userId כדי לשלוח push
    const userId = await resolveUserId(fields);

    const timeStr   = time   ? ` בשעה ${time}`   : '';
    const clientStr = client ? ` עם ${client}`    : '';
    const pushTitle = '🔔 תזכורת לפגישה מחר';
    const pushBody  = `${title}${clientStr}${timeStr}`;

    const pushSent = await sendPush(userId, pushTitle, pushBody);

    if (pushSent > 0 || userId) {
      // סמן תזכורת כנשלחה
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/appointments/${docId}?updateMask.fieldPaths=reminderSent&key=${FIREBASE_API_KEY}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { reminderSent: { booleanValue: true } } })
        }
      );
      sent++;
    }
    console.log(`appointment ${docId}: userId=${userId}, pushSent=${pushSent}`);
  }

  return res.status(200).json({ ok: true, sent, total: appointments.length, date: tomorrowStr });
};
