const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

// ───────────────────────────────────────────
// Firebase — בדיקת רישום לפי מייל
// ───────────────────────────────────────────
async function isRegisteredEmail(email) {
  const emailLower = email.toLowerCase();
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
  return (await query('email', emailLower)) || (await query('altEmail', emailLower));
}

// ───────────────────────────────────────────
// Firestore — שמירת משימה
// ───────────────────────────────────────────
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
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    }
  );
  const data = await resp.json();
  return { ok: resp.ok, docId: data.name?.split('/').pop() || '' };
}

// ───────────────────────────────────────────
// Firestore — sharedTask (לתצוגה של העובד)
// ───────────────────────────────────────────
async function createSharedTask(taskDocId, title, assigneeName, assigneeEmail, employerEmail, clientName) {
  try {
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/sharedTasks?documentId=${taskDocId}&key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          title:             { stringValue: title },
          status:            { stringValue: 'pending' },
          priority:          { stringValue: 'normal' },
          description:       { stringValue: '' },
          assignee:          { stringValue: assigneeName },
          assigneeEmail:     { stringValue: assigneeEmail },
          employerEmail:     { stringValue: employerEmail },
          client:            { stringValue: clientName },
          source:            { stringValue: 'email' },
          createdAt:         { stringValue: new Date().toISOString() },
          workerUnreadCount: { integerValue: '1' },
          unreadCount:       { integerValue: '0' },
          lastMessage:       { stringValue: '' },
          taskId:            { stringValue: taskDocId }
        }})
      }
    );
  } catch(e) { console.error('createSharedTask error:', e); }
}

// ───────────────────────────────────────────
// Groq — בדיקת תקינות משימה
// ───────────────────────────────────────────
async function isValidTask(taskTitle) {
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You decide if a Hebrew message is a valid work task. A valid task must contain a clear action or subject (name + action, job to do, reminder, etc). Answer only "כן" if valid, or "לא" if it is noise, test, single meaningless word, or unclear.' },
          { role: 'user', content: taskTitle.trim() }
        ],
        max_tokens: 5,
        temperature: 0
      })
    });
    const data = await resp.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim();
    return answer.startsWith('כן');
  } catch (err) {
    console.error('Groq validation error:', err);
    return true;
  }
}

// ───────────────────────────────────────────
// עובדים — שליפה מ-Firestore
// ───────────────────────────────────────────
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

// התאמה גמישה של שם עובד לרשימת הצוות (כולל וריאציות עבריות: רות↔רותי)
function findWorkerByName(extractedName, team) {
  if (!extractedName || !team.length) return null;
  const q = extractedName.toLowerCase().trim();
  for (const m of team) {
    if (m.name.toLowerCase() === q) return m;
  }
  for (const m of team) {
    const first = m.name.split(' ')[0].toLowerCase();
    const qFirst = q.split(' ')[0];
    if (first === qFirst) return m;
  }
  for (const m of team) {
    const first = m.name.split(' ')[0].toLowerCase();
    const qFirst = q.split(' ')[0];
    if (first.startsWith(qFirst) || qFirst.startsWith(first)) return m;
  }
  return null;
}

// חיפוש שם עובד בטקסט עם regex (גיבוי)
function findWorkerMatch(text, team) {
  if (!text || !team.length) return null;
  const lower = text.toLowerCase().trim();
  for (const m of team) {
    if (!m.name || m.name.length < 2) continue;
    const full  = m.name.toLowerCase();
    const first = m.name.split(' ')[0].toLowerCase();
    if (first.length < 2) continue;
    if (lower.includes(full)) return m;
    if (new RegExp(`(?:^|\\s)[לבמשכ]?${first}(?:[:\\-,\\s]|$)`).test(lower)) return m;
  }
  return null;
}

// Groq — חילוץ שם עובד מהמשימה
async function extractAssigneeFromText(text) {
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content:
`בהינתן משימה בעברית, חלץ את שם העובד שאליו המשימה מיועדת.
חפש: "לרותי", "לדינה:", "עבור משה", "ל[שם] -", "[שם] צריך ל".
אם לא מצוין עובד ברור — החזר: null
החזר את השם בלבד, ללא הסברים.
דוגמאות:
"לרותי - לעדכן תיק מע"מ" → "רותי"
"משימה לדינה: לשלוח דוח" → "דינה"
"עבור יוסי כהן - לחתום" → "יוסי כהן"
"לשלוח חשבונית ללקוח" → null` },
          { role: 'user', content: text.slice(0, 300) }
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

// ניקוי שם עובד מהכותרת
function cleanTitleFromWorker(title, workerName) {
  if (!workerName || !title) return title;
  const first = workerName.split(' ')[0];
  return title
    .replace(new RegExp(`^ל?${workerName}[:\\-,\\s]+`, 'i'), '')
    .replace(new RegExp(`^ל?${first}[:\\-,\\s]+`,       'i'), '')
    .trim() || title;
}

