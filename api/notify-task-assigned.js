const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

// ── Green API — שליחת הודעת WhatsApp ──
async function sendWhatsApp(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  if (!instance || !token) throw new Error('GREENAPI credentials missing');
  const r = await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    }
  );
  if (!r.ok) throw new Error(`Green API error: ${r.status}`);
  return r.json();
}

// ── נרמול מספר טלפון לפורמט 972XXXXXXXXX ──
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

// ── עיצוב תאריך YYYY-MM-DD → DD/MM/YYYY ──
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

// ── Push Notification לעובד לפי אימייל ──
async function sendPushToEmail(email, title, body) {
  if (!email) return 0;
  // id יחיד להתראה — מאחד subscriptions מרובים לאותה רשומה ב-bell
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email.toLowerCase() } } },
            limit: 1
          }
        })
      }
    );
    const docs = await r.json();
    if (!Array.isArray(docs) || !docs[0]?.document) return 0;
    const userId = docs[0].document.name.split('/').pop();

    const webpush = require('web-push');
    webpush.setVapidDetails('mailto:tasks@dabelu.pro', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

    const r2 = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'pushSubscriptions' }],
            where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
            limit: 10
          }
        })
      }
    );
    const subs = await r2.json();
    let sent = 0;
    for (const item of (Array.isArray(subs) ? subs : [])) {
      if (!item.document) continue;
      const f = item.document.fields;
      try {
        await webpush.sendNotification(
          { endpoint: f.endpoint?.stringValue, keys: JSON.parse(f.keys?.stringValue || '{}') },
          JSON.stringify({ id: notifId, title, body, url: '/tax_manager_app.html' })
        );
        sent++;
      } catch(e) {
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
  } catch(e) { console.error('sendPushToEmail error:', e); return 0; }
}

// ═══════════════════════════════════════════
// Handler ראשי
// ═══════════════════════════════════════════
module.exports = async (req, res) => {
  // CORS — האפליקציה רצה ב-dabelu.web.app וקוראת ל-API ב-dabelu.vercel.app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const {
    workerPhone,   // מספר טלפון העובד
    workerEmail,   // אימייל העובד (לפוש)
    workerName,    // שם העובד
    taskTitle,     // שם המשימה
    employerName,  // שם המעסיק
    dueDate,       // תאריך יעד (YYYY-MM-DD, אופציונלי)
    isReassign,    // true = העברה מעובד אחר, false/undefined = שיוך חדש
    isReminder,    // true = תזכורת דחופה (לא שיוך חדש)
    notifyPref     // 'whatsapp' | 'email' | 'both' — העדפת העובד
  } = req.body || {};

  if (!taskTitle || (!workerPhone && !workerEmail)) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const dueLine = dueDate ? `\n📅 תאריך יעד: ${fmtDate(dueDate)}` : '';

  // ── בנה גוף ההודעה לפי סוג ──
  let msgBody, pushTitle, pushBody;
  if (isReminder) {
    msgBody   = `🚨 *תזכורת דחופה!*\n\nשלום ${workerName || ''},\nהמשימה *"${taskTitle}"* טרם טופלה ודורשת טיפול מיידי!${dueLine}\n👤 מאת: ${employerName || 'המעסיק'}\n\nאנא עדכן סטטוס בהקדם ✅`;
    pushTitle = `🚨 תזכורת: ${taskTitle}`;
    pushBody  = `המשימה טרם טופלה — ${employerName || 'המעסיק'} ממתין לעדכון`;
  } else {
    const action = isReassign ? 'הועברה אליך' : 'שובצה אליך';
    msgBody   = `📋 *משימה חדשה ${action}!*\n\n📝 ${taskTitle}${dueLine}\n👤 ${isReassign ? 'הועבר' : 'הוקצה'} על ידי: ${employerName || 'המעסיק'}\n\nפתח את האפליקציה לצפייה ✅`;
    pushTitle = `📋 משימה חדשה: ${taskTitle}`;
    pushBody  = `שובצה אליך על ידי ${employerName || 'המעסיק'}${dueDate ? ' · ' + fmtDate(dueDate) : ''}`;
  }

  // ── קבע אם לשלוח WA / Push לפי העדפה ──
  // notifyPref: 'whatsapp'=רק WA, 'email'=רק Push, 'both'=שניהם, undefined=WA אם יש טלפון
  const pref = notifyPref || 'whatsapp';
  const sendWA   = (pref === 'whatsapp' || pref === 'both') && !!workerPhone;
  const sendPush = (pref === 'email'    || pref === 'both') && !!workerEmail;
  // fallback: אם אין העדפה ויש טלפון — שלח WA
  const sendWAFallback = !notifyPref && !!workerPhone;

  let waSent  = false;
  let pushSent = 0;

  // ── שלח WhatsApp ──
  if (sendWA || sendWAFallback) {
    const normalized = normalizePhone(workerPhone);
    console.log(`[notify-task-assigned] WA phone raw="${workerPhone}" normalized="${normalized}" isReminder=${!!isReminder}`);
    if (normalized) {
      try {
        await sendWhatsApp(normalized + '@c.us', msgBody);
        waSent = true;
        console.log(`[notify-task-assigned] WA sent to ${normalized}`);
      } catch(e) {
        console.error('[notify-task-assigned] WA error:', e.message);
      }
    } else {
      console.warn('[notify-task-assigned] phone normalization failed — skipping WA');
    }
  }

  // ── שלח Push Notification ──
  if (sendPush || (!notifyPref && !!workerEmail && !workerPhone)) {
    try {
      pushSent = await sendPushToEmail(workerEmail, pushTitle, pushBody);
      console.log(`[notify-task-assigned] Push sent: ${pushSent}`);
    } catch(e) {
      console.error('[notify-task-assigned] Push error:', e.message);
    }
  }

  return res.status(200).json({ ok: true, waSent, pushSent });
};
