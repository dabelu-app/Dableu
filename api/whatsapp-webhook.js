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

// חיפוש שם בעל עסק לפי מספר טלפון — מנסה waPhone ו-phone בנוסף ל-chatId
async function resolveOwnerName(phone, fallbackDoc, senderDisplayName) {
  // 1. שם מהמסמך שנמצא (chatId lookup)
  const fromDoc = fallbackDoc?.fields?.name?.stringValue || fallbackDoc?.fields?.officeName?.stringValue || '';
  console.log('[resolveOwnerName] phone:', phone, 'fromDoc:', fromDoc, 'senderDisplayName:', senderDisplayName);
  console.log('[resolveOwnerName] userDoc fields:', JSON.stringify(Object.keys(fallbackDoc?.fields || {})));
  if (fromDoc) return fromDoc;

  // 2. אם יש email במסמך — חפש משתמש רשום לפי email (מסמך הרשמה)
  const docEmail = fallbackDoc?.fields?.email?.stringValue || '';
  if (docEmail) {
    try {
      const r = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: docEmail.toLowerCase() } } },
            limit: 5
          }})
        }
      );
      const d = await r.json();
      console.log('[resolveOwnerName] email lookup result count:', Array.isArray(d) ? d.length : 'not array');
      if (Array.isArray(d)) {
        for (const item of d) {
          const n = item?.document?.fields?.name?.stringValue;
          if (n) { console.log('[resolveOwnerName] found by email:', n); return n; }
        }
      }
    } catch(e) { console.error('[resolveOwnerName] email lookup error:', e.message); }
  }

  // 3. חפש לפי waPhone / phone בכל הפורמטים
  const variants = [phone];
  if (phone.startsWith('972')) { variants.push('0' + phone.slice(3)); variants.push(phone.slice(3)); }
  else if (phone.startsWith('0')) { variants.push('972' + phone.slice(1)); variants.push(phone.slice(1)); }

  for (const ph of variants) {
    for (const field of ['waPhone', 'phone', 'chatId']) {
      try {
        const r = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: {
              from: [{ collectionId: 'users' }],
              where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: ph } } },
              limit: 1
            }})
          }
        );
        const d = await r.json();
        const n = Array.isArray(d) && d[0]?.document?.fields?.name?.stringValue;
        if (n) { console.log('[resolveOwnerName] found by', field, ph, ':', n); return n; }
      } catch(e) {}
    }
  }

  // 4. שם תצוגה וואטסאפ — אם לא מספר ולא chatId
  const cleanSender = (senderDisplayName || '').replace(/@.*/, '').trim();
  if (cleanSender && !/^\d/.test(cleanSender)) { console.log('[resolveOwnerName] using senderName:', cleanSender); return cleanSender; }

  console.log('[resolveOwnerName] no name found, returning empty');
  return '';
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
// לקוחות — מסוננים לפי userId (אזור אישי!)
// ───────────────────────────────────────────
async function getClients(userId) {
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ structuredQuery:{
          from:[{collectionId:'clients'}],
          where:{ fieldFilter:{ field:{fieldPath:'userId'}, op:'EQUAL', value:{stringValue: userId||''} }},
          limit:100
        }})
      }
    );
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(item => item.document)
      .map(item => ({
        id:       item.document.name.split('/').pop(),
        name:     item.document.fields?.name?.stringValue     || '',
        email:    item.document.fields?.email?.stringValue    || '',
        whatsapp: item.document.fields?.whatsapp?.stringValue || ''
      })).filter(c => c.name);
  } catch(e) { return []; }
}

async function createClient(name, email, whatsapp, userId) {
  try {
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients?key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fields:{
          name:      { stringValue: name      },
          email:     { stringValue: email     || '' },
          whatsapp:  { stringValue: whatsapp  || '' },
          userId:    { stringValue: userId    || '' },
          createdAt: { stringValue: new Date().toISOString() }
        }})
      }
    );
  } catch(e) { console.error('createClient error:', e); }
}