// ───────────────────────────────────────────
// שליחת ווצאפ לעובד
// ───────────────────────────────────────────
async function notifyWorkerByWhatsApp(phone, taskTitle, senderName) {
  try {
    const instance = process.env.GREENAPI_INSTANCE;
    const token    = process.env.GREENAPI_TOKEN;
    if (!instance || !token || !phone) return;
    const digits = phone.toString().replace(/[^\d]/g, '');
    if (!digits) return;
    const chatId = (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) + '@c.us';
    await fetch(
      `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          message: `📋 *משימה חדשה שובצה אליך!*\n\n📝 ${taskTitle}\n👤 הוקצה על ידי: ${senderName}\n\nיש לפתוח את המערכת לפרטים ולאישור ✅`
        })
      }
    );
    console.log('✅ WhatsApp sent to worker:', chatId);
  } catch(e) { console.error('notifyWorkerByWhatsApp error:', e); }
}

// ───────────────────────────────────────────
// שליחת מייל לעובד
// ───────────────────────────────────────────
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
        <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:64px;max-width:220px;display:block;margin:0 auto">
      </div>
      <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:20px 28px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">📋 משימה חדשה שובצה אליך!</h1>
      </div>
      <div style="padding:32px;background:#fff">
        <p style="font-size:16px;color:#1e293b;margin:0 0 8px">שלום <strong>${workerName}</strong> 👋</p>
        <p style="font-size:14px;color:#475569;margin:0 0 24px">
          ${senderName} שיבצ/ה לך משימה חדשה:
        </p>
        <div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:10px;padding:18px 20px;margin-bottom:28px">
          <div style="color:#6366f1;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">📝 פרטי המשימה</div>
          <div style="color:#1e293b;font-size:16px;font-weight:700">${taskTitle}</div>
        </div>
        <div style="text-align:center">
          <a href="${SITE_URL}"
             style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700">
            פתח את Dabelu לאישור ←
          </a>
        </div>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">
        Dabelu · tasks@dabelu.pro
      </div>
    </div>`;

    await transporter.sendMail({
      from: '"Dabelu מערכת משימות" <tasks@dabelu.pro>',
      to: workerEmail,
      subject: `📋 משימה חדשה: ${taskTitle}`,
      html
    });
    console.log('✅ Email sent to worker:', workerEmail);
  } catch(e) { console.error('notifyWorkerByEmail error:', e); }
}

// ───────────────────────────────────────────
// מייל תגובה לשולח
// ───────────────────────────────────────────
async function sendReplyEmail(to, taskTitle, status, workerName) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  const SITE_URL = 'https://dabelu.vercel.app';
  const header = `
    <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe;border-radius:12px 12px 0 0">
      <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:64px;max-width:220px;display:block;margin:0 auto">
    </div>`;

  let html, subject;
  if (status === 'not_registered') {
    subject = '❌ אינך מנוי במערכת Dabelu';
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:32px;background:#fff;text-align:center">
        <p style="font-size:40px;margin:0">❌</p>
        <h2 style="color:#1e293b;margin:12px 0 8px">אינך מנוי במערכת Dabelu</h2>
        <p style="color:#666;margin:0 0 24px">כדי להתחיל ליצור משימות דרך מייל, יש להירשם למערכת.</p>
        <a href="${SITE_URL}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;display:inline-block">להרשמה לחץ כאן</a>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
  } else if (status === 'ok') {
    const assignLine = workerName
      ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin:12px 0;text-align:right;font-size:14px;color:#16a34a;font-weight:600">👤 שובצה ל: ${workerName}</div>`
      : '';
    subject = `✅ משימה נוצרה: ${taskTitle}`;
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:32px;background:#fff;text-align:center">
        <p style="font-size:40px;margin:0">✅</p>
        <h2 style="color:#1e293b;margin:12px 0 8px">המשימה נוצרה בהצלחה!</h2>
        <div style="background:#f0f4ff;border-radius:8px;padding:16px;margin:16px 0;text-align:right">
          <span style="color:#666;font-size:13px">📝 משימה:</span>
          <p style="color:#1e293b;font-weight:bold;margin:4px 0 0;font-size:16px">${taskTitle}</p>
        </div>
        ${assignLine}
        <a href="${SITE_URL}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;display:inline-block">פתח את Dabelu</a>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
  } else if (status === 'unclear') {
    subject = '⚠️ ההודעה אינה ברורה';
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:32px;background:#fff;text-align:center">
        <p style="font-size:40px;margin:0">⚠️</p>
        <h2 style="color:#1e293b;margin:12px 0 8px">ההודעה אינה ברורה</h2>
        <p style="color:#666;margin:0 0 16px">לא הצלחנו להבין את המשימה. אנא שלח שנית עם פירוט ברור יותר.</p>
        <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:16px;margin:0 0 24px;text-align:right">
          <span style="color:#888;font-size:13px">📩 ההודעה שנשלחה:</span>
          <p style="color:#1e293b;font-weight:bold;margin:4px 0 0;font-size:15px">${taskTitle}</p>
        </div>
        <a href="${SITE_URL}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;display:inline-block">פתח את Dabelu</a>
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
        <h2 style="color:#1e293b;margin:12px 0 8px">לא ניתן היה ליצור את המשימה</h2>
        <p style="color:#666">אנא נסה שנית מאוחר יותר.</p>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
  }

  await transporter.sendMail({ from: '"Dabelu" <tasks@dabelu.pro>', to, subject, html });
}

