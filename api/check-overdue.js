const fetch   = require('./_firestore');
const webpush = require('web-push');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

webpush.setVapidDetails(
  'mailto:tasks@dabelu.pro',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// ── שליחת WhatsApp ──
async function sendWhatsApp(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  const fullId   = chatId.includes('@') ? chatId : chatId + '@c.us';
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chatId: fullId, message }) }
  );
}

// ── שאילתת Firestore ──
async function firestoreQuery(body) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
  );
  return r.json();
}

// ── שליפת כל המשתמשים (כולל reminderHours מתוך notif) ──
async function getAllUsers() {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users?key=${FIREBASE_API_KEY}&pageSize=200`
  );
  const data = await r.json();
  return (data.documents || []).map(d => {
    const notifMap     = d.fields?.notif?.mapValue?.fields || {};
    const reminderHours = parseInt(
      notifMap.reminderHours?.integerValue ||
      notifMap.reminderHours?.stringValue  || '48'
    ) || 48;
    return {
      id:           d.name?.split('/').pop() || '',
      email:        d.fields?.email?.stringValue  || '',
      name:         d.fields?.name?.stringValue   || '',
      chatId:       d.fields?.chatId?.stringValue || '',
      phone:        d.fields?.phone?.stringValue  || '',
      reminderHours
    };
  });
}

// ── שליפת צוות מעסיק ──
async function getTeamMembers(userDocId) {
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/data/team?key=${FIREBASE_API_KEY}`
    );
    const data = await r.json();
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

// ── נרמול מספר טלפון לפורמט 972XXXXXXXXX ──
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