// עדכן לקוח קיים (של המשתמש הזה) או צור חדש
async function upsertClient(name, email, whatsapp, userId) {
  try {
    const clients = await getClients(userId);
    const existing = clients.find(c => c.name.toLowerCase() === (name||'').toLowerCase());
    if (existing && existing.id) {
      const fields = {};
      if (email)    fields.email    = { stringValue: email };
      if (whatsapp) fields.whatsapp = { stringValue: whatsapp };
      if (!Object.keys(fields).length) return;
      const masks = Object.keys(fields).map(k=>`updateMask.fieldPaths=${k}`).join('&');
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients/${existing.id}?${masks}&key=${FIREBASE_API_KEY}`,
        { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fields }) }
      );
    } else {
      await createClient(name, email, whatsapp, userId);
    }
  } catch(e) { console.error('upsertClient error:', e); }
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
// ─────────────────────────────────────────────────────
// זיהוי תאריך ב-JavaScript בלבד — ה-AI לא מחשב ימים!
// ─────────────────────────────────────────────────────
function extractDateJS(text) {
  // ימי שבוע עבריים → מספר יום (JavaScript: 0=ראשון/Sunday, ..., 6=שבת/Saturday)
  const DAY_MAP = {
    'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
    'חמישי': 4, 'שישי': 5, 'שבת': 6
  };

  // זמן ישראל UTC+3
  const ilMs       = Date.now() + 3 * 60 * 60 * 1000;
  const todayDay   = new Date(ilMs).getUTCDay();

  function ymd(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  function shift(days) { return ymd(ilMs + days * 86400000); }

  // היום / מחר
  if (/היום/.test(text)) return shift(0);
  if (/מחר/.test(text))  return shift(1);

  // ימי שבוע
  for (const [name, dayNum] of Object.entries(DAY_MAP)) {
    if (text.includes(name)) {
      let diff = dayNum - todayDay;
      if (diff <= 0) diff += 7;   // תמיד הקרוב קדימה
      return shift(diff);
    }
  }

  // תאריך בפורמט DD/MM או DD/MM/YYYY
  const m = text.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{4}))?/);
  if (m) {
    const day   = m[1].padStart(2,'0');
    const month = m[2].padStart(2,'0');
    const year  = m[3] || String(new Date(ilMs).getUTCFullYear());
    return `${year}-${month}-${day}`;
  }

  return null;   // לא נמצא תאריך
}

async function classifyMessage(text) {
  // ── שלב 1: חלץ תאריך ב-JavaScript — אמין 100% ──
  const jsDate = extractDateJS(text);

  const todayDisplay = new Date().toLocaleDateString('he-IL', {
    weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Asia/Jerusalem'
  });
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.GROQ_KEY}`},
      body: JSON.stringify({
        model:'llama-3.1-8b-instant',
        messages:[
          { role:'system', content:
`היום הוא ${todayDisplay}. אתה מסווג הודעות בעברית למשרד יעוץ מס.

קטגוריות:
- "appointment" - בקשה לפגישה / תור / להיפגש / קביעה
- "task" - כל בקשה, משימה, תזכורת, שאלה, הודעה עם תוכן כלשהו — כולל אם לא ברורה לחלוטין
- "invalid" - רק הודעות ריקות / ברכות קצרות ללא שום תוכן עבודה ("שלום", "היי", "בוקר טוב", "תודה", "ok", "123", "test")

כלל ברזל: כל ספק → "task"!
סימני פגישה: פגישה, תור, נפגש, להיפגש, קבע, קביעת, מתי פנוי, אפשר לקבוע, נתראה

החזר JSON בלבד:
{
  "intent": "appointment"|"task"|"invalid",
  "date": "YYYY-MM-DD"|null,
  "time": "HH:MM"|null,
  "with": "שם הלקוח שהפגישה איתו"|null,
  "assignee": "שם העובד שהמשימה מיועדת אליו"|null,
  "title": "תוכן ההודעה המלא בדיוק — ללא שם עובד בלבד מהתחלה"
}

לפגישות: חלץ שעה ושם לקוח (אחרי "עם"). עבור date — החזר null (מחושב בנפרד).
למשימות: assignee = שם עובד אם מצוין, אחרת null.`
          },
          { role:'user', content: text }
        ],
        max_tokens:200, temperature:0
      })
    });
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '{}').trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const result = JSON.parse(match[0]);
      // ── שלב 2: תאריך JS תמיד מנצח את ה-AI ──
      if (jsDate) result.date = jsDate;
      return result;
    }
  } catch(err) { console.error('Classify error:', err); }
  return { intent:'task', date: jsDate, time:null, title:text };
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
async function saveAppointment(title, date, time, clientName, chatId, googleEventId, userId) {
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
        userId:       {stringValue: userId||''},
        status:       {stringValue: 'confirmed'},
        createdAt:    {stringValue: new Date().toISOString()},
        reminderSent: {booleanValue: false}
      }})
    }
  );
}