// ───────────────────────────────────────────
// MAIN HANDLER
// ───────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, message: 'Email webhook ready' });

  try {
    const body = req.body || {};
    const fromEmail = (body.from || body.sender || '').toLowerCase().replace(/.*<(.+)>/, '$1').trim();
    const fromName  = (body.fromName || body.from || fromEmail).replace(/<.*>/, '').trim();
    const subject   = body.subject || body.Subject || '';
    const text      = body.text || body.body || body.bodyPlain || '';

    // הכותרת היא subject, תוכן המשימה מהכותרת + גוף המייל לזיהוי עובד
    const taskTitle = subject || text.split('\n')[0];
    const fullText  = subject + ' ' + text; // לחיפוש שם עובד גם בגוף המייל

    console.log('📧 EMAIL INBOUND | from:', fromEmail, '| subject:', taskTitle);

    if (!fromEmail || !taskTitle) {
      return res.status(200).json({ ok: false, message: 'Missing email or subject' });
    }

    // ── בדוק רישום ──
    const userDoc = await isRegisteredEmail(fromEmail);
    if (!userDoc) {
      await sendReplyEmail(fromEmail, '', 'not_registered');
      return res.status(200).json({ ok: true, registered: false });
    }

    const userId      = userDoc.name?.split('/').pop() || '';
    const ownerName   = userDoc.fields?.name?.stringValue  || fromName;
    const ownerEmail  = userDoc.fields?.email?.stringValue || fromEmail;

    // ── בדוק תקינות משימה ──
    const valid = await isValidTask(taskTitle);
    if (!valid) {
      await sendReplyEmail(fromEmail, taskTitle, 'unclear');
      return res.status(200).json({ ok: false, reason: 'unclear' });
    }

    // ── זיהוי עובד בכותרת / גוף המייל ──
    let teamMembers = [];
    try { teamMembers = await getTeamMembers(userId); } catch(e) {}

    // עדיפות 1: Groq חולץ שם עובד → התאמה גמישה
    // עדיפות 2: regex בטקסט המלא
    const aiAssignee  = teamMembers.length ? await extractAssigneeFromText(fullText) : null;
    const workerMatch = (aiAssignee ? findWorkerByName(aiAssignee, teamMembers) : null)
                     || findWorkerMatch(fullText, teamMembers);

    console.log(`📧 assignee from AI: "${aiAssignee}" | matched: ${workerMatch?.name || 'none'}`);

    const cleanTitle  = workerMatch ? cleanTitleFromWorker(taskTitle, workerMatch.name) : taskTitle;

    // שיוך: לעובד אם זוהה, לבעל העסק אם לא
    const assigneeName  = workerMatch ? workerMatch.name  : '';
    const assigneeEmail = workerMatch ? workerMatch.email : '';

    // ── שמירה ב-Firestore ──
    const { ok: firestoreOk, docId: taskDocId } = await saveTask(
      cleanTitle, ownerName, 'email', userId, assigneeName, assigneeEmail
    );

    // ── sharedTask + התרעה לעובד ──
    if (firestoreOk && workerMatch && taskDocId) {
      await createSharedTask(taskDocId, cleanTitle, workerMatch.name, workerMatch.email, ownerEmail, ownerName);

      // שלח לעובד לפי אמצעי ההתקשרות הזמינים
      if (workerMatch.email) {
        await notifyWorkerByEmail(workerMatch.email, workerMatch.name, cleanTitle, ownerName);
      }
      if (workerMatch.phone) {
        await notifyWorkerByWhatsApp(workerMatch.phone, cleanTitle, ownerName);
      }

      console.log(`📋 Task assigned to worker: ${workerMatch.name} | email:${workerMatch.email} | phone:${workerMatch.phone}`);
    } else {
      console.log('📋 Task assigned to owner (general)');
    }

    // ── תגובה לשולח — כולל שם עובד אם שובץ ──
    await sendReplyEmail(fromEmail, cleanTitle, firestoreOk ? 'ok' : 'error', workerMatch?.name || '');

    return res.status(200).json({ ok: firestoreOk, taskTitle: cleanTitle, assignee: workerMatch?.name || null });

  } catch (err) {
    console.error('Email inbound error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
