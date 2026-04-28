const FormData = require('form-data');
const fetch    = require('node-fetch');
const { google } = require('googleapis');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT  = 'dabelu';
const SITE_URL          = 'https://cosmic-daifuku-4d8c28.netlify.app';

// ───────────────────────────────────────────
// WhatsApp
// ───────────────────────────────────────────
async function sendWhatsAppReply(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chatId, message }) }
  );
}

// ───────────────────────────────────────────
// Firestore — משתמשים
// ───────────────────────────────────────────
async function queryFirestoreByChatId(phone) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ structuredQuery:{
        from:[{collectionId:'users'}],
        where:{ fieldFilter:{ field:{fieldPath:'chatId'}, op:'EQUAL', value:{stringValue:phone} }},
        limit:1
      }})
    }
  );
  const data = await resp.json();
  return Array.isArray(data) && data.length > 0 && data[0].document;
}

async function getUserDoc(phone) {
  let doc = await queryFirestoreByChatId(phone);
  if (doc) return doc;
  if (phone.startsWith('972')) { doc = await queryFirestoreByChatId('0'+phone.slice(3)); if (doc) return doc; }
  if (phone.startsWith('0'))   { doc = await queryFirestoreByChatId('972'+phone.slice(1)); if (doc) return doc; }
  return null;
}

async function patchUserField(docName, fieldName, value) {
  await fetch(
    `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=${fieldName}&key=${FIREBASE_API_KEY}`,
    { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields:{ [fieldName]:{ stringValue: value } } }) }
  );
}

async function setPending(docName, data) {
  await patchUserField(docName, 'pendingAppt', JSON.stringify(data));
}
async function clearPending(docName) {
  await patchUserField(docName, 'pendingAppt', '');
}

// ───────────────────────────────────────────
// לקוחות (clients collection)
// ───────────────────────────────────────────
async function getClients() {
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients?key=${FIREBASE_API_KEY}&pageSize=100`
    );
    const data = await resp.json();
    if (!data.documents) return [];
    return data.documents.map(doc => ({
      id:       doc.name.split('/').pop(),
      name:     doc.fields?.name?.stringValue     || '',
      email:    doc.fields?.email?.stringValue    || '',
      whatsapp: doc.fields?.whatsapp?.stringValue || ''
    })).filter(c => c.name);
  } catch(e) { return []; }
}

async function createClient(name, email, whatsapp) {
  try {
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients?key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fields:{
          name:      { stringValue: name      },
          email:     { stringValue: email     || '' },
          whatsapp:  { stringValue: whatsapp  || '' },
          createdAt: { stringValue: new Date().toISOString() }
        }})
      }
    );
  } catch(e) { console.error('createClient error:', e); }
}

function matchClient(clients, text) {
  const t = text.toLowerCase().trim();
  return clients.find(c =>
    c.name.toLowerCase().includes(t) || t.includes(c.name.split(' ')[0].toLowerCase())
  ) || null;
}

// חילוץ שם אדם מטקסט — מחזיר null אם זה ברכה/מילה שאינה שם
async function extractPersonName(text) {
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content:
`חלץ שם של אדם מהטקסט. החזר רק את השם בלבד, ללא הסברים.
אם הטקסט הוא ברכה, מילת פתיחה, מילה שאינה שם אדם, או שאין בו שם ברור — החזר: null

דוגמאות:
"דינה" → "דינה"
"יוסי כהן" → "יוסי כהן"
"עם רחל לוי" → "רחל לוי"
"שלום" → null
"היי" → null
"פגישה" → null
"כן" → null
"לא יודע" → null
"אברהם אבי" → "אברהם אבי"` },
          { role: 'user', content: text }
        ],
        max_tokens: 30,
        temperature: 0
      })
    });
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (!content || /^null$/i.test(content)) return null;
    return content;
  } catch(e) { return null; }
}

// ───────────────────────────────────────────
// סיווג הודעה (Groq)
// ───────────────────────────────────────────
async function classifyMessage(text) {
  const today = new Date().toLocaleDateString('he-IL', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.GROQ_KEY}`},
      body: JSON.stringify({
        model:'llama-3.1-8b-instant',
        messages:[
          { role:'system', content:
`היום הוא ${today}. אתה מסווג הודעות בעברית למשרד יעוץ מס.

קטגוריות:
- "appointment" - בקשה לפגישה / תור / להיפגש
- "task" - משימה, תזכורת, שאלה, בקשת פעולה
- "invalid" - הודעה חסרת משמעות, ניסוי, מילה אחת אקראית

סימני פגישה: פגישה, תור, נפגש, להיפגש, קבע, קביעת, מתי פנוי, אפשר לקבוע

החזר JSON בלבד:
{
  "intent": "appointment"|"task"|"invalid",
  "date": "YYYY-MM-DD"|null,
  "time": "HH:MM"|null,
  "with": "שם האדם שהפגישה איתו"|null,
  "title": "כותרת קצרה בעברית"
}

לפגישות: חלץ תאריך, שעה, ושם האדם שהפגישה איתו (אחרי "עם"). "מחר"=מחר, "שלישי"=שלישי הקרוב. null אם לא צוין.`
          },
          { role:'user', content:text }
        ],
        max_tokens:200, temperature:0
      })
    });
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '{}').trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch(err) { console.error('Classify error:', err); }
  return { intent:'task', date:null, time:null, title:text };
}

