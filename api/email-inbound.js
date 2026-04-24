const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

async function isRegisteredEmail(email) {
  const resp = await fetch(
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
  const data = await resp.json();
  return Array.isArray(data) && data.length > 0 && data[0].document ? data[0].document : null;
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

  let html, subject;
  if (status === 'not_registered') {
    html = `<div dir="rtl" style="font-family:Arial,sans-serif"><p>❌ אינך מחובר לדבליו.</p><p>לפרטים נוספים צור קשר עמנו.</p></div>`;
    subject = '❌ אינך מחובר לדבליו';
  } else if (status === 'ok') {
    html = `<div dir="rtl" style="font-family:Arial,sans-serif"><p>✅ המשימה נוצרה בהצלחה!</p><p>📝 <strong>${taskTitle}</strong></p></div>`;
    subject = `✅ משימה נוצרה: ${taskTitle}`;
  } else {
    html = `<div dir="rtl" style="font-family:Arial,sans-serif"><p>❌ לא ניתן היה ליצור את המשימה. נסה שנית.</p></div>`;
    subject = '❌ שגיאה ביצירת משימה';
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
