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
async function sendPush(userId, title, body, type = 'reminder') {
  if (!userId) return 0;
  // id יחיד להתראה — מאחד subscriptions מרובים לאותה רשומה ב-bell
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
          JSON.stringify({ id: notifId, type, title, body, url: '/tax_manager_app.html' })
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

// פורמט שעה לתצוגה בעברית
function formatApptLine(fields) {
  const time   = fields.time?.stringValue  || '';
  const title  = fields.title?.stringValue || 'פגישה';
  const client = fields.clientName?.stringValue || '';
  const timeStr   = time   ? ` בשעה ${time}`   : '';
  const clientStr = client ? ` עם ${client}`    : '';
  return `${title}${clientStr}${timeStr}`;
}

module.exports = async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  let sent = 0;

  // ════════════════════════════════════════════════════════
  // חלק 1: סיכום פגישות להיום — שולחים לכל המשתמשים, גם אם ריק
  // ════════════════════════════════════════════════════════
  // שלוף כל המשתמשים
  const uResp  = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users?key=${FIREBASE_API_KEY}&pageSize=200`
  );
  const uData  = await uResp.json();
  const users  = (uData.documents || []).map(d => ({
    id:    d.name?.split('/').pop() || '',
    email: d.fields?.email?.stringValue || ''
  })).filter(u => u.id);

  // שלוף את כל הפגישות של היום
  const todayResp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: today } } }
        }
      })
    }
  );
  const todayData = await todayResp.json();
  const todayAppts = Array.isArray(todayData) ? todayData.filter(d => d.document) : [];

  // קבץ לפי userId — בנפרד פגישות ותזכורות (זוהה לפי שדה type)
  const apptsToday = {};
  const remindersToday = {};
  for (const item of todayAppts) {
    const f = item.document.fields;
    const uid = await resolveUserId(f);
    if (!uid) continue;
    const type = f.type?.stringValue || 'appointment';
    if (type === 'reminder') {
      if (!remindersToday[uid]) remindersToday[uid] = [];
      remindersToday[uid].push(formatApptLine(f));
    } else {
      if (!apptsToday[uid]) apptsToday[uid] = [];
      apptsToday[uid].push(formatApptLine(f));
    }
  }

  // לכל משתמש — שלח סיכום פגישות והתראה נפרדת לתזכורות (רק אם יש)
  for (const user of users) {
    const apptList = apptsToday[user.id] || [];
    const remList  = remindersToday[user.id] || [];

    if (apptList.length) {
      const title = `📋 פגישות להיום (${apptList.length})`;
      const body  = apptList.map((s, i) => `${i + 1}. ${s}`).join('\n').slice(0, 200);
      const pushSent = await sendPush(user.id, title, body, 'meeting');
      if (pushSent > 0) sent++;
    }

    if (remList.length) {
      const title = `🔔 תזכורות להיום (${remList.length})`;
      const body  = remList.map((s, i) => `${i + 1}. ${s}`).join('\n').slice(0, 200);
      const pushSent = await sendPush(user.id, title, body);
      if (pushSent > 0) sent++;
    }
  }

  // ════════════════════════════════════════════════════════
  // חלק 2: תזכורת על פגישות של מחר (רק אם יש — לא דורש סיכום ריק)
  // ════════════════════════════════════════════════════════
  const tomorrowResp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: tomorrowStr } } }
        }
      })
    }
  );

  const data = await tomorrowResp.json();
  const appointments = Array.isArray(data) ? data.filter(d => d.document) : [];

  for (const item of appointments) {
    const doc    = item.document;
    const fields = doc.fields;
    const docId  = doc.name.split('/').pop();

    // דלג אם תזכורת כבר נשלחה
    if (fields.reminderSent?.booleanValue === true) continue;

    const userId = await resolveUserId(fields);
    const pushTitle = '📅 תזכורת לפגישה מחר';
    const pushBody  = formatApptLine(fields);

    const pushSent = await sendPush(userId, pushTitle, pushBody, 'meeting');

    if (pushSent > 0 || userId) {
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

  return res.status(200).json({ ok: true, sent, todayTotal: todayAppts.length, tomorrowTotal: appointments.length });
};