// ───────────────────────────────────────────
// Google Calendar
// ───────────────────────────────────────────
async function createCalendarEvent(title, date, time, clientName, calendarId, clientEmail) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/calendar'] });
    const calendar = google.calendar({ version:'v3', auth });
    calendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    const startTime = time || '09:00';
    const [h] = startTime.split(':').map(Number);
    const endTime = `${String(h+1).padStart(2,'0')}:00`;
    const attendees = clientEmail ? [{ email:clientEmail, displayName:clientName }] : [];
    const event = await calendar.events.insert({
      calendarId,
      sendUpdates: clientEmail ? 'all' : 'none',
      resource:{
        summary:`📋 ${title} — ${clientName}`,
        description:`פגישה שנקבעה דרך WhatsApp עם ${clientName}`,
        start:{ dateTime:`${date}T${startTime}:00`, timeZone:'Asia/Jerusalem' },
        end:  { dateTime:`${date}T${endTime}:00`,   timeZone:'Asia/Jerusalem' },
        attendees
      }
    });
    return event.data.id;
  } catch(err) { console.error('Calendar error:', err); return null; }
}

// ───────────────────────────────────────────
// Firestore — שמירת פגישה / משימה
// ───────────────────────────────────────────
async function saveAppointment(title, date, time, clientName, chatId, googleEventId) {
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/appointments?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields:{
        title:        {stringValue: title||''},
        date:         {stringValue: date||''},
        time:         {stringValue: time||''},
        clientName:   {stringValue: clientName},
        chatId:       {stringValue: chatId},
        googleEventId:{stringValue: googleEventId||''},
        status:       {stringValue: 'confirmed'},
        createdAt:    {stringValue: new Date().toISOString()},
        reminderSent: {booleanValue: false}
      }})
    }
  );
}

async function saveTask(title, clientName, source) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/tasks?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields:{
        title:      {stringValue: title.trim()},
        clientName: {stringValue: clientName},
        source:     {stringValue: source},
        status:     {stringValue: 'pending'},
        priority:   {stringValue: 'normal'},
        createdAt:  {stringValue: new Date().toISOString()},
        description:{stringValue: source!=='whatsapp-text' ? '🎤 תומלל מהודעה קולית' : ''}
      }})
    }
  );
  return resp.ok;
}

