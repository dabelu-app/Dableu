const FormData = require('form-data');
const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT  = 'dabelu';
const SITE_URL          = 'https://cosmic-daifuku-4d8c28.netlify.app';

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  if (body.typeWebhook !== 'incomingMessageReceived') return { statusCode: 200, body: 'ok' };

  const { messageData, senderData } = body;
  const senderName = senderData?.senderName || senderData?.sender || 'לא ידוע';
  const chatId     = senderData?.chatId;
  const msgType    = messageData?.typeMessage;

  // חילוץ מספר טלפון ממזהה הצ'אט (972501234567@c.us → 972501234567)
  const phone = chatId ? chatId.replace('@c.us', '').replace('@g.us', '') : '';

  // בדיקה אם המספר רשום במערכת
  let isRegistered = false;
  try {
    isRegistered = !!(await isRegisteredUser(phone));
  } catch (err) {
    console.error('User lookup error:', err);
  }

  if (!isRegistered) {
    if (chatId) {
      await sendWhatsAppReply(
        chatId,
        `❌ אינך מנוי במערכת Dabelu.\n\nלהרשמה לחץ כאן:\n${SITE_URL}`
      );
    }
    return { statusCode: 200, body: 'not registered' };
  }

  let taskTitle = '';

  try {
    if (msgType === 'textMessage') {
      taskTitle = messageData.textMessageData?.textMessage || '';

    } else if (msgType === 'audioMessage' || msgType === 'voiceMessage' || msgType === 'pttMessage') {
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
      const dlData = await dlResp.json();
      const audioUrl = dlData.downloadUrl;

      if (!audioUrl) throw new Error('No audio URL from Green API');

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
      return { statusCode: 200, body: 'unsupported message type' };
    }
  } catch (err) {
    console.error('Processing error:', err);
    if (chatId) await sendWhatsAppReply(chatId, '❌ אירעה שגיאה בעיבוד ההודעה. נסי שוב.');
    return { statusCode: 200, body: 'error processing message' };
  }

  if (!taskTitle.trim()) return { statusCode: 200, body: 'empty task' };

  // שמירת משימה ב-Firestore
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
    if (fsResp.ok) {
      firestoreOk = true;
      console.log('Task created:', taskTitle);
    } else {
      const fsErr = await fsResp.json();
      console.error('Firestore error response:', JSON.stringify(fsErr));
    }
  } catch (err) {
    console.error('Firestore error:', err);
  }

  if (chatId) {
    const confirmMsg = firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!\n📝 "${taskTitle.trim()}"`
      : `⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה. פנה למנהל.`;
    await sendWhatsAppReply(chatId, confirmMsg);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, task: taskTitle }) };
};
