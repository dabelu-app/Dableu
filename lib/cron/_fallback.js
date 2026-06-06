// Fallback מרכזי: כשאין למשתמש התראת Push (לא התקין אפליקציה / לא אישר התראות) —
// שולחים את ההתראה בוואטסאפ (אם יש מספר), ואחרת במייל.
const fetch      = require('node-fetch');
const nodemailer = require('nodemailer');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

async function getUserContact(userId) {
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userId}?key=${FIREBASE_API_KEY}`
    );
    const j = await r.json();
    const f = j.fields || {};
    return {
      chatId: f.chatId?.stringValue || '',
      email:  f.contactEmail?.stringValue || f.email?.stringValue || '',
      name:   f.name?.stringValue || ''
    };
  } catch (e) { return { chatId: '', email: '', name: '' }; }
}

async function sendWhatsApp(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  const digits   = String(chatId || '').replace(/[^\d]/g, '');
  if (!instance || !token || !digits) return false;
  try {
    await fetch(
      `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: digits + '@c.us', message }) }
    );
    return true;
  } catch (e) { return false; }
}

async function sendEmail(email, subject, body) {
  if (!email || !process.env.ZOHO_PASS) return false;
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
    });
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1e293b">
      ${(body || '').split('\n').map(l => l ? `<div>${l}</div>` : '<br>').join('')}
      <div style="margin-top:16px;color:#94a3b8;font-size:12px">Dabelu · <a href="https://dabelu.web.app" style="color:#94a3b8">dabelu.web.app</a></div>
    </div>`;
    await t.sendMail({ from: '"Dabelu" <tasks@dabelu.pro>', to: email, subject, html, text: body });
    return true;
  } catch (e) { return false; }
}

// נקרא כשאין Push: וואטסאפ קודם, אחרת מייל. מחזיר את הערוץ שנשלח.
async function fallbackNotify(userId, title, body) {
  const c = await getUserContact(userId);
  const msg = title + (body ? '\n\n' + body : '');
  if (c.chatId) { if (await sendWhatsApp(c.chatId, msg)) return 'whatsapp'; }
  if (c.email)  { if (await sendEmail(c.email, title, body || title)) return 'email'; }
  return 'none';
}

module.exports = { fallbackNotify };
