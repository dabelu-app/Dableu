const fetch    = require('node-fetch');

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
    const nodemailer = require('nodemailer');
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
    const emailSubject = isReminder ? `תזכורת: ${taskTitle}` : `משימה חדשה: ${taskTitle}`;

    // אייקוני outline בסגנון האפליקציה — base64 SVG ב-<img> (עובד ב-Gmail, Apple Mail)
    const img = (b64, alt) => `<img src="${b64}" width="22" height="22" alt="${alt}" style="vertical-align:middle;display:inline-block">`;
    const icoClipboard = img('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2RjRDRkMiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik05IDVIN2EyIDIgMCAwIDAtMiAydjEyYTIgMiAwIDAgMCAyIDJoMTBhMiAyIDAgMCAwIDItMlY3YTIgMiAwIDAgMC0yLTJoLTIiLz48cmVjdCB4PSI5IiB5PSIzIiB3aWR0aD0iNiIgaGVpZ2h0PSI0IiByeD0iMSIvPjxsaW5lIHgxPSI5IiB5MT0iMTIiIHgyPSIxNSIgeTI9IjEyIi8+PGxpbmUgeDE9IjkiIHkxPSIxNiIgeDI9IjEzIiB5Mj0iMTYiLz48L3N2Zz4=', '📋');
    const icoCal        = img('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4ODgiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjQiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiLz48bGluZSB4MT0iMTYiIHkxPSIyIiB4Mj0iMTYiIHkyPSI2Ii8+PGxpbmUgeDE9IjgiIHkxPSIyIiB4Mj0iOCIgeTI9IjYiLz48bGluZSB4MT0iMyIgeTE9IjEwIiB4Mj0iMjEiIHkyPSIxMCIvPjwvc3ZnPg==', '📅');
    const icoUser       = img('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4ODgiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMCAyMXYtMmE0IDQgMCAwIDAtNC00SDhhNCA0IDAgMCAwLTQgNHYyIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSI3IiByPSI0Ii8+PC9zdmc+', '👤');
    const icoCheck      = img('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2RjRDRkMiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cG9seWxpbmUgcG9pbnRzPSIyMCA2IDkgMTcgNCAxMiIvPjwvc3ZnPg==', '✓');
    const icoBellW      = img('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xOCA4QTYgNiAwIDAgMCA2IDhjMCA3LTMgOS0zIDloMThzLTMtMi0zLTkiLz48cGF0aCBkPSJNMTMuNzMgMjFhMiAyIDAgMCAxLTMuNDYgMCIvPjwvc3ZnPg==', '🔔');
    const icoTaskW      = img('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik05IDVIN2EyIDIgMCAwIDAtMiAydjEyYTIgMiAwIDAgMCAyIDJoMTBhMiAyIDAgMCAwIDItMlY3YTIgMiAwIDAgMC0yLTJoLTIiLz48cmVjdCB4PSI5IiB5PSIzIiB3aWR0aD0iNiIgaGVpZ2h0PSI0IiByeD0iMSIvPjxsaW5lIHgxPSI5IiB5MT0iMTIiIHgyPSIxNSIgeTI9IjEyIi8+PGxpbmUgeDE9IjkiIHkxPSIxNiIgeDI9IjEzIiB5Mj0iMTYiLz48L3N2Zz4=', '📋');

    // הגדרות ישנות (למניעת שגיאות)
    const icoTask = icoClipboard;

    const headerText = isReminder ? 'תזכורת לביצוע משימה' : (isReassign ? 'משימה הועברה אליך' : 'משימה חדשה');
    const headerIco  = isReminder ? icoBellW : icoTaskW;
    const duePart    = dueDate
      ? `<tr><td style="padding:10px 20px;border-bottom:1px solid #f3f0ff">
           <table cellpadding="0" cellspacing="0"><tr>
             <td style="padding-left:10px">${icoCal}</td>
             <td style="padding-right:10px;font-size:14px;color:#555">תאריך יעד:&nbsp;<strong>${fmtDate(dueDate)}</strong></td>
           </tr></table>
         </td></tr>` : '';

    const emailHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4fb;font-family:Arial,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f4fb" style="padding:32px 0">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border-radius:14px;border:1px solid #e8e4ff">

  <!-- כותרת -->
  <tr><td bgcolor="#6F4CFC" style="padding:22px 28px;border-radius:14px 14px 0 0">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">${headerIco.replace(/color:#6F4CFC/g,'color:#fff').replace(/border:1.5px solid #6F4CFC/g,'border:1.5px solid #fff')}</td>
      <td style="padding-right:12px;color:#ffffff;font-size:19px;font-weight:bold">&nbsp;${headerText}</td>
    </tr></table>
  </td></tr>

  <!-- פנייה -->
  <tr><td style="padding:22px 28px 8px;font-size:15px;color:#222">שלום <strong>${workerName || ''}</strong>,</td></tr>
  <tr><td style="padding:0 28px 18px;font-size:14px;color:#555">
    ${isReminder ? 'קיבלת תזכורת על משימה דחופה לביצוע:' : 'שובצה אליך משימה חדשה:'}
  </td></tr>

  <!-- כרטיס משימה -->
  <tr><td style="padding:0 28px 22px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #e8e4ff;border-radius:10px">
      <!-- שם משימה -->
      <tr><td style="padding:14px 18px;border-bottom:1px solid #f0eeff">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="padding-left:10px">${icoClipboard}</td>
          <td style="padding-right:10px;font-size:15px;font-weight:bold;color:#222">&nbsp;${taskTitle}</td>
        </tr></table>
      </td></tr>
      ${duePart}
      <!-- שולח -->
      <tr><td style="padding:12px 18px">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="padding-left:10px">${icoUser}</td>
          <td style="padding-right:10px;font-size:14px;color:#555">מאת:&nbsp;<strong>${employerName || 'המעסיק'}</strong></td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- קריאה לפעולה -->
  <tr><td style="padding:0 28px 26px">
    <table cellpadding="0" cellspacing="0"><tr>
      <td>${icoCheck}</td>
      <td style="padding-right:10px;font-size:14px;color:#6F4CFC;font-weight:bold">&nbsp;אנא טפל/י בהקדם ועדכן/י סטטוס באפליקציה</td>
    </tr></table>
  </td></tr>

  <!-- פוטר -->
  <tr><td bgcolor="#fafafa" style="padding:12px 28px;border-top:1px solid #f0eeff;border-radius:0 0 14px 14px">
    <p style="margin:0;font-size:11px;color:#bbb;text-align:center">נשלח מ-Dabelu Task Manager</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

    emailSent = await sendEmail(workerEmail, emailSubject, emailHtml);

    // Push notification (בנוסף למייל)
    try {
      pushSent = await sendPushToEmail(workerEmail, pushTitle, pushBody);
    } catch(e) { console.error('[notify-task-assigned] Push error:', e.message); }
  }

  return res.status(200).json({ ok: true, waSent, emailSent, pushSent });
};