// ───────────────────────────────────────────
// סיום קביעת פגישה
// pending.withName  = שם הלקוח
// pending.withEmail = מייל הלקוח (לזימון)
// senderCalId       = יומן גוגל אישי של השולח (אם חובר)
// ───────────────────────────────────────────
async function finalizeAppointment(chatId, userDocName, pending, senderCalId) {
  await clearPending(userDocName);

  const apptWith  = pending.withName  || '';
  const apptEmail = pending.withEmail || '';

  let eventId = null;
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID) {
      // יומן דבליו מרכזי — תמיד
      eventId = await createCalendarEvent(
        pending.title, pending.date, pending.time||null,
        apptWith, process.env.GOOGLE_CALENDAR_ID, apptEmail
      );
      // יומן גוגל אישי של השולח — רק אם חיבר
      if (senderCalId) {
        await createCalendarEvent(
          pending.title, pending.date, pending.time||null,
          apptWith, senderCalId, apptEmail
        );
      }
    }
  } catch(e) { console.error('Calendar finalize error:', e); }

  await saveAppointment(pending.title, pending.date, pending.time||'', apptWith, chatId, eventId);

  const dateStr   = formatDateHebrew(pending.date);
  const timeStr   = pending.time ? ` בשעה ${pending.time}` : '';
  const inviteMsg = apptEmail ? `\n📧 זימון נשלח ל-${apptEmail}` : '';

  await sendWhatsAppReply(chatId,
    `✅ הפגישה נקבעה! 📆\n👤 עם: ${apptWith}\n📅 ${dateStr}${timeStr}${inviteMsg}\n\n🔔 תקבל תזכורת יום לפני!`
  );
}

