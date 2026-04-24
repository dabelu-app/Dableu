const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

async function sendWhatsAppReply(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chatId, message }) }
  );
}

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

async function sendReplyEmail(to, subject, taskTitle, status) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  let html, emailSubject;
  if (status === 'not_registered') {
    html = `<div dir="rtl" style="font-family:Arial,sans-serif"><p>❌ אינך מחובר לדבליו.</p><p>לפרטים נוספים צור קשר עמנו.</p></div>`;
    emailSubject = '❌ אינך מחובר לדבליו';
  } else if (status === true) {
    html = `<div dir="rtl" style="font-family:Arial,sans-serif"><p>✅ המשימה נוצרה בהצלחה!</p><p>📝 <strong>${taskTitle}</strong></p></div>`;
    emailSubject = `✅ משימה נוצרה: ${taskTitle}`;
  } else {
    html = `<div dir="rtl" style="font-family:Arial,sans-serif"><p>❌ לא ניתן היה ליצור את המשימה. נסה שנית.</p></div>`;
    emailSubject = '❌ שגיאה ביצירת משימה';
  }

  await transporter.sendMail({
    from: '"Dabelu" <tasks@dabelu.pro>',
    to,
    subject: emailSubject,
    html
  });
}

module.exports = async (req, res) => {
  const client = new ImapFlow({
    host: 'imappro.zoho.com',
    port: 993,
    secure: true,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS },
    logger: false
  });

  let processed = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // קרא מיילים שלא נקראו
      for await (const msg of client.fetch({ unseen: true }, { envelope: true, source: true })) {
        const parsed = await simpleParser(msg.source);
        const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        const fromName  = parsed.from?.value?.[0]?.name || fromEmail;
        const subject   = parsed.subject || '';
        const body      = (parsed.text || '').trim().split('\n')[0]; // שורה ראשונה מהגוף

        // נושא המייל = כותרת המשימה (או שורה ראשונה מהגוף)
        const taskTitle = subject || body;
        if (!taskTitle) continue;

        // בדוק אם השולח רשום
        const userDoc = await isRegisteredEmail(fromEmail);
        if (!userDoc) {
          await sendReplyEmail(fromEmail, '', '', 'not_registered');
          await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
          continue;
        }

        // חלץ את ה-userId מהמסמך
        const userId = userDoc.name?.split('/').pop() || '';

        // שמור משימה ב-Firestore מקושרת למשתמש
        const ok = await saveTask(taskTitle, fromName, 'email', userId);

        // שלח תשובה למייל
        await sendReplyEmail(fromEmail, subject, taskTitle, ok ? true : false);

        // שלח וואטסאפ אם יש chatId
        const chatId = userDoc.fields?.chatId?.stringValue;
        if (chatId) {
          const phone = chatId.startsWith('0') ? '972' + chatId.slice(1) : chatId;
          await sendWhatsAppReply(phone + '@c.us', ok
            ? `✅ התקבל מייל ונוצרה משימה!\n📝 ${taskTitle}`
            : '⚠️ התקבל מייל אך הייתה בעיה בשמירת המשימה.');
        }

        // סמן כנקרא
        await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
        processed++;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('Email check error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }

  return res.status(200).json({ ok: true, processed });
};
