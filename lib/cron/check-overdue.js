const fetch   = require('node-fetch');
const webpush = require('web-push');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

webpush.setVapidDetails(
  'mailto:tasks@dabelu.pro',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// ── שליחת Push Notification למשתמש לפי userId ──
async function sendPushToUser(userId, title, body) {
  if (!userId) return 0;
  // id יחיד להתראה — מאחד subscriptions מרובים לאותה רשומה ב-bell
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'pushSubscriptions' }],
            where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
            limit: 10
          }
        })
      }
    );
    const subs = await r.json();
    let sent = 0;
    for (const item of (Array.isArray(subs) ? subs : [])) {
      if (!item.document) continue;
      const f = item.document.fields;
      try {
        await webpush.sendNotification(
          { endpoint: f.endpoint?.stringValue, keys: JSON.parse(f.keys?.stringValue || '{}') },
          JSON.stringify({ id: notifId, title, body, url: '/tax_manager_app.html' })
        );
        sent++;
      } catch(e) {
        console.error('push send error:', e.message);
        if (e.statusCode === 410) {
          const docId = item.document.name.split('/').pop();
          await fetch(
            `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/pushSubscriptions/${docId}?key=${FIREBASE_API_KEY}`,
            { method: 'DELETE' }
          );
        }
      }
    }
    return sent;
  } catch(e) { console.error('sendPushToUser error:', e); return 0; }
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


module.exports = async (req, res) => {
  // ⚠️ הקרון הזה הושבת ב-2026-05-11:
  // האחריות על "משימות לא טופלו 48 שעות+" עברה ל-task-due-reminder
  // (שמשלב כעת גם משימות היום וגם משימות ישנות בהודעה אחת).
  // אם תרצי לחזור — הסר/י את ה-return הזה.
  return res.status(200).json({ ok: true, disabled: true, reason: 'merged into task-due-reminder' });

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
    const f = d.fields || {};
    // דלג על משימות עם תאריך יעד — הן יקבלו התראה ב-task-due-reminder ביום עצמן
    if (f.status?.stringValue !== 'pending') return false;
    if (!f.createdAt?.stringValue) return false;
    if (f.dueDate?.stringValue) return false;
    // דלג על משימות שנדחו או חוזרות — מטופלות ב-task-due-reminder
    if (f.snoozedUntil?.integerValue || f.snoozedUntil?.doubleValue || f.snoozedUntil?.stringValue) return false;
    if (f.recurring?.mapValue?.fields) return false;
    return true;
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

    // שלח Push לכל עובד (לפי userId מאוסף users, חיפוש לפי אימייל)
    for (const wd of Object.values(byWorker)) {
      const workerUser = userByEmail[wd.assigneeEmail];
      if (!workerUser) continue;
      const list = wd.titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
      const pushed = await sendPushToUser(workerUser.id,
        `⏰ משימות הממתינות לטיפולך (${wd.titles.length})`,
        list.slice(0, 200)
      );
      if (pushed > 0) workerNotified++;
    }

    // שלח Push למעסיק
    const list = tasks.map((t, i) => `${i + 1}. ${t.title} — 👤 ${t.assignee}`).join('\n');
    const pushSent = await sendPushToUser(employer.id,
      `⚠️ משימות שלא טופלו (${tasks.length})`,
      list.slice(0, 200)
    );
    if (pushSent > 0) {
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

    // דלג על משימות עם תאריך יעד — יטופלו ב-task-due-reminder ביום עצמן
    if (f.date?.stringValue) continue;
    // דלג על משימות שנדחו או חוזרות — מטופלות ב-task-due-reminder
    if (f.snoozedUntil?.integerValue || f.snoozedUntil?.doubleValue || f.snoozedUntil?.stringValue) continue;
    if (f.recurring?.mapValue?.fields) continue;

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
    // אל תשלח שוב למעביד שכבר קיבל הודעה בחלק א׳
    if (notifiedEmployers.has((employer.email || '').toLowerCase())) continue;

    const hours = employer.reminderHours || 48;
    const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    await sendPushToUser(employer.id,
      `⚠️ משימות ממתינות (${titles.length})`,
      list.slice(0, 200)
    );
    employerNotified++;
  }

  // ══════════════════════════════════════════════════════
  // חלק ג׳: tasks של משתמשים — users/{uid}/data/tasks
  // (המשימות שנוצרו בממשק האפליקציה, שמורות כמערך)
  // ══════════════════════════════════════════════════════
  for (const user of allUsers) {
    if (!user.id) continue;
    // דלג על מי שכבר קיבל התראה בחלקים הקודמים
    if (notifiedEmployers.has((user.email || '').toLowerCase())) continue;

    let tasksDoc;
    try {
      const r = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${user.id}/data/tasks?key=${FIREBASE_API_KEY}`
      );
      tasksDoc = await r.json();
    } catch (e) { continue; }

    if (!tasksDoc || !tasksDoc.fields) continue;

    const hours     = user.reminderHours || 48;
    const empCutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const tasksArr = tasksDoc.fields?.tasks?.arrayValue?.values || [];
    const overdue  = [];
    for (const tv of tasksArr) {
      const f         = tv.mapValue?.fields || {};
      const status    = f.status?.stringValue    || '';
      const createdAt = f.createdAt?.stringValue || '';
      const dueDate   = f.date?.stringValue      || '';
      const title     = f.title?.stringValue     || f.text?.stringValue || '';
      const snoozedUntilMs = f.snoozedUntil?.integerValue || f.snoozedUntil?.doubleValue || f.snoozedUntil?.stringValue || null;
      const hasRecurring   = !!f.recurring?.mapValue?.fields;
      // דלג על משימות עם תאריך יעד — הן יקבלו התראה ב-task-due-reminder ביום עצמן
      if (dueDate) continue;
      // דלג על משימות שנדחו (snoozed) — הן יקבלו התראה בתאריך הדחייה דרך task-due-reminder
      if (snoozedUntilMs) continue;
      // דלג על משימות חוזרות — הן יקבלו התראה לפי המסלול שלהן
      if (hasRecurring) continue;
      if (status === 'pending' && createdAt && createdAt < empCutoff && title) {
        overdue.push(title);
      }
    }

    if (!overdue.length) continue;

    const list = overdue.map((t, i) => `${i + 1}. ${t}`).join('\n');
    await sendPushToUser(user.id,
      `⚠️ משימות ממתינות (${overdue.length})`,
      list.slice(0, 200)
    );
    employerNotified++;
    notifiedEmployers.add((user.email || '').toLowerCase());
  }

  return res.status(200).json({ ok: true, workerNotified, employerNotified, overdueShared: allPendingShared.length });
};
