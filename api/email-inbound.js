const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

async function isRegisteredEmail(email) {
  const emailLower = email.toLowerCase();

  // חיפוש לפי שדה email ראשי
  const query = async (fieldPath, value) => {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } },
            limit: 1
          }
        })
      }
    );
    const data = await resp.json();
    return Array.isArray(data) && data.length > 0 && data[0].document ? data[0].document : null;
  };

  // נסה קודם email ראשי, אחר כך altEmail (מייל חלופי)
  return (await query('email', emailLower)) || (await query('altEmail', emailLower));
}

async function saveTask(title, senderName, source, userId) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/tasks?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          title:       { stringValue: title.trim() },
          clientName:  { stringValue: senderName },
          source:      { stringValue: source },
          status:      { stringValue: 'pending' },
          priority:    { stringValue: 'normal' },
          createdAt:   { stringValue: new Date().toISOString() },
          description: { stringValue: '' },
          userId:      { stringValue: userId || '' }
        }
      })
    }
  );
  return resp.ok;
}

async function sendReplyEmail(to, taskTitle, status) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  const SITE_URL = 'https://cosmic-daifuku-4d8c28.netlify.app';
  const header = `
    <div style="background:#1a1a2e;padding:24px;text-align:center;border-radius:12px 12px 0 0">
      <img src="https://cosmic-daifuku-4d8c28.netlify.app/logo.png" alt="Dabelu" height="48" style="max-height:48px" onerror="this.style.display='none'"/>
      <h1 style="color:#ffffff;margin:8px 0 0;font-family:Arial,sans-serif;font-size:28px;letter-spacing:2px">DABELU</h1>
    </div>`;

  let html, subject;
  if (status === 'not_registered') {
    subject = '👋 קיבלנו את המייל שלך!';
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:32px;background:#fff;text-align:center">
        <p style="font-size:40px;margin:0">👋</p>
        <h2 style="color:#1a1a2e;margin:12px 0 8px">שלום! קיבלנו את המייל שלך</h2>
        <p style="color:#666;margin:0 0 8px">כתובת המייל שלך עדיין לא מחוברת לחשבון Dabelu.</p>
        <p style="color:#666;margin:0 0 24px">כדי ליצור משימות דרך מייל, פשוט התחבר לאפליקציה 😊</p>
        <a href="${SITE_URL}" style="background:#1a1a2e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;display:inline-block">כניסה לדבליו</a>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
  } else if (status === 'ok') {
    subject = `✅ משימה נוצרה: ${taskTitle}`;
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:32px;background:#fff;text-align:center">
        <p style="font-size:40px;margin:0">✅</p>
        <h2 style="color:#1a1a2e;margin:12px 0 8px">המשימה נוצרה בהצלחה!</h2>
        <div style="background:#f0f4ff;border-radius:8px;padding:16px;margin:16px 0;text-align:right">
          <span style="color:#666;font-size:13px">📝 משימה:</span>
          <p style="color:#1a1a2e;font-weight:bold;margin:4px 0 0;font-size:16px">${taskTitle}</p>
        </div>
        <a href="${SITE_URL}" style="background:#1a1a2e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;display:inline-block">פתח את Dabelu</a>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
  } else {
    subject = '❌ שגיאה ביצירת משימה';
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:32px;background:#fff;text-align:center">
        <p style="font-size:40px;margin:0">⚠️</p>
        <h2 style="color:#1a1a2e;margin:12px 0 8px">לא ניתן היה ליצור את המשימה</h2>
        <p style="color:#666">אנא נסה שנית מאוחר יותר.</p>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
  }

  await transporter.sendMail({ from: '"Dabelu" <tasks@dabelu.pro>', to, subject, html });
}

async function sendWhatsAppReply(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chatId, message }) }
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, message: 'Email webhook ready' });

  try {
    // קבל נתוני מייל מ-Zoho webhook או מפורמט אחר
    const body = req.body || {};
    const fromEmail = (body.from || body.sender || '').toLowerCase().replace(/.*<(.+)>/, '$1').trim();
    const fromName  = (body.fromName || body.from || fromEmail).replace(/<.*>/, '').trim();
    const subject   = body.subject || body.Subject || '';
    const text      = body.text || body.body || body.bodyPlain || '';
    const taskTitle = subject || text.split('\n')[0];

    if (!fromEmail || !taskTitle) {
      return res.status(200).json({ ok: false, message: 'Missing email or subject' });
    }

    // בדוק אם רשום
    const userDoc = await isRegisteredEmail(fromEmail);
    if (!userDoc) {
      await sendReplyEmail(fromEmail, '', 'not_registered');
      return res.status(200).json({ ok: true, registered: false });
    }

    const userId = userDoc.name?.split('/').pop() || '';
    const ok = await saveTask(taskTitle, fromName, 'email', userId);

    // שלח תגובה במייל בלבד (מקור מייל = תגובה במייל)
    await sendReplyEmail(fromEmail, taskTitle, ok ? 'ok' : 'error');

    return res.status(200).json({ ok, taskTitle });
  } catch (err) {
    console.error('Email inbound error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