// ───────────────────────────────────────────
// צוות עובדים — שליפה מ-Firestore (מנסה מספר מיקומים)
// ───────────────────────────────────────────
function parseTeamArray(arr) {
  return (arr || []).map(v => {
    const f = v.mapValue?.fields || {};
    // phone ו-whatsapp יכולים להיות שדות נפרדים — ניקח את מה שיש
    const phone = f.phone?.stringValue || f.whatsapp?.stringValue || '';
    return {
      name:  f.name?.stringValue  || '',
      email: f.email?.stringValue || '',
      phone
    };
  }).filter(m => m.name && m.name.length > 1);
}

async function getTeamMembers(userDocId, userDocFields) {
  // מיקום 1: שדה team ישיר במסמך המשתמש (users/{uid}.team)
  const directArr = userDocFields?.team?.arrayValue?.values;
  if (directArr && directArr.length > 0) {
    const members = parseTeamArray(directArr);
    console.log(`📋 team from user doc: ${members.length} members:`, members.map(m=>m.name));
    return members;
  }

  // מיקום 2: users/{uid}/data/team (sub-document)
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/data/team?key=${FIREBASE_API_KEY}`
    );
    const data = await resp.json();
    console.log(`📋 team subcollection raw:`, JSON.stringify(data).slice(0, 300));
    if (data.fields) {
      const arr = data.fields?.team?.arrayValue?.values || [];
      const members = parseTeamArray(arr);
      console.log(`📋 team from subcollection: ${members.length} members:`, members.map(m=>m.name));
      return members;
    }
  } catch(e) { console.error('getTeamMembers subcollection error:', e.message); }

  // מיקום 3: users/{uid}/team (subcollection עם מסמכים נפרדים)
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/team?key=${FIREBASE_API_KEY}&pageSize=50`
    );
    const data = await resp.json();
    if (data.documents && data.documents.length > 0) {
      const members = data.documents.map(doc => {
        const f = doc.fields || {};
        return {
          name:  f.name?.stringValue  || '',
          email: f.email?.stringValue || '',
          phone: f.phone?.stringValue || f.whatsapp?.stringValue || ''
        };
      }).filter(m => m.name && m.name.length > 1);
      console.log(`📋 team from docs: ${members.length} members:`, members.map(m=>m.name));
      return members;
    }
  } catch(e) { console.error('getTeamMembers team-docs error:', e.message); }

  console.log(`📋 no team found for userId=${userDocId}`);
  return [];
}

