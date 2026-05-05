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

// ── טעינת עובדי צוות לפי מזהה המעסיק ──
async function getTeamMembers(userDocId) {
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/data/team?key=${FIREBASE_API_KEY}`
    );
    const data = await resp.json();
    if (!data.fields) return [];
    const arr = data.fields?.team?.arrayValue?.values || [];
    return arr.map(v => {
      const f = v.mapValue?.fields || {};
      return {
        name:  f.name?.stringValue  || '',
        email: f.email?.stringValue || '',
        phone: f.phone?.stringValue || ''
      };
    }).filter(m => m.name && m.name.length > 1);
  } catch(e) { return []; }
}

// ── זיהוי שם עובד בטקסט ──
function findWorkerMatch(text, team) {
  if (!text || !team.length) return null;
  const lower = text.toLowerCase().trim();
  for (const m of team) {
    if (!m.name || m.name.length < 2) continue;
    const full  = m.name.toLowerCase();
    const first = m.name.split(' ')[0].toLowerCase();
    if (first.length < 2) continue;
    if (lower.includes(full)) return m;
    if (new RegExp(`^ל?${first}[:\\-,\\s]`).test(lower)) return m;
    if (new RegExp(`\\s${first}[:\\-,\\s]`).test(lower)) return m;
  }
  return null;
}

function cleanTitleFromWorker(title, workerName) {
  if (!workerName || !title) return title;
  const first = workerName.split(' ')[0];
  return title
    .replace(new RegExp(`^ל?${workerName}[:\\-,\\s]+`, 'i'), '')
    .replace(new RegExp(`^ל?${first}[:\\-,\\s]+`,       'i'), '')
    .trim() || title;
}

// ── יצירת sharedTask לעובד ──
async function createSharedTask(taskDocId, title, assigneeName, assigneeEmail, employerEmail, clientName) {
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
          source:            {stringValue: 'email'},
          createdAt:         {stringValue: new Date().toISOString()},
          workerUnreadCount: {integerValue: '1'},
          unreadCount:       {integerValue: '0'},
          lastMessage:       {stringValue: ''},
          taskId:            {stringValue: taskDocId}
        }})
      }
    );
  } catch(e) { console.error('createSharedTask email error:', e); }
}

// ── שליחת התראה לעובד ──
// נרמול טלפון — מסיר את כל התווים שאינם ספרות (כולל תווי Unicode)
function normalizeWorkerPhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

async function notifyWorkerOfTask(workerMember, taskTitle, senderName) {
  try {
    if (!workerMember.phone) return;
    const normalized = normalizeWorkerPhone(workerMember.phone);
    if (!normalized) return;
    console.log('notifyWorker (email) → chatId:', normalized + '@c.us');
    await sendWhatsAppReply(normalized + '@c.us',
      `📋 *משימה חדשה שובצה אליך!*\n\n📝 ${taskTitle}\n👤 הוקצה על ידי: ${senderName}\n\nיש לפתוח את המערכת לפרטים ✅`
    );
  } catch(e) { console.error('notifyWorker email error:', e); }
}

async function saveTask(title, senderName, source, userId, assignee, assigneeEmail) {
  const fields = {
    title:       { stringValue: title.trim() },
    clientName:  { stringValue: senderName },
    source:      { stringValue: source },
    status:      { stringValue: 'pending' },
    priority:    { stringValue: 'normal' },
    createdAt:   { stringValue: new Date().toISOString() },
    description: { stringValue: '' },
    userId:      { stringValue: userId || '' }
  };
  if (assignee) {
    fields.assignee      = { stringValue: assignee };
    fields.assigneeEmail = { stringValue: assigneeEmail || '' };
  }
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/tasks?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
  );
  const data = await resp.json();
  return { ok: resp.ok, docId: data.name?.split('/').pop() || '' };
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
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: 'dableubot@gmail.com', pass: process.env.GMAIL_PASS },
    logger: false,
    socketTimeout: 20000,
    greetingTimeout: 15000,
    connectionTimeout: 15000
  });

  let processed = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // קרא מיילים שלא נקראו
      for await (const msg of client.fetch({ unseen: true }, { envelope: true, source: true })) {
        const parsed = await simpleParser(msg.source);

        // עבד רק מיילים שהועברו מ-tasks@dabelu.pro (נשלחו ל-+dabelutasks)
        const toAddresses = (parsed.to?.value || []).map(a => a.address?.toLowerCase() || '');
        const isDabeluTask = toAddresses.some(a => a.includes('+dabelutasks') || a.includes('dabelutasks'));
        if (!isDabeluTask) {
          // דלג — אל תסמן כנקרא, אל תגע במיילים אישיים
          continue;
        }

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
        const userId      = userDoc.name?.split('/').pop() || '';
        const employerEmail = userDoc.fields?.email?.stringValue || fromEmail;

        // זהה עובד בכותרת/גוף המייל — רק בצוות של המעביד הזה
        let teamMembers = [];
        try { teamMembers = await getTeamMembers(userId); } catch(e) {}
        const searchText = taskTitle + ' ' + body;
        const workerMatch = findWorkerMatch(searchText, teamMembers);
        const cleanTitle  = workerMatch ? cleanTitleFromWorker(taskTitle, workerMatch.name) : taskTitle;

        // שם משובץ: עובד אם נמצא בצוות, אחרת המעביד עצמו ("כללי")
        const employerName  = userDoc.fields?.name?.stringValue || fromName;
        const assigneeName  = workerMatch ? workerMatch.name  : employerName;
        const assigneeEmail2 = workerMatch ? workerMatch.email : employerEmail;

        // שמור משימה
        const { ok, docId: taskDocId } = await saveTask(
          cleanTitle, fromName, 'email', userId,
          assigneeName, assigneeEmail2
        );

        // צור sharedTask + התרעה — רק לעובד (לא לכללי)
        if (ok && workerMatch && taskDocId) {
          await createSharedTask(taskDocId, cleanTitle, workerMatch.name, workerMatch.email, employerEmail, fromName);
          await notifyWorkerOfTask(workerMatch, cleanTitle, fromName);
        }

        // שלח תשובה למייל
        const assignNote = workerMatch
          ? ` (שובצה ל: ${workerMatch.name})`
          : ` (כללי — ${employerName})`;
        await sendReplyEmail(fromEmail, subject, cleanTitle + assignNote, ok ? true : false);

        // שלח וואטסאפ למעסיק אם יש chatId
        const chatId = userDoc.fields?.chatId?.stringValue;
        if (chatId) {
          const phone = chatId.startsWith('0') ? '972' + chatId.slice(1) : chatId;
          const assignMsg = workerMatch
            ? `\n👤 שובצה ל: *${workerMatch.name}*`
            : `\n👤 כללי (${employerName})`;
          await sendWhatsAppReply(phone + '@c.us', ok
            ? `✅ התקבל מייל ונוצרה משימה!${assignMsg}\n📝 ${cleanTitle}`
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
