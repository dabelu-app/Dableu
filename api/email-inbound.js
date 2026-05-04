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
// שמירת משימה — נשמרת ב-users/{uid}/data/tasks (המקום שהאפליקציה קוראת ממנו)
async function saveTask(title, senderName, source, userId, assignee, assigneeEmail, description) {
  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const taskFields = {
    id:          { stringValue: taskId },
    title:       { stringValue: title.trim() },
    assignee:    { stringValue: assignee || '' },
    clientName:  { stringValue: senderName || '' },
    source:      { stringValue: source || 'email' },
    status:      { stringValue: 'pending' },
    priority:    { stringValue: 'normal' },
    createdAt:   { stringValue: new Date().toISOString() },
    description: { stringValue: description || '' }
  };
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:commit?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [{ transform: {
        document: `projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userId}/data/tasks`,
        fieldTransforms: [{ fieldPath: 'tasks', appendMissingElements: { values: [{ mapValue: { fields: taskFields } }] } }]
      }}]})
    }
  );
  console.log(`💾 saveTask → users/${userId}/data/tasks | id:${taskId} | assignee:${assignee}`);
  return { ok: resp.ok, docId: taskId };
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
// עובדים — שליפה מ-Firestore (מנסה מספר מיקומים)
// ───────────────────────────────────────────
function parseTeamArray(arr) {
  return (arr || []).map(v => {
    const f = v.mapValue?.fields || {};
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
      console.log(`📋 team from subcollection docs: ${members.length} members:`, members.map(m=>m.name));
      return members;
    }
  } catch(e) { console.error('getTeamMembers team-docs error:', e.message); }

  console.log(`📋 team: no members found for userId=${userDocId}`);
  return [];
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

// Groq — חילוץ שם עובד מהמשימה, בהתאמה לרשימת הצוות האמיתית
async function extractAssigneeFromText(text, teamMembers) {
  if (!teamMembers || !teamMembers.length) return null;
  const namesList = teamMembers.map(m => m.name).join(', ');
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content:
`רשימת העובדים הקיימים: ${namesList}

קרא את הטקסט הבא וזהה אם המשימה מיועדת לאחד מהעובדים ברשימה.
חפש: שמות בתחילת הכותרת (ל[שם], עבור [שם], [שם]:), שמות בגוף ההודעה, גם עם אותיות שימוש (ל, מ, ב, ש).
אפשרי שהשם כתוב בצורה מקוצרת או נגזרת (רות↔רותי, יוסף↔יוסי).
אם מזהה עובד — החזר את שמו המדויק מהרשימה.
אם לא — החזר בדיוק: null` },
          { role: 'user', content: text.slice(0, 600) }
        ],
        max_tokens: 50,
        temperature: 0
      })
    });
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    console.log(`🤖 extractAssignee | names:[${namesList}] | result:"${content}"`);
    if (!content || /^null$/i.test(content)) return null;
    return content;
  } catch(e) { console.error('extractAssignee error:', e.message); return null; }
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
          message: `📋 *משימה חדשה שובצה אליך!*\n\n📝 *תוכן המשימה:*\n${taskTitle}\n\n👤 הוקצה על ידי: ${senderName}\n\nיש לפתוח את המערכת לפרטים ולאישור ✅`
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
    subject = `✅ משימה נוצרה: ${taskTitle}`;
    html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      ${header}
      <div style="padding:28px;background:#fff">
        <p style="font-size:20px;font-weight:700;color:#16a34a;margin:0 0 16px">✅ המשימה נוצרה בהצלחה!</p>
        <p style="font-size:15px;color:#1e293b;margin:0 0 6px">
          <strong>שובצה ל:</strong>
          <span style="color:${workerName ? '#16a34a' : '#64748b'}">${workerName || 'כללי (בעל העסק)'}</span>
        </p>
        <div style="background:#f0f4ff;border-right:4px solid #2563eb;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="color:#1e293b;font-size:15px;line-height:1.6;white-space:pre-wrap">${taskTitle}</div>
        </div>
        <div style="text-align:center;margin-top:20px">
          <a href="${SITE_URL}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">פתח את Dabelu ←</a>
        </div>
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
  // ── DEBUG: GET /api/email-inbound?debug=1&email=xxx ──
  if (req.method === 'GET' && req.query.debug === '1') {
    const testEmail = (req.query.email || '').toLowerCase().trim();
    if (!testEmail) return res.status(200).json({ error: 'add ?email=your@email.com' });
    const dbg = { email: testEmail, steps: [] };
    const userDoc = await isRegisteredEmail(testEmail);
    if (!userDoc) { dbg.steps.push({ step: 'user', status: 'NOT FOUND' }); return res.json(dbg); }
    const userId = userDoc.name.split('/').pop();
    dbg.steps.push({ step: 'user', status: 'FOUND', userId, userFields: Object.keys(userDoc.fields || {}) });
    const teamMembers = await getTeamMembers(userId, userDoc.fields);
    dbg.steps.push({ step: 'team', count: teamMembers.length, members: teamMembers });
    if (teamMembers.length) {
      const testText = req.query.text || 'לרותי - בדיקה';
      const aiResult = await extractAssigneeFromText(testText, teamMembers);
      dbg.steps.push({ step: 'ai_assignee', text: testText, result: aiResult });
      const workerMatch = (aiResult ? findWorkerByName(aiResult, teamMembers) : null) || findWorkerMatch(testText, teamMembers) || (teamMembers.length === 1 ? teamMembers[0] : null);
      dbg.steps.push({ step: 'worker_match', matched: workerMatch?.name || null });
    }
    return res.status(200).json(dbg);
  }

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
    // מעביר גם את שדות המשתמש כדי לחפש team בכל מיקום אפשרי
    let teamMembers = [];
    try { teamMembers = await getTeamMembers(userId, userDoc.fields); } catch(e) {
      console.error('getTeamMembers failed:', e.message);
    }

    // עדיפות 1: Groq חולץ שם עובד לפי רשימת הצוות → התאמה גמישה
    // עדיפות 2: regex בטקסט המלא
    const aiAssignee  = teamMembers.length ? await extractAssigneeFromText(fullText, teamMembers) : null;
    const workerMatch = (aiAssignee ? findWorkerByName(aiAssignee, teamMembers) : null)
                     || findWorkerMatch(fullText, teamMembers)
                     || (teamMembers.length === 1 ? teamMembers[0] : null); // עובד יחיד → שיוך אוטומטי

    console.log(`📧 assignee from AI: "${aiAssignee}" | matched: ${workerMatch?.name || 'none'}`);

    // תמיד שומרים את הטקסט המקורי — רק מסירים שם עובד מהתחלת הכותרת
    const cleanTitle = workerMatch
      ? cleanTitleFromWorker(taskTitle, workerMatch.name)
      : taskTitle;

    // גוף המייל נשמר כ-description (לא אובד מלל)
    const bodyText = text.trim();

    // שיוך: לעובד אם זוהה, לבעל העסק אם לא
    const assigneeName  = workerMatch ? workerMatch.name  : '';
    const assigneeEmail = workerMatch ? workerMatch.email : '';

    // ── שמירה ב-Firestore ──
    const { ok: firestoreOk, docId: taskDocId } = await saveTask(
      cleanTitle, ownerName, 'email', userId, assigneeName, assigneeEmail, bodyText
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