// התאמה גמישה של שם עובד לרשימת הצוות (כולל וריאציות עבריות)
function findWorkerByName(extractedName, team) {
  if (!extractedName || !team.length) return null;
  const q = extractedName.toLowerCase().trim();
  // 1. התאמה מדויקת
  for (const m of team) {
    if (m.name.toLowerCase() === q) return m;
  }
  // 2. שם פרטי מדויק
  for (const m of team) {
    const first = m.name.split(' ')[0].toLowerCase();
    const qFirst = q.split(' ')[0];
    if (first === qFirst) return m;
  }
  // 3. וריאציה עברית — אחד מתחיל בשני (רות↔רותי, יוסף↔יוסי)
  for (const m of team) {
    const first = m.name.split(' ')[0].toLowerCase();
    const qFirst = q.split(' ')[0];
    if (first.startsWith(qFirst) || qFirst.startsWith(first)) return m;
  }
  return null;
}

// מחפש שם עובד בתוך הטקסט (חיפוש רגקס כגיבוי)
function findWorkerMatch(text, team) {
  if (!text || !team.length) return null;
  const lower = text.toLowerCase().trim();
  for (const m of team) {
    if (!m.name || m.name.length < 2) continue;
    const full  = m.name.toLowerCase();
    const first = m.name.split(' ')[0].toLowerCase();
    if (first.length < 2) continue;
    // שם מלא בטקסט בכל מיקום
    if (lower.includes(full)) return m;
    // שם פרטי עם אות שימוש עברית לפניו (ל, מ, ב, ש, כ) בכל מיקום
    if (new RegExp(`(?:^|\\s)[לבמשכ]?${first}(?:[:\\-,\\s]|$)`).test(lower)) return m;
  }
  return null;
}

// ניקוי כותרת מרישום שם עובד בהתחלה
function cleanTitleFromWorker(title, workerName) {
  if (!workerName || !title) return title;
  const first = workerName.split(' ')[0];
  return title
    .replace(new RegExp(`^ל?${workerName}[:\\-,\\s]+`, 'i'), '')
    .replace(new RegExp(`^ל?${first}[:\\-,\\s]+`,       'i'), '')
    .trim() || title;
}

// שמירת משימה — נשמרת ב-users/{uid}/data/tasks (המקום שהאפליקציה קוראת ממנו)
async function saveTask(title, clientName, source, userDocId, assignee, assigneeEmail) {
  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const taskFields = {
    id:          { stringValue: taskId },
    title:       { stringValue: title.trim() },
    assignee:    { stringValue: assignee || '' },
    clientName:  { stringValue: clientName || '' },
    source:      { stringValue: source || 'bot' },
    status:      { stringValue: 'pending' },
    priority:    { stringValue: 'normal' },
    createdAt:   { stringValue: new Date().toISOString() },
    description: { stringValue: source !== 'whatsapp-text' ? '🎤 תומלל מהודעה קולית' : '' }
  };
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:commit?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [{ transform: {
        document: `projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/data/tasks`,
        fieldTransforms: [{ fieldPath: 'tasks', appendMissingElements: { values: [{ mapValue: { fields: taskFields } }] } }]
      }}]})
    }
  );
  console.log(`💾 saveTask → users/${userDocId}/data/tasks | id:${taskId} | assignee:${assignee}`);
  return { ok: resp.ok, docId: taskId };
}

// יצירת sharedTask כדי שהעובד יראה את המשימה
async function createSharedTask(taskDocId, title, assigneeName, assigneeEmail, employerEmail, clientName, source) {
  try {
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/sharedTasks?documentId=${taskDocId}&key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fields:{
          title:             {stringValue: title},
          status:            {stringValue: 'pending'},
          priority:          {stringValue: 'normal'},
          description:       {stringValue: ''},
          assignee:          {stringValue: assigneeName},
          assigneeEmail:     {stringValue: assigneeEmail},
          employerEmail:     {stringValue: employerEmail},
          client:            {stringValue: clientName},
          source:            {stringValue: source},
          createdAt:         {stringValue: new Date().toISOString()},
          workerUnreadCount: {integerValue: '1'},
          unreadCount:       {integerValue: '0'},
          lastMessage:       {stringValue: ''},
          taskId:            {stringValue: taskDocId}
        }})
      }
    );
  } catch(e) { console.error('createSharedTask error:', e); }
}

