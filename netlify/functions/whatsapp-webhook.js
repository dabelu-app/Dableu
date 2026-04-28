const FormData = require('form-data');
const fetch = require('node-fetch');

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

// ── Appointment detection with GPT ───────────────────────────────────────────

async function detectAppointment(text) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `אתה עוזר לזיהוי פגישות עבור יועצת מס ישראלית.
זהה אם ההודעה מבקשת לקבוע פגישה / מינוי / ישיבה.
אם כן — חלץ: שם לקוח, תאריך (YYYY-MM-DD), שעה (HH:MM).
תאריכים יחסיים ("מחר", "ביום רביעי") — תרגם לתאריך מוחלט. היום: ${today}.
החזר JSON בלבד:
{"isAppointment": boolean, "clientName": string|null, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null}`
          },
          { role: 'user', content: text }
        ],
        temperature: 0
      })
    });
    const data = await resp.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (err) {
    console.error('detectAppointment error:', err);
    return { isAppointment: false };
  }
}

// ── Hebrew date formatter ─────────────────────────────────────────────────────

function formatHebrewDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    const days   = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                    'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    return `יום ${days[d.getDay()]}, ${d.getDate()} ב${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return dateStr; }
}

// ── Save appointment to Firestore ─────────────────────────────────────────────

async function saveAppointmentToFirestore({ clientName, title, date, time, originalText }) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/appointments?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          clientName:   { stringValue: clientName  || '' },
          title:        { stringValue: title        || `פגישה עם ${clientName}` },
          date:         { stringValue: date         || '' },
          time:         { stringValue: time         || '' },
          notes:        { stringValue: originalText || '' },
          source:       { stringValue: 'whatsapp' },
          createdAt:    { stringValue: new Date().toISOString() }
        }
      })
    }
  );
  if (!resp.ok) {
    const err = await resp.json();
    console.error('saveAppointment Firestore error:', JSON.stringify(err));
  }
  return resp.ok;
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  if (body.typeWebhook !== 'incomingMessageReceived') return { statusCode: 200, body: 'ok' };

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
    return { statusCode: 200, body: 'not registered' };
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

  // ── זיהוי פגישה ──────────────────────────────────────────────────────────────
  let apptInfo = { isAppointment: false };
  try { apptInfo = await detectAppointment(taskTitle.trim()); }
  catch (err) { console.error('detectAppointment failed:', err); }

  if (apptInfo.isAppointment) {
    const clientName = apptInfo.clientName || senderName;

    // שמירה ב-appointments
    const apptOk = await saveAppointmentToFirestore({
      clientName,
      title:        `פגישה עם ${clientName}`,
      date:         apptInfo.date  || '',
      time:         apptInfo.time  || '',
      originalText: taskTitle.trim()
    });

    // גם שמירה ב-tasks כ-meeting
    try {
      const now = new Date().toISOString();
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/tasks?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              title:       { stringValue: `פגישה עם ${clientName}` },
              clientName:  { stringValue: clientName },
              type:        { stringValue: 'meeting' },
              source:      { stringValue: 'whatsapp' },
              status:      { stringValue: 'pending' },
              priority:    { stringValue: 'normal' },
              date:        { stringValue: apptInfo.date || '' },
              time:        { stringValue: apptInfo.time || '' },
              createdAt:   { stringValue: now },
              description: { stringValue: taskTitle.trim() }
            }
          })
        }
      );
    } catch (err) { console.error('task save error:', err); }

    if (chatId) {
      const dateHeb  = apptInfo.date ? formatHebrewDate(apptInfo.date) : '';
      const timeStr  = apptInfo.time ? ` בשעה ${apptInfo.time}` : '';
      await sendWhatsAppReply(chatId,
        apptOk
          ? `✅ הפגישה נקבעה!\nעם: ${clientName}\n${dateHeb}${timeStr}`
          : `⚠️ ההודעה התקבלה אך הייתה בעיה בשמירת הפגישה.`
      );
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, type: 'appointment', client: clientName }) };
  }

  // ── משימה רגילה ──────────────────────────────────────────────────────────────
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
    } else {
      const fsErr = await fsResp.json();
      console.error('Firestore error response:', JSON.stringify(fsErr));
    }
  } catch (err) { console.error('Firestore error:', err); }

  if (chatId) {
    await sendWhatsAppReply(chatId, firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!\n📝 "${taskTitle.trim()}"`
      : `⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה.`
    );
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, task: taskTitle }) };
};