module.exports = async (req, res) => {
  // cutoff מינימלי (12 שעות = הגדרה הקצרה ביותר) — לשאילתת tasks
  const minCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  // ── שלוף את כל המשתמשים פעם אחת ──
  const allUsers    = await getAllUsers();
  const userByEmail = {};
  const userById    = {};
  for (const u of allUsers) {
    if (u.email) userByEmail[u.email.toLowerCase()] = u;
    if (u.id)    userById[u.id]                     = u;
  }

  let workerNotified   = 0;
  let employerNotified = 0;

  // ══════════════════════════════════════════════════════
  // חלק א׳: sharedTasks — התראה ישירה לעובד + סיכום למעסיק
  // ══════════════════════════════════════════════════════
  // שלוף כל sharedTasks pending — נסנן לפי cutoff של כל מעסיק בנפרד
  const stResp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/sharedTasks?key=${FIREBASE_API_KEY}&pageSize=200`
  );
  const stData = await stResp.json();
  const allPendingShared = (stData.documents || []).filter(d => {
    return d.fields?.status?.stringValue === 'pending' && d.fields?.createdAt?.stringValue;
  });

  // קבץ לפי מעסיק (ללא סינון זמן — נסנן בלולאה לפי הגדרת כל מעסיק)
  const byEmployer = {};
  for (const doc of allPendingShared) {
    const f   = doc.fields;
    const emp = (f.employerEmail?.stringValue || '').toLowerCase();
    if (!emp) continue;
    if (!byEmployer[emp]) byEmployer[emp] = [];
    byEmployer[emp].push({
      title:         f.title?.stringValue         || '',
      assignee:      f.assignee?.stringValue      || '',
      assigneeEmail: (f.assigneeEmail?.stringValue || '').toLowerCase(),
      createdAt:     f.createdAt?.stringValue     || ''
    });
  }

  const teamCache        = {};
  const notifiedEmployers = new Set(); // למניעת כפל בחלק ב׳

  for (const [empEmail, allTasks] of Object.entries(byEmployer)) {
    const employer = userByEmail[empEmail];
    if (!employer) continue;

    // חשב cutoff לפי הגדרת המעסיק
    const hours    = employer.reminderHours || 48;
    const empCutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // סנן רק משימות שחרגו מהזמן שהוגדר
    const tasks = allTasks.filter(t => t.createdAt && t.createdAt < empCutoff);
    if (!tasks.length) continue;

    // שלוף צוות (עם cache)
    if (!teamCache[employer.id]) {
      teamCache[employer.id] = await getTeamMembers(employer.id);
    }
    const team = teamCache[employer.id];

    // קבץ לפי עובד כדי לשלוח הודעה מרוכזת
    const byWorker = {};
    for (const t of tasks) {
      const key = t.assigneeEmail || t.assignee;
      if (!byWorker[key]) {
        byWorker[key] = { assignee: t.assignee, assigneeEmail: t.assigneeEmail, titles: [] };
      }
      byWorker[key].titles.push(t.title);
    }

    // שלח התראה לכל עובד
    for (const wd of Object.values(byWorker)) {
      const member = team.find(m =>
        m.email.toLowerCase() === wd.assigneeEmail ||
        m.name === wd.assignee
      );
      if (!member) continue;
      const phone = normalizePhone(member.phone);
      if (!phone) continue;

      const list = wd.titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
      await sendWhatsApp(phone + '@c.us',
        `⏰ *תזכורת — משימות הממתינות לטיפולך*\n\n${list}\n\nיש לפתוח את המערכת ולטפל בהן ✅`
      );
      workerNotified++;
    }

    // שלח סיכום למעסיק
    const empPhone = normalizePhone(employer.chatId || employer.phone);
    if (empPhone) {
      const list = tasks.map((t, i) => `${i + 1}. ${t.title} — 👤 ${t.assignee}`).join('\n');
      await sendWhatsApp(empPhone + '@c.us',
        `⚠️ *תזכורת — משימות שלא טופלו מעל ${hours} שעות:*\n\n${list}\n\n✉️ נשלחה תזכורת ישירה לכל עובד רלוונטי.`
      );
      employerNotified++;
      notifiedEmployers.add(empEmail);
    }
  }

  // ══════════════════════════════════════════════════════
  // חלק ב׳: tasks רגילות (כלליות ללא עובד) — סיכום למעסיק
  // ══════════════════════════════════════════════════════
  const taskDocs = await firestoreQuery({
    structuredQuery: {
      from: [{ collectionId: 'tasks' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'status' },    op: 'EQUAL',     value: { stringValue: 'pending' } } },
            { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { stringValue: minCutoff } } }
          ]
        }
      },
      limit: 200
    }
  });

  // קבץ לפי userId (מעסיק), תוך דילוג על משימות שיש להן עובד (כבר טופלו למעלה)
  const tasksByUser = {};
  for (const d of taskDocs) {
    if (!d.document) continue;
    const f             = d.document.fields;
    const assigneeEmail = (f.assigneeEmail?.stringValue || '').toLowerCase();
    const uid           = f.userId?.stringValue || '';
    if (!uid) continue;

    // דלג אם המשימה שובצה לעובד ממשי (שיש לו sharedTask — כבר טופל בחלק א׳)
    const employer = userById[uid];
    if (employer && assigneeEmail && assigneeEmail !== employer.email.toLowerCase()) continue;

    // בדוק שחרג גם מהcutoff הספציפי של המעסיק
    const createdAt = f.createdAt?.stringValue || '';
    if (employer) {
      const hours    = employer.reminderHours || 48;
      const empCutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      if (createdAt >= empCutoff) continue; // עוד לא חרג
    }

    if (!tasksByUser[uid]) tasksByUser[uid] = [];
    tasksByUser[uid].push(f.title?.stringValue || '(ללא כותרת)');
  }

  for (const [uid, titles] of Object.entries(tasksByUser)) {
    const employer = userById[uid];
    if (!employer) continue;
    const phone = normalizePhone(employer.chatId || employer.phone);
    if (!phone) continue;
    // אל תשלח שוב למעביד שכבר קיבל הודעה בחלק א׳
    if (notifiedEmployers.has((employer.email || '').toLowerCase())) continue;

    const hours = employer.reminderHours || 48;
    const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    await sendWhatsApp(phone + '@c.us',
      `⚠️ *תזכורת — משימות כלליות שלא טופלו מעל ${hours} שעות:*\n\n${list}`
    );
    employerNotified++;
  }

  // ══════════════════════════════════════════════════════
  // חלק ג׳: Push notifications
  // ══════════════════════════════════════════════════════
  const totalOverdue = allPendingShared.length;
  if (totalOverdue > 0) {
    const subDocs = await firestoreQuery({
      structuredQuery: { from: [{ collectionId: 'pushSubscriptions' }], limit: 50 }
    });
    for (const d of subDocs) {
      if (!d.document) continue;
      const f = d.document.fields;
      try {
        await webpush.sendNotification(
          { endpoint: f.endpoint?.stringValue, keys: JSON.parse(f.keys?.stringValue || '{}') },
          JSON.stringify({ title: '⚠️ משימות ממתינות לטיפול', body: `${totalOverdue} משימות לא טופלו` })
        );
      } catch(e) { console.error('push failed:', e.message); }
    }
  }

  return res.status(200).json({ ok: true, workerNotified, employerNotified, overdueShared: totalOverdue });
};