// נרמול טלפון — מסיר את כל התווים שאינם ספרות (כולל תווי Unicode)
function normalizeWorkerPhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

// שליחת מייל לעובד
async function notifyWorkerByEmail(workerEmail, workerName, taskTitle, senderName) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
    });
    const SITE_URL = 'https://dabelu.vercel.app';
    const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe;border-radius:12px 12px 0 0">
        <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:90px;max-width:280px;display:block;margin:0 auto">
      </div>
      <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:20px 28px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">📋 משימה חדשה שובצה אליך!</h1>
      </div>
      <div style="padding:32px;background:#fff">
        <p style="font-size:16px;color:#1e293b;margin:0 0 8px">שלום <strong>${workerName}</strong> 👋</p>
        <p style="font-size:14px;color:#475569;margin:0 0 24px">${senderName} שיבצ/ה לך משימה חדשה:</p>
        <div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:10px;padding:18px 20px;margin-bottom:28px">
          <div style="color:#6366f1;font-size:12px;font-weight:600;margin-bottom:8px">📝 פרטי המשימה</div>
          <div style="color:#1e293b;font-size:16px;font-weight:700">${taskTitle}</div>
        </div>
        <div style="text-align:center">
          <a href="${SITE_URL}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700">פתח את Dabelu לאישור ←</a>
        </div>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
    await transporter.sendMail({
      from: '"Dabelu מערכת משימות" <tasks@dabelu.pro>',
      to: workerEmail,
      subject: `📋 משימה חדשה: ${taskTitle}`,
      html
    });
    console.log('✅ worker email sent to:', workerEmail);
  } catch(e) { console.error('notifyWorkerByEmail error:', e.message); }
}

// שליחה לעובד לפי נתוני ההתקשרות שהוגדרו לו — ווצאפ אם יש טלפון, מייל אם יש מייל
async function notifyWorkerOfTask(workerMember, taskTitle, senderName) {
  const { name, email, phone } = workerMember;

  // ווצאפ — אם הוגדר טלפון לעובד
  if (phone) {
    try {
      const normalized = normalizeWorkerPhone(phone);
      if (normalized) {
        await sendWhatsAppReply(normalized + '@c.us',
          `📋 *משימה חדשה שובצה אליך!*\n\n📝 *תוכן המשימה:*\n${taskTitle}\n\n👤 הוקצה על ידי: ${senderName}\n\nיש לפתוח את המערכת לפרטים ולאישור ✅`
        );
        console.log('✅ worker WA sent to:', normalized);
      }
    } catch(e) { console.error('notifyWorker WA error:', e.message); }
  }

  // מייל — אם הוגדר מייל לעובד
  if (email) {
    await notifyWorkerByEmail(email, name, taskTitle, senderName);
  }

  if (!phone && !email) {
    console.warn(`⚠️ worker ${name} has no contact info — cannot notify`);
  }
}

