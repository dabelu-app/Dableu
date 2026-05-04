const fetch      = require('node-fetch');
const nodemailer = require('nodemailer');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

const PAYMENT_URLS = {
  basic:    'https://app.upay.co.il/API6/clientsecure/redirectpage.php?msg=cDRtRlFFS2FDMGRsSm5tT3R3ZWJ2SlpaSW1qNWdSK3dnT3ZSa2lNV0VsUHJYSHN2MUhIdzdiZi9Ed3NvODVXb0hkTU53eXlSdjlyeGxJSU93MWc2cE5kdHE5NXA2MzRKamFqZUszV0k0Y0J2K1hBU0o5ejBMSkdYOE5yZFNiN2t2Z2REcjFDK2hDcVBoREFpelgyaDM4ZnUrcTgvUTVjWGF6eTYyRExsck5aYkdPenBIWit0K2p3V0FJb09oeXc2YnB2WCtUZ2RtalphK2J5dDZrMmlPK2xOd0xhcDhUSmEyQTF0U1ZRTE9MbWFXUEc5TXBXUlR0anFQSHZiVW1yekxtRytNOFBGWE0rM2J3VFpyQWpxWWwrZFpMRVdqUCtKa2RGNnc0TUwwUTBoYnZkdlVIcE5JZnNObVNHWmpyNHhjdlBRZUVSQjMzb2VhVDh6dnRhSUJnPT0==',
  business: 'https://app.upay.co.il/API6/clientsecure/redirectpage.php?msg=cDRtRlFFS2FDMGRsSm5tT3R3ZWJ2RjB3RWwrWkM5Tjc4SnI4QmlXQjdYWndkdDdMTWhMa2FKT1RCamY1Ris0Q0l5Q3RBUEdaendONFp4d1hJOUVKZlB2ZURSdW96MnA0aFJHbCtvZmU0ZTZlS1daUG0yZjduMHVSSGlpcldURHRjQlcxd1FEcEE2SnovU2hPbExETUdDanNvMnV5UThsL1JlQmc4ZkU3THJ4RUFBRHd6ZWV2d3BlSm1hZ0NFejJONi9wcW1JcVRIWXNSZm43dm01Mk5FK3E3L0dWK1dVQitoSGw3WGlFUno0aWdRZzU4RHRLLzZiR0RteXhvL1ptK0RuU3UzWW80NlVoNVdhNmhtZkhHYUZsWlhPT0lMMXRoZFM5VWVZcS9oN2V6RDB3c3NIOTIyNUd6RHNnV1RSKzNFM005QWZOSnNBYmYxWEtIb3Q5dzZBPT0=='
};

// ── שלח וואטסאפ ──
async function sendWhatsApp(rawPhone, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  if (!instance || !token || !rawPhone) return;
  const digits = rawPhone.toString().replace(/[^\d]/g, '');
  if (!digits) return;
  const chatId = (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) + '@c.us';
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }) }
  );
}

// ── שלח מייל ──
async function sendEmail(to, name) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  const html = `
  <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff">
    <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe">
      <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:90px;max-width:280px;display:block;margin:0 auto">
    </div>
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:24px 28px;text-align:center">
      <h1 style="color:#fff;font-size:20px;margin:0">⏰ תקופת הניסיון שלך מסתיימת מחר</h1>
    </div>
    <div style="padding:28px">
    <p style="font-size:16px">שלום <strong>${name}</strong>,</p>
    <p style="font-size:15px;color:#374151">
      7 ימי הניסיון החינמי שלך ב-Dabelu מסתיימים <strong>מחר</strong>.<br>
      כדי להמשיך להשתמש במערכת — בחר/י מסלול תשלום:
    </p>
    <div style="display:flex;gap:16px;margin:28px 0;justify-content:center;flex-wrap:wrap">
      <a href="${PAYMENT_URLS.basic}"
         style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
        💼 Basic — 20₪/חודש
      </a>
      <a href="${PAYMENT_URLS.business}"
         style="background:#16a34a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
        🚀 Business — 50₪/חודש
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px;text-align:center">
      לאחר התשלום המנוי יופעל אוטומטית על החשבון הקיים שלך ✅
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
    <p style="color:#9ca3af;font-size:12px;text-align:center">
      שאלות? כתוב/י לנו: <a href="mailto:tasks@dabelu.pro">tasks@dabelu.pro</a>
    </p>
    </div>
    <div style="background:#f1f5f9;padding:14px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0">
      Dabelu · <a href="https://dabelu.web.app" style="color:#94a3b8">dabelu.web.app</a>
    </div>
  </div>`;

  await transporter.sendMail({
    from: '"Dabelu" <tasks@dabelu.pro>',
    to,
    subject: `⏰ ${name}, תקופת הניסיון שלך מסתיימת מחר`,
    html
  });
}

// ── סמן שנשלחה תזכורת ──
async function markReminderSent(uid) {
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}`
    + `?updateMask.fieldPaths=trialReminderSent&key=${FIREBASE_API_KEY}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { trialReminderSent: { booleanValue: true } } }) }
  );
}

module.exports = async (req, res) => {
  // חלון: נרשמו לפני 6–7 ימים (יום לפני הסיום)
  const now    = Date.now();
  const day6ago = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
  const day7ago = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users`
    + `?key=${FIREBASE_API_KEY}&pageSize=300`
  );
  const data = await resp.json();
  const docs = data.documents || [];

  let sent = 0;
  const errors = [];

  for (const doc of docs) {
    const f   = doc.fields || {};
    const sub = f.subscription?.stringValue || 'trial';
    // רק משתמשי ניסיון (subscription = trial או ריק)
    if (sub !== 'trial' && sub !== '') continue;

    const createdAt      = f.createdAt?.stringValue || '';
    const reminderSent   = f.trialReminderSent?.booleanValue || false;
    // נרשם בחלון 6–7 ימים, ותזכורת טרם נשלחה
    if (reminderSent)                              continue;
    if (!createdAt)                                continue;
    if (createdAt < day7ago || createdAt > day6ago) continue;

    const uid   = doc.name?.split('/').pop() || '';
    const name  = f.name?.stringValue  || 'לקוח';
    const email = f.email?.stringValue || '';
    const phone = f.phone?.stringValue || f.chatId?.stringValue || '';

    try {
      if (phone) {
        await sendWhatsApp(phone,
          `⏰ *שלום ${name}!*\n\n` +
          `תקופת הניסיון שלך ב-Dabelu מסתיימת *מחר*.\n\n` +
          `כדי להמשיך, בחר/י מסלול תשלום:\n\n` +
          `💼 *Basic — 20₪/חודש*\n${PAYMENT_URLS.basic}\n\n` +
          `🚀 *Business — 50₪/חודש*\n${PAYMENT_URLS.business}\n\n` +
          `לאחר התשלום המנוי יופעל אוטומטית על החשבון הקיים שלך ✅`
        );
      }
      if (email) {
        await sendEmail(email, name);
      }
      await markReminderSent(uid);
      sent++;
      console.log('trial reminder sent → uid:', uid, 'email:', email);
    } catch(e) {
      console.error('trial reminder error uid:', uid, e.message);
      errors.push({ uid, error: e.message });
    }
  }

  return res.status(200).json({ ok: true, sent, errors });
};