function formatDateHebrew(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('he-IL', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

// ───────────────────────────────────────────
// עזר: אחרי שיש תאריך+שעה+שם — בדוק אם יש מייל
// אם כן → קבע. אם לא → שאל פרטי קשר.
// ───────────────────────────────────────────
async function tryFinalize(chatId, userDocName, pending, senderCalId, res) {
  if (pending.withEmail) {
    await finalizeAppointment(chatId, userDocName, pending, senderCalId);
  } else {
    await setPending(userDocName, { ...pending, step:'ask_contact', contactAskedAt: new Date().toISOString() });
    await sendWhatsAppReply(chatId,
      `👤 ${pending.withName}\n📅 ${formatDateHebrew(pending.date)}${pending.time?' בשעה '+pending.time:''}\n\nשלח פרטי קשר לזימון:\n📧 כתובת מייל\n📱 מספר ווצאפ\nאו "ללא זימון"`
    );
  }
  return res.status(200).send('ok');
}

// ───────────────────────────────────────────
// MAIN HANDLER
// ───────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const body = req.body;
  if (!body || body.typeWebhook !== 'incomingMessageReceived')
    return res.status(200).send('ok');

  const { messageData, senderData } = body;
  const senderName = senderData?.senderName || senderData?.sender || 'לא ידוע';
  const chatId     = senderData?.chatId;
  const msgType    = messageData?.typeMessage;
  const phone      = chatId ? chatId.replace('@c.us','').replace('@g.us','') : '';
  const inText     = msgType === 'textMessage' ? (messageData.textMessageData?.textMessage || '').trim() : '';

  // ── שלוף מסמך משתמש (כולל pending ו-calId) ──
  let userDoc = null;
  try { userDoc = await getUserDoc(phone); } catch(err) { console.error('getUserDoc:', err); }

  if (!userDoc) {
    if (chatId) await sendWhatsAppReply(chatId, `❌ אינך מנוי במערכת Dabelu.\n\nלהרשמה:\n${SITE_URL}`);
    return res.status(200).send('not registered');
  }

  const userDocName  = userDoc.name;
  const clientEmail  = userDoc.fields?.email?.stringValue  || '';
  const clientName   = userDoc.fields?.name?.stringValue   || senderName;
  const senderCalId  = userDoc.fields?.googleCalendarId?.stringValue || '';

  // ── pending מתוך מסמך המשתמש ──
  const pendingStr = userDoc.fields?.pendingAppt?.stringValue || '';
  let pending = null;
  if (pendingStr) { try { pending = JSON.parse(pendingStr); } catch(e) {} }

  // ── בדיקת פקיעת תוקף ask_contact (מעל שעה ללא תגובה) ──
  if (pending && pending.step === 'ask_contact' && pending.contactAskedAt) {
    const elapsed = Date.now() - new Date(pending.contactAskedAt).getTime();
    if (elapsed > 60 * 60 * 1000) { // שעה
      await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId);
      pending = null; // המשך עיבוד ההודעה הנוכחית כהודעה חדשה
    }
  }

  // ══════════════════════════════════════════
  // עיבוד שלבי קביעת פגישה
  // ══════════════════════════════════════════
  if (pending && inText) {

    // ── שלב: תאריך ──
    if (pending.step === 'ask_date') {
      const parsed = await classifyMessage(inText).catch(()=>null);
      if (!parsed?.date) {
        await sendWhatsAppReply(chatId, '⚠️ לא הצלחתי לזהות תאריך.\nנסה שוב, לדוגמה: "5/5" או "שלישי הקרוב"');
        return res.status(200).send('ok');
      }
      const upd = { ...pending, date: parsed.date, time: parsed.time || pending.time || '' };

      if (upd.date && upd.time && upd.withName) {
        return tryFinalize(chatId, userDocName, upd, senderCalId, res);
      }
      if (upd.date && upd.time && !upd.withName) {
        const clients = await getClients();
        const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
        await setPending(userDocName, { ...upd, step:'ask_with_whom' });
        await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(upd.date)} בשעה ${upd.time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
        return res.status(200).send('ok');
      }
      await setPending(userDocName, { ...upd, step:'ask_time' });
      await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(upd.date)} ✓\n\nבאיזו שעה? (לדוגמה: 14:00)`);
      return res.status(200).send('ok');
    }

    // ── שלב: שעה ──
    if (pending.step === 'ask_time') {
      const timeMatch = inText.match(/(\d{1,2})[:\.](\d{2})|^(\d{1,2})$/);
      if (!timeMatch) {
        await sendWhatsAppReply(chatId, '⚠️ לא זיהיתי שעה. נסה שוב, לדוגמה: "14:00" או "9"');
        return res.status(200).send('ok');
      }
      const raw = timeMatch[0].replace('.', ':');
      const parts = raw.includes(':') ? raw.split(':') : [raw, '00'];
      const time  = `${parts[0].padStart(2,'0')}:${(parts[1]||'00').padStart(2,'0')}`;
      const upd = { ...pending, time };

      if (upd.withName) {
        return tryFinalize(chatId, userDocName, upd, senderCalId, res);
      }
      const clients = await getClients();
      const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
      await setPending(userDocName, { ...upd, step:'ask_with_whom' });
      await sendWhatsAppReply(chatId, `🕐 שעה ${time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
      return res.status(200).send('ok');
    }

    // ── שלב: עם מי (חיפוש בלקוחות) ──
    if (pending.step === 'ask_with_whom') {
      const clients = await getClients();

      // שלב 1: חלץ שם אדם מהטקסט (לא להעתיק מילה במילה)
      const personName = await extractPersonName(inText);
      if (!personName) {
        const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
        await sendWhatsAppReply(chatId,
          `לא הבנתי שם לקוח.\nשלח שם של אדם (לדוגמה: "דינה" או "יוסי כהן")${list?'\n\nלקוחות קיימים:\n'+list:''}`
        );
        return res.status(200).send('ok');
      }

      // שלב 2: חפש את השם שחולץ ברשימת הלקוחות
      const matched = matchClient(clients, personName);

      if (!matched) {
        // לקוח חדש — שאל פרטי קשר
        await setPending(userDocName, { ...pending, step:'ask_contact', withName: personName, withEmail:'', contactAskedAt: new Date().toISOString() });
        await sendWhatsAppReply(chatId,
          `לא מצאתי לקוח בשם "${personName}" במערכת.\nלהוסיף לקוח חדש, שלח:\n📧 כתובת מייל לשליחת זימון\n📱 מספר ווצאפ לשליחת זימון\nאו "ללא זימון"`
        );
        return res.status(200).send('ok');
      }

      // לקוח קיים
      const upd = { ...pending, withName: matched.name, withEmail: matched.email || '' };
      if (matched.email) {
        await finalizeAppointment(chatId, userDocName, upd, senderCalId);
      } else {
        await setPending(userDocName, { ...upd, step:'ask_contact', contactAskedAt: new Date().toISOString() });
        await sendWhatsAppReply(chatId,
          `👤 ${matched.name} ✓\nאין פרטי קשר שמורים.\n\nשלח:\n📧 מייל לזימון\n📱 ווצאפ לזימון\nאו "ללא זימון"`
        );
      }
      return res.status(200).send('ok');
    }

    // ── שלב: פרטי קשר של לקוח (מייל / ווצאפ / ללא) ──
    if (pending.step === 'ask_contact') {
      const txt = inText.trim();

      // ללא זימון
      if (/^ללא(\s+זימון)?$|^לא$/i.test(txt)) {
        await createClient(pending.withName, '', '');
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId);
        return res.status(200).send('ok');
      }

      // מייל
      if (txt.includes('@') && txt.includes('.')) {
        const email = txt.toLowerCase();
        await createClient(pending.withName, email, '');
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail: email }, senderCalId);
        return res.status(200).send('ok');
      }

      // ווצאפ / טלפון
      const phoneClean = txt.replace(/[-\s+]/g, '');
      if (/^\d{9,12}$/.test(phoneClean)) {
        await createClient(pending.withName, '', phoneClean);
        // שלח הודעת ווצאפ ללקוח כזימון
        const waId = (phoneClean.startsWith('972') ? phoneClean : '972'+phoneClean.replace(/^0/,'')) + '@c.us';
        const dateStr = formatDateHebrew(pending.date);
        const timeStr = pending.time ? ` בשעה ${pending.time}` : '';
        await sendWhatsAppReply(waId,
          `📅 זימון לפגישה!\n\nנקבעה לך פגישה${timeStr}\n📋 ${pending.title||'פגישה'}\n${dateStr}\n\nנתראה! 👋`
        );
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId);
        return res.status(200).send('ok');
      }

      await sendWhatsAppReply(chatId, '⚠️ לא זיהיתי. שלח מייל, מספר ווצאפ, או "ללא זימון"');
      return res.status(200).send('ok');
    }

    // שלב לא מוכר — נקה
    await clearPending(userDocName);
    return res.status(200).send('ok');
  }

  // ══════════════════════════════════════════
  // הודעה חדשה (לא בתהליך פגישה)
  // ══════════════════════════════════════════
  let msgText = '';
  let source  = 'whatsapp-text';

  try {
    if (msgType === 'textMessage') {
      msgText = messageData.textMessageData?.textMessage || '';

    } else if (['audioMessage','voiceMessage','pttMessage'].includes(msgType)) {
      source = 'whatsapp-voice';
      const idMessage = body.idMessage;
      const instance  = process.env.GREENAPI_INSTANCE;
      const token     = process.env.GREENAPI_TOKEN;

      let audioUrl = messageData?.fileMessageData?.downloadUrl
                  || messageData?.pttMessageData?.downloadUrl || null;
      if (!audioUrl) {
        const dlResp = await fetch(
          `https://7107.api.greenapi.com/waInstance${instance}/downloadFile/${token}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ chatId, idMessage }) }
        );
        const dlData = await dlResp.json();
        audioUrl = dlData.downloadUrl;
        if (!audioUrl) throw new Error('downloadFile failed');
      }
      const audioResp   = await fetch(audioUrl);
      if (!audioResp.ok) throw new Error('Audio fetch failed: ' + audioResp.status);
      const audioBuffer = await audioResp.buffer();
      if (!audioBuffer || audioBuffer.length === 0) throw new Error('Empty audio buffer');

      const form = new FormData();
      form.append('file', audioBuffer, { filename:'voice.ogg', contentType:'audio/ogg' });
      form.append('model', 'whisper-large-v3');
      form.append('prompt', 'שמות ישראלים, עסקים, משימות עבודה, מינוחים פיננסיים, מונחי מס ומקדמות.');
      form.append('language', 'he');

      const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method:'POST',
        headers:{ Authorization:`Bearer ${process.env.GROQ_KEY}`, ...form.getHeaders() },
        body: form
      });
      const whisperData = await whisperResp.json();
      if (whisperData.error) throw new Error('Whisper error: ' + whisperData.error.message);
      msgText = whisperData.text || '';

    } else {
      return res.status(200).send('unsupported');
    }
  } catch(err) {
    console.error('Processing error:', err);
    if (chatId) await sendWhatsAppReply(chatId, '❌ שגיאה בעיבוד ההודעה.');
    return res.status(200).send('error');
  }

  if (!msgText.trim()) return res.status(200).send('empty');

  // ── סיווג ──
  let classified = { intent:'task', date:null, time:null, title:msgText };
  try { classified = await classifyMessage(msgText.trim()); }
  catch(err) { console.error('Classification error:', err); }

  const title = classified.title || msgText.trim();

  if (classified.intent === 'invalid') {
    if (chatId) await sendWhatsAppReply(chatId, '⚠️ הודעה אינה ברורה, נא שילחו שנית.');
    return res.status(200).send('unclear');
  }

  // ── פגישה ──
  if (classified.intent === 'appointment') {
    const apptTitle = title || 'פגישה';

    // נסה לזהות לקוח מהמשפט הראשון
    const clients = await getClients();
    let matchedClient = null;
    let withName = classified.with || '';
    if (withName) {
      matchedClient = matchClient(clients, withName);
      // אם לא נמצא — ודא שזה שם אדם אמיתי ולא מילה אחרת
      if (!matchedClient) {
        const verified = await extractPersonName(withName);
        withName = verified || ''; // אם לא שם — נשכח ונשאל בהמשך
      }
    }

    const hasDate  = !!classified.date;
    const hasTime  = !!classified.time;
    const hasWith  = !!withName;       // שם אדם אמיתי צוין בהודעה
    const hasMatch = !!matchedClient;  // נמצא ברשימת הלקוחות

    const knownWith = hasMatch
      ? { withName: matchedClient.name, withEmail: matchedClient.email || '' }
      : hasWith
        ? { withName: withName,          withEmail: '' }
        : { withName: '',                withEmail: '' };

    // ── הכל ידוע + לקוח נמצא ──
    if (hasDate && hasTime && hasMatch) {
      const upd = { date:classified.date, time:classified.time, title:apptTitle, ...knownWith };
      return tryFinalize(chatId, userDocName, upd, senderCalId, res);
    }

    // ── תאריך+שעה ידועים, שם צוין אבל לא נמצא ──
    if (hasDate && hasTime && hasWith && !hasMatch) {
      await setPending(userDocName, { step:'ask_contact', date:classified.date, time:classified.time, title:apptTitle, ...knownWith, contactAskedAt: new Date().toISOString() });
      await sendWhatsAppReply(chatId,
        `לא מצאתי לקוח בשם "${classified.with}" במערכת.\n\nשלח:\n📧 מייל לזימון\n📱 ווצאפ לזימון\nאו "ללא זימון"`
      );
      return res.status(200).send('ok');
    }

    if (!hasDate) {
      await setPending(userDocName, { step:'ask_date', title:apptTitle, ...knownWith });
      await sendWhatsAppReply(chatId, `📅 רוצה לקבוע פגישה!\n\nמתי? (תאריך ושעה)\nלדוגמה: "5/5 בשעה 14:00"`);
      return res.status(200).send('ok');
    }
    if (!hasTime) {
      await setPending(userDocName, { step:'ask_time', date:classified.date, title:apptTitle, ...knownWith });
      await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(classified.date)} ✓\n\nבאיזו שעה?`);
      return res.status(200).send('ok');
    }
    if (!hasWith) {
      await setPending(userDocName, { step:'ask_with_whom', date:classified.date, time:classified.time, title:apptTitle, withName:'', withEmail:'' });
      const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
      await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(classified.date)} בשעה ${classified.time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
      return res.status(200).send('ok');
    }
  }

  // ── משימה ──
  const firestoreOk = await saveTask(title, clientName, source);
  if (chatId) {
    await sendWhatsAppReply(chatId, firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!\n📝 ${title}`
      : '⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה.');
  }
  return res.status(200).json({ ok:true, type:'task', task:title });
};