// ───────────────────────────────────────────
// סיום קביעת פגישה
// pending.withName  = שם הלקוח
// pending.withEmail = מייל הלקוח (לזימון)
// senderCalId       = יומן גוגל אישי של השולח (אם חובר)
// ───────────────────────────────────────────
async function finalizeAppointment(chatId, userDocName, pending, senderCalId, userId) {
  await clearPending(userDocName);

  const apptWith     = pending.withName     || '';
  const apptEmail    = pending.withEmail    || '';
  const apptWhatsapp = pending.withWhatsapp || '';
  const cleanTitle   = `פגישה עם ${apptWith}`;

  let eventId = null;
  let addedToClientCalendar = false;

  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID) {
      // יומן של בעל העסק
      eventId = await createCalendarEvent(
        cleanTitle, pending.date, pending.time||null,
        apptWith, process.env.GOOGLE_CALENDAR_ID, apptEmail
      );
      // יומן אישי של השולח (אם חיבר)
      if (senderCalId) {
        await createCalendarEvent(
          cleanTitle, pending.date, pending.time||null,
          apptWith, senderCalId, apptEmail
        );
      }
      // ── בדוק אם הלקוח עצמו הוא משתמש רשום במערכת ──
      // מחפש לפי ווצאפ ואם לא נמצא — לפי מייל
      let clientUserDoc = null;
      if (apptWhatsapp) {
        const digits = apptWhatsapp.replace(/[^\d]/g, '');
        try { clientUserDoc = await getUserDoc(digits); } catch(e) {}
      }
      if (!clientUserDoc && apptEmail) {
        try {
          const resp = await fetch(
            `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ structuredQuery: {
                from: [{ collectionId: 'users' }],
                where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: apptEmail.toLowerCase() } } },
                limit: 1
              }})
            }
          );
          const data = await resp.json();
          if (Array.isArray(data) && data[0]?.document) clientUserDoc = data[0].document;
        } catch(e) {}
      }

      if (clientUserDoc) {
        const clientCalId    = clientUserDoc.fields?.googleCalendarId?.stringValue || '';
        const clientUserName = clientUserDoc.fields?.name?.stringValue || apptWith;
        if (clientCalId) {
          // שלוף מייל של בעל העסק לצורך הזמנה ביומן הלקוח
          let ownerEmail = '';
          try {
            const ownerResp = await fetch(
              `https://firestore.googleapis.com/v1/${userDocName}?key=${FIREBASE_API_KEY}`
            );
            const ownerData = await ownerResp.json();
            ownerEmail = ownerData.fields?.email?.stringValue || '';
          } catch(e) {}

          await createCalendarEvent(
            cleanTitle, pending.date, pending.time||null,
            clientUserName, clientCalId, ownerEmail
          );
          addedToClientCalendar = true;
          console.log(`📅 פגישה נוספה גם ליומן הלקוח ${clientUserName} (${clientCalId})`);
        }
      }
    }
  } catch(e) { console.error('Calendar finalize error:', e); }

  await saveAppointment(cleanTitle, pending.date, pending.time||'', apptWith, chatId, eventId, userId);

  const dateStr      = formatDateHebrew(pending.date);
  const timeStr      = pending.time ? ` בשעה ${pending.time}` : '';
  const inviteMsg    = apptEmail ? `\n📧 זימון נשלח ל-${apptEmail}` : '';
  const clientCalMsg = addedToClientCalendar ? `\n📅 נוסף גם ליומן של ${apptWith} אוטומטית!` : '';

  await sendWhatsAppReply(chatId,
    `✅ הפגישה נקבעה! 📆\n👤 עם: ${apptWith}\n📅 ${dateStr}${timeStr}${inviteMsg}${clientCalMsg}\n\n🔔 תקבל תזכורת יום לפני!`
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
// בניית הודעת זימון ברורה למוזמן לפגישה
function buildInviteMessage(ownerName, date, time) {
  const dateStr = formatDateHebrew(date || '');
  const lines = ['📅 זימון לפגישה!', ''];
  if (ownerName) lines.push(`👤 עם: ${ownerName}`);
  if (dateStr)   lines.push(`📅 תאריך: ${dateStr}`);
  if (time)      lines.push(`🕐 שעה: ${time}`);
  lines.push('', 'נתראה! 👋');
  return lines.join('\n');
}

async function tryFinalize(chatId, userDocName, pending, senderCalId, res, userId, ownerName) {
  if (pending.withEmail || pending.withWhatsapp) {
    if (pending.withWhatsapp && !pending.withEmail) {
      const phoneClean = pending.withWhatsapp.replace(/[-\s+]/g, '');
      const waId = (phoneClean.startsWith('972') ? phoneClean : '972'+phoneClean.replace(/^0/,'')) + '@c.us';
      await sendWhatsAppReply(waId, buildInviteMessage(ownerName, pending.date, pending.time)).catch(()=>{});
    }
    await finalizeAppointment(chatId, userDocName, pending, senderCalId, userId);
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
  const userDocId    = userDocName.split('/').pop();          // ← מזהה ייחודי של המשתמש
  const clientEmail  = userDoc.fields?.email?.stringValue  || '';
  const clientName   = userDoc.fields?.name?.stringValue   || senderName;
  const senderCalId  = userDoc.fields?.googleCalendarId?.stringValue || '';
  const ownerName    = await resolveOwnerName(phone, userDoc, senderData?.senderName || ''); // שם בעל העסק

  // ── pending מתוך מסמך המשתמש ──
  const pendingStr = userDoc.fields?.pendingAppt?.stringValue || '';
  let pending = null;
  if (pendingStr) { try { pending = JSON.parse(pendingStr); } catch(e) {} }

  // ── בדיקת פקיעת תוקף ask_contact (מעל שעה ללא תגובה) ──
  if (pending && pending.step === 'ask_contact' && pending.contactAskedAt) {
    const elapsed = Date.now() - new Date(pending.contactAskedAt).getTime();
    if (elapsed > 60 * 60 * 1000) { // שעה
      await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
      pending = null;
    }
  }

  // ══════════════════════════════════════════
  // עיבוד שלבי קביעת פגישה
  // ══════════════════════════════════════════
  if (pending && inText) {

    // ── שלב: תאריך ──
    if (pending.step === 'ask_date') {
      // תאריך: JS קודם, אחר-כך AI
      const jsDateOnly = extractDateJS(inText);
      const parsed = jsDateOnly ? { date: jsDateOnly, time: null } : await classifyMessage(inText).catch(()=>null);
      if (!parsed?.date) {
        await sendWhatsAppReply(chatId, '⚠️ לא הצלחתי לזהות תאריך.\nנסה שוב, לדוגמה: "7/5" או "יום שישי"');
        return res.status(200).send('ok');
      }
      const upd = { ...pending, date: parsed.date, time: parsed.time || pending.time || '' };

      if (upd.date && upd.time && upd.withName) {
        return tryFinalize(chatId, userDocName, upd, senderCalId, res, userDocId, ownerName);
      }
      if (upd.date && upd.time && !upd.withName) {
        const clients = await getClients(userDocId);
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
        return tryFinalize(chatId, userDocName, upd, senderCalId, res, userDocId, ownerName);
      }
      const clients = await getClients(userDocId);
      const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
      await setPending(userDocName, { ...upd, step:'ask_with_whom' });
      await sendWhatsAppReply(chatId, `🕐 שעה ${time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
      return res.status(200).send('ok');
    }

    // ── שלב: עם מי (חיפוש בלקוחות) ──
    if (pending.step === 'ask_with_whom') {
      const clients = await getClients(userDocId);

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
      if (matched.email || matched.whatsapp) {
        // יש פרטי קשר שמורים — שלח זימון ישירות ללא שאלה
        if (matched.whatsapp && !matched.email) {
          const phoneClean = matched.whatsapp.replace(/[-\s+]/g, '');
          const waId = (phoneClean.startsWith('972') ? phoneClean : '972'+phoneClean.replace(/^0/,'')) + '@c.us';
          await sendWhatsAppReply(waId, buildInviteMessage(ownerName, upd.date, upd.time)).catch(()=>{});
        }
        await finalizeAppointment(chatId, userDocName, upd, senderCalId, userDocId);
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
        await upsertClient(pending.withName, '', '', userDocId);
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
        return res.status(200).send('ok');
      }

      // מייל
      if (txt.includes('@') && txt.includes('.')) {
        const email = txt.toLowerCase();
        await upsertClient(pending.withName, email, '', userDocId);
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail: email }, senderCalId, userDocId);
        return res.status(200).send('ok');
      }

      // ווצאפ / טלפון
      const phoneClean = txt.replace(/[-\s+]/g, '');
      if (/^\d{9,12}$/.test(phoneClean)) {
        await upsertClient(pending.withName, '', phoneClean, userDocId);
        const waId = (phoneClean.startsWith('972') ? phoneClean : '972'+phoneClean.replace(/^0/,'')) + '@c.us';
        await sendWhatsAppReply(waId, buildInviteMessage(ownerName, pending.date, pending.time));
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
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
    if (chatId) await sendWhatsAppReply(chatId,
      '👋 שלום!\n\nכדי ליצור משימה — שלחו הודעה עם תוכן המשימה.\nכדי לקבוע פגישה — ציינו "פגישה" בהודעה.\n\nניתן גם לשלוח הודעה קולית! 🎤'
    );
    return res.status(200).send('unclear');
  }

  // ── פגישה ──
  if (classified.intent === 'appointment') {
    const apptTitle = title || 'פגישה';

    // נסה לזהות לקוח — רק לקוחות של המשתמש הזה
    const clients = await getClients(userDocId);
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
      ? { withName: matchedClient.name, withEmail: matchedClient.email || '', withWhatsapp: matchedClient.whatsapp || '' }
      : hasWith
        ? { withName: withName,          withEmail: '', withWhatsapp: '' }
        : { withName: '',                withEmail: '', withWhatsapp: '' };

    // ── הכל ידוע + לקוח נמצא ──
    if (hasDate && hasTime && hasMatch) {
      const upd = { date:classified.date, time:classified.time, title:apptTitle, ...knownWith };
      return tryFinalize(chatId, userDocName, upd, senderCalId, res, userDocId, ownerName);
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

  // ── משימה — זיהוי עובד ושיוך ──
  // מעביר את שדות המשתמש כדי לחפש team בכל מיקום אפשרי
  let teamMembers = [];
  try { teamMembers = await getTeamMembers(userDocId, userDoc.fields); } catch(e) {
    console.error('getTeamMembers failed:', e.message);
  }

  // עדיפות 1: Groq זיהה שם עובד בסיווג → התאמה גמישה
  // עדיפות 2: חיפוש regex בטקסט המלא
  const aiAssignee  = classified.assignee || null;
  const workerMatch = (aiAssignee ? findWorkerByName(aiAssignee, teamMembers) : null)
                   || findWorkerMatch(msgText, teamMembers)
                   || (teamMembers.length === 1 ? teamMembers[0] : null); // עובד יחיד → שיוך אוטומטי

  console.log(`👥 assignee from AI: "${aiAssignee}" | matched: ${workerMatch?.name || 'none'}`);

  // תמיד שומרים את הטקסט המקורי המלא — רק מסירים שם עובד מההתחלה
  const cleanTitle = workerMatch
    ? cleanTitleFromWorker(msgText.trim(), workerMatch.name)
    : msgText.trim();

  // שם המשוב: עובד אם נמצא בצוות, אחרת המעביד עצמו ("כללי")
  const assigneeName  = workerMatch ? workerMatch.name  : clientName;
  const assigneeEmail = workerMatch ? workerMatch.email : clientEmail;

  const { ok: firestoreOk, docId: taskDocId } = await saveTask(
    cleanTitle, clientName, source, userDocId,
    assigneeName, assigneeEmail
  );

  // sharedTask + התרעה — רק כשמשובצת לעובד (לא לכללי)
  if (firestoreOk && workerMatch && taskDocId) {
    await createSharedTask(taskDocId, cleanTitle, workerMatch.name, workerMatch.email, clientEmail, clientName, source);
    await notifyWorkerOfTask(workerMatch, cleanTitle, clientName);
  }

  if (chatId) {
    const assignMsg = workerMatch
      ? `\n👤 שובצה ל: *${workerMatch.name}*`
      : `\n👤 שובצה כללי (${clientName})`;
    await sendWhatsAppReply(chatId, firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!${assignMsg}\n📝 ${cleanTitle}`
      : '⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה.');
  }
  return res.status(200).json({ ok:true, type:'task', task:cleanTitle });
};
