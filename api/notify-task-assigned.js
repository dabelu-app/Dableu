const fetch    = require('node-fetch');
const nodemailer = require('nodemailer');

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
  const body = await r.json();
  console.log('[sendWhatsApp] chatId:', chatId, 'status:', r.status, 'response:', JSON.stringify(body));
  // GreenAPI מחזיר HTTP 200 גם על שגיאות — צריך לבדוק את גוף התשובה
  if (!r.ok) throw new Error(`Green API HTTP error: ${r.status}`);
  if (body.idMessage) return body; // הצלחה — יש idMessage
  throw new Error(`Green API error: ${JSON.stringify(body)}`);
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

// ── שליחת מייל אמיתי לעובד ──
async function sendEmail(to, subject, htmlBody) {
  if (!to || !process.env.ZOHO_PASS) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
    });
    await transporter.sendMail({
      from: '"Dabelu Tasks" <tasks@dabelu.pro>',
      to,
      subject,
      html: htmlBody
    });
    console.log(`[notify-task-assigned] email sent to ${to}`);
    return true;
  } catch(e) {
    console.error('[notify-task-assigned] email error:', e.message);
    return false;
  }
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
    msgBody   = `📋 *תזכורת לביצוע משימה*\n\nשלום ${workerName || ''},\nתזכורת על משימה דחופה לביצוע:\n\n📝 *${taskTitle}*${dueLine}\n\n👤 מאת: ${employerName || 'המעסיק'}\n\nאנא טפל/י בהקדם ✅`;
    pushTitle = `📋 תזכורת: ${taskTitle}`;
    pushBody  = `תזכורת על משימה דחופה לביצוע — ${employerName || 'המעסיק'}`;
  } else {
    const action = isReassign ? 'הועברה אליך' : 'שובצה אליך';
    msgBody   = `📋 *משימה חדשה ${action}!*\n\n📝 ${taskTitle}${dueLine}\n👤 ${isReassign ? 'הועבר' : 'הוקצה'} על ידי: ${employerName || 'המעסיק'}\n\nפתח את האפליקציה לצפייה ✅`;
    pushTitle = `📋 משימה חדשה: ${taskTitle}`;
    pushBody  = `שובצה אליך על ידי ${employerName || 'המעסיק'}${dueDate ? ' · ' + fmtDate(dueDate) : ''}`;
  }

  // ── קבע ערוצי שליחה לפי העדפת העובד ──
  // notifyPref: 'whatsapp'=רק WA, 'email'=רק מייל, 'both'=שניהם
  const pref = notifyPref || (workerPhone ? 'whatsapp' : 'email');
  const doWA    = (pref === 'whatsapp' || pref === 'both') && !!workerPhone;
  const doEmail = (pref === 'email'    || pref === 'both') && !!workerEmail;

  console.log(`[notify-task-assigned] worker="${workerName}" pref="${pref}" doWA=${doWA} doEmail=${doEmail} isReminder=${!!isReminder}`);

  let waSent    = false;
  let emailSent = false;
  let pushSent  = 0;

  // ── שלח WhatsApp ──
  if (doWA) {
    const normalized = normalizePhone(workerPhone);
    if (normalized) {
      try {
        await sendWhatsApp(normalized + '@c.us', msgBody);
        waSent = true;
        console.log(`[notify-task-assigned] WA sent to ${normalized}`);
      } catch(e) {
        console.error('[notify-task-assigned] WA error:', e.message);
      }
    }
  }

  // ── שלח מייל אמיתי + Push ──
  if (doEmail && workerEmail) {
    // מייל HTML
    const emailSubject = isReminder ? `📋 תזכורת: ${taskTitle}` : `📋 משימה חדשה: ${taskTitle}`;
    const emailHtml = `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#6F4CFC">${isReminder ? '📋 תזכורת לביצוע משימה' : '📋 משימה חדשה'}</h2>
        <p style="font-size:16px">${msgBody.replace(/\n/g,'<br>').replace(/\*/g,'')}</p>
        <hr style="border:1px solid #eee;margin:20px 0"/>
        <p style="color:#888;font-size:12px">נשלח מ-Dabelu Task Manager</p>
      </div>`;
    emailSent = await sendEmail(workerEmail, emailSubject, emailHtml);

    // Push notification (בנוסף למייל)
    try {
      pushSent = await sendPushToEmail(workerEmail, pushTitle, pushBody);
    } catch(e) { console.error('[notify-task-assigned] Push error:', e.message); }
  }

  return res.status(200).json({ ok: true, waSent, emailSent, pushSent });
};
