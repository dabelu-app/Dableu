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

  const dueLine = dueDate ? `\n◷ *תאריך יעד:* ${fmtDate(dueDate)}` : '';

  // ── בנה גוף ההודעה לפי סוג ──
  // סמלי Unicode נקיים (ללא emoji צבעוניים):
  // ◻ משימה  ◷ תאריך  ◌ שולח  ◈ Dabelu  ─── מפריד
  let msgBody, pushTitle, pushBody;
  if (isReminder) {
    msgBody   = `*─── תזכורת לביצוע משימה ───*\n\nשלום ${workerName || ''},\n\n◻ *משימה:* ${taskTitle}${dueLine}\n◌ *מאת:* ${employerName || 'המעסיק'}\n\n_אנא טפל/י בהקדם ועדכן/י סטטוס באפליקציה_\n\n◈ _Dabelu Task Manager_`;
    pushTitle = `תזכורת: ${taskTitle}`;
    pushBody  = `תזכורת על משימה דחופה לביצוע — ${employerName || 'המעסיק'}`;
  } else {
    const action = isReassign ? 'הועברה אליך' : 'שובצה אליך';
    msgBody   = `*─── משימה ${action} ───*\n\n◻ *משימה:* ${taskTitle}${dueLine}\n◌ *מאת:* ${employerName || 'המעסיק'}\n\n_פתח/י את האפליקציה לצפייה ועדכון_\n\n◈ _Dabelu Task Manager_`;
    pushTitle = `משימה חדשה: ${taskTitle}`;
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

    // SVG outline icons (black, no fill) — Outlook safe via <img alt>
    const svgTask   = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6F4CFC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>`;
    const svgCalendar = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const svgUser   = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const svgCheck  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F4CFC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const svgBell   = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6F4CFC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

    const headerIcon = isReminder ? svgBell : svgTask;
    const headerText = isReminder ? 'תזכורת לביצוע משימה' : (isReassign ? 'משימה הועברה אליך' : 'משימה חדשה');
    const duePart   = dueDate ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0"><table><tr><td style="padding-left:10px">${svgCalendar}</td><td style="padding-right:10px;color:#555;font-size:14px">תאריך יעד: <strong>${fmtDate(dueDate)}</strong></td></tr></table></td></tr>` : '';

    const emailHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f8fb;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fb;padding:30px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.07);overflow:hidden">
        <!-- Header -->
        <tr><td style="background:#6F4CFC;padding:24px 30px">
          <table><tr>
            <td style="vertical-align:middle">${headerIcon.replace(/stroke="#6F4CFC"/g,'stroke="#fff"').replace(/stroke="#555"/g,'stroke="#fff"')}</td>
            <td style="padding-right:12px;color:#fff;font-size:20px;font-weight:700">${headerText}</td>
          </tr></table>
        </td></tr>
        <!-- Greeting -->
        <tr><td style="padding:24px 30px 10px;font-size:16px;color:#222">שלום <strong>${workerName || ''}</strong>,</td></tr>
        <tr><td style="padding:0 30px 20px;font-size:15px;color:#444">
          ${isReminder ? 'קיבלת תזכורת על משימה דחופה לביצוע:' : 'שובצה אליך משימה חדשה:'}
        </td></tr>
        <!-- Task card -->
        <tr><td style="padding:0 30px 24px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #e8e4ff;border-radius:10px;overflow:hidden">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #f0f0f0">
              <table><tr>
                <td style="padding-left:10px">${svgTask}</td>
                <td style="padding-right:10px;font-size:15px;font-weight:700;color:#222">${taskTitle}</td>
              </tr></table>
            </td></tr>
            ${duePart}
            <tr><td style="padding:8px 0">
              <table><tr>
                <td style="padding-left:10px">${svgUser}</td>
                <td style="padding-right:10px;color:#555;font-size:14px">מאת: <strong>${employerName || 'המעסיק'}</strong></td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:0 30px 28px">
          <table><tr>
            <td style="padding-left:8px">${svgCheck}</td>
            <td style="padding-right:8px;font-size:14px;color:#6F4CFC;font-weight:600">אנא טפל/י בהקדם ופתח/י את האפליקציה לעדכון סטטוס</td>
          </tr></table>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#fafafa;padding:14px 30px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center">נשלח מ-Dabelu Task Manager</p>
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
