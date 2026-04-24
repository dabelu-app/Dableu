const functions = require('firebase-functions');
const FormData  = require('form-data');
const fetch     = require('node-fetch');
const nodemailer = require('nodemailer');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT  = 'dabelu';
const SITE_URL          = 'https://cosmic-daifuku-4d8c28.netlify.app';

// ── helpers ──────────────────────────────────────────────────────────────────

async function sendWhatsAppReply(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    }
  );
}

async function isRegisteredUser(phone) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'chatId' },
              op: 'EQUAL',
              value: { stringValue: phone }
            }
          },
          limit: 1
        }
      })
    }
  );
  const data = await resp.json();
  return Array.isArray(data) && data.length > 0 && data[0].document;
}

// ── WhatsApp Webhook ──────────────────────────────────────────────────────────

exports.whatsappWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const body = req.body;
  if (!body || body.typeWebhook !== 'incomingMessageReceived')
    return res.status(200).send('ok');

  const { messageData, senderData } = body;
  const senderName = senderData?.senderName || senderData?.sender || 'לא ידוע';
  const chatId     = senderData?.chatId;
  const msgType    = messageData?.typeMessage;
  const phone      = chatId ? chatId.replace('@c.us', '').replace('@g.us', '') : '';

  // בדיקת רישום
  let isRegistered = false;
  try { isRegistered = !!(await isRegisteredUser(phone)); }
  catch (err) { console.error('User lookup error:', err); }

  if (!isRegistered) {
    if (chatId) {
      await sendWhatsAppReply(chatId,
        `❌ אינך מנוי במערכת Dabelu.\n\nלהרשמה לחץ כאן:\n${SITE_URL}`);
    }
    return res.status(200).send('not registered');
  }

  let taskTitle = '';
  try {
    if (msgType === 'textMessage') {
      taskTitle = messageData.textMessageData?.textMessage || '';

    } else if (['audioMessage','voiceMessage','pttMessage'].includes(msgType)) {
      const idMessage = body.idMessage;
      const instance  = process.env.GREENAPI_INSTANCE;
      const token     = process.env.GREENAPI_TOKEN;

      const dlResp = await fetch(
        `https://7107.api.greenapi.com/waInstance${instance}/downloadFile/${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, idMessage })
        }
      );
      const dlData   = await dlResp.json();
      const audioUrl = dlData.downloadUrl;
      if (!audioUrl) throw new Error('No audio URL');

      const audioResp   = await fetch(audioUrl);
      const audioBuffer = await audioResp.buffer();

      const form = new FormData();
      form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');
      form.append('language', 'he');

      const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}`, ...form.getHeaders() },
        body: form
      });
      const whisperData = await whisperResp.json();
      taskTitle = whisperData.text || '';

    } else {
      return res.status(200).send('unsupported type');
    }
  } catch (err) {
    console.error('Processing error:', err);
    if (chatId) await sendWhatsAppReply(chatId, '❌ שגיאה בעיבוד ההודעה. נסי שוב.');
    return res.status(200).send('error');
  }

  if (!taskTitle.trim()) return res.status(200).send('empty task');

  // שמירה ב-Firestore
  let firestoreOk = false;
  try {
    const now = new Date().toISOString();
    const fsResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/tasks?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            title:       { stringValue: taskTitle.trim() },
            clientName:  { stringValue: senderName },
            source:      { stringValue: msgType === 'textMessage' ? 'whatsapp-text' : 'whatsapp-voice' },
            status:      { stringValue: 'pending' },
            priority:    { stringValue: 'normal' },
            createdAt:   { stringValue: now },
            description: { stringValue: msgType !== 'textMessage' ? '🎤 תומלל מהודעה קולית' : '' }
          }
        })
      }
    );
    firestoreOk = fsResp.ok;
    if (!fsResp.ok) console.error('Firestore error:', await fsResp.json());
  } catch (err) { console.error('Firestore error:', err); }

  if (chatId) {
    await sendWhatsAppReply(chatId, firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!\n📝 "${taskTitle.trim()}"`
      : '⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה.');
  }

  return res.status(200).json({ ok: true, task: taskTitle });
});

// ── Send Welcome Email ────────────────────────────────────────────────────────

exports.sendWelcome = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { name, email, password, siteUrl } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 587,
    secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px">
      <h1 style="color:#4CAF50;text-align:center">ברוכים הבאים ל-Dabelu! 🎉</h1>
      <p style="font-size:18px">שלום <strong>${name}</strong>,</p>
      <p>נוצר לך חשבון במערכת ניהול המשימות של Dabelu.</p>
      <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
        <p><strong>📧 מייל:</strong> ${email}</p>
        <p><strong>🔑 סיסמה:</strong> ${password}</p>
        <p><strong>🌐 קישור:</strong> <a href="${siteUrl}">${siteUrl}</a></p>
      </div>
      <p style="color:#888;font-size:12px">מייל זה נשלח אוטומטית ממערכת Dabelu</p>
    </div>`;

  try {
    await transporter.sendMail({
      from: '"Dabelu" <tasks@dabelu.pro>',
      to: email,
      subject: `ברוכים הבאים ל-Dabelu, ${name}! 🎉`,
      html
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
