const fetch   = require('node-fetch');
const webpush = require('web-push');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

webpush.setVapidDetails(
  'mailto:tasks@dabelu.pro',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// ── שלח Push לכל המכשירים של userId ──
async function sendPush(userId, title, body) {
  if (!userId) return 0;
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
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
          JSON.stringify({ title, body, url: '/tax_manager_app.html' })
        );
        sent++;
      } catch (e) {
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
  } catch (e) { return 0; }
}

// ── המרת epoch ms ל-YYYY-MM-DD בזמן ישראל ──
function epochToILDate(epochMs) {
  if (!epochMs) return '';
  const ms = typeof epochMs === 'string' ? parseInt(epochMs) : epochMs;
  if (!ms || isNaN(ms)) return '';
  const il = new Date(ms + 3 * 60 * 60 * 1000);
  return il.toISOString().split('T')[0];
}

// ── האם today הוא יום של חזרה לפי recurring config? ──
function isRecurringToday(rec, todayDate) {
  if (!rec || !rec.type) return false;
  const today = new Date(todayDate + 'T12:00:00Z');
  const dayOfMonth = today.getUTCDate();          // 1-31
  const dayOfWeek  = today.getUTCDay();           // 0=Sun .. 6=Sat
  const month      = today.getUTCMonth();         // 0-11
  const recDay     = parseInt(rec.day) || 1;
  switch ((rec.type || '').toLowerCase()) {
    case 'daily':
      return true;
    case 'weekly':
      // recDay: 1=Sunday .. 7=Saturday (כמו שמוצג למשתמש)
      return (dayOfWeek + 1) === recDay;
    case 'biweekly':
      // כל שבועיים — נבדוק שזה היום בשבוע + שמספר השבוע מאז epoch זוגי
      if ((dayOfWeek + 1) !== recDay) return false;
      const weekNum = Math.floor((today.getTime() / (7 * 24 * 60 * 60 * 1000)));
      return weekNum % 2 === 0;
    case 'monthly':
      return dayOfMonth === recDay;
    case 'bimonthly':
      // חודשיים — נחליט פסיקה לפי חודש זוגי/אי-זוגי
      return dayOfMonth === recDay && month % 2 === 0;
    case 'quarterly':
      return dayOfMonth === recDay && month % 3 === 0;
    case 'yearly':
      // לשנתי, rec.day יכול להיות 'MM-DD' או רק יום
      if (typeof rec.day === 'string' && rec.day.includes('-')) {
        const [m, d] = rec.day.split('-').map(Number);
        return month === (m - 1) && dayOfMonth === d;
      }
      return dayOfMonth === recDay;
    case 'custom':
      // תאריך קבוע — מטופל ע"י date field
      return false;
    default:
      return false;
  }
}

module.exports = async (req, res) => {
  // תאריך היום בפורמט YYYY-MM-DD (ישראל = UTC+3)
  const nowIL  = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const today  = nowIL.toISOString().split('T')[0];

  let notified = 0;

  // ── שלוף כל המשתמשים ──
  const uResp  = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users?key=${FIREBASE_API_KEY}&pageSize=200`
  );
  const uData  = await uResp.json();
  const users  = (uData.documents || []).map(d => ({
    id:    d.name?.split('/').pop() || '',
    email: d.fields?.email?.stringValue || ''
  })).filter(u => u.id);

  const userByEmail = {};
  for (const u of users) {
    if (u.email) userByEmail[u.email.toLowerCase()] = u;
  }

  // ══════════════════════════════════════════════════════
  // חלק א׳: users/{uid}/data/tasks — מערך משימות אישיות
  // ══════════════════════════════════════════════════════
  for (const user of users) {
    let doc;
    try {
      const r = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${user.id}/data/tasks?key=${FIREBASE_API_KEY}`
      );
      doc = await r.json();
    } catch (e) { continue; }

    if (!doc?.fields) continue;

    const tasksArr = doc.fields?.tasks?.arrayValue?.values || [];
    const due = [];
    for (const tv of tasksArr) {
      const f      = tv.mapValue?.fields || {};
      const status = f.status?.stringValue || '';
      const date   = f.date?.stringValue   || '';
      const title  = f.title?.stringValue  || f.text?.stringValue || '';
      if (!title || status === 'done') continue;

      // 1) תאריך יעד = היום
      const matchByDate = date === today;

      // 2) משימה שנדחתה (snoozed) — בודקים אם תאריך הדחייה הוא היום
      const snoozedUntilMs = f.snoozedUntil?.integerValue || f.snoozedUntil?.doubleValue || f.snoozedUntil?.stringValue || null;
      const snoozedDate    = epochToILDate(snoozedUntilMs);
      const matchBySnooze  = snoozedDate && snoozedDate === today;

      // 3) משימה חוזרת — בודקים אם היום הוא יום של חזרה לפי הסכמה
      let matchByRecurring = false;
      const recValues = f.recurring?.mapValue?.fields;
      if (recValues) {
        const rec = {
          type:             recValues.type?.stringValue || '',
          day:              recValues.day?.stringValue || recValues.day?.integerValue || '1',
          remindDaysBefore: parseInt(recValues.remindDaysBefore?.integerValue || recValues.remindDaysBefore?.stringValue || '0'),
        };
        matchByRecurring = isRecurringToday(rec, today);
      }

      if (matchByDate || matchBySnooze || matchByRecurring) {
        due.push(title);
      }
    }
    if (!due.length) continue;

    const list = due.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const sent = await sendPush(user.id,
      `📅 משימות להיום (${due.length})`,
      list.slice(0, 200)
    );
    if (sent > 0) notified++;
  }

  // ══════════════════════════════════════════════════════
  // חלק ב׳: sharedTasks — dueDate === today → התראה לעובד
  // ══════════════════════════════════════════════════════
  const stResp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/sharedTasks?key=${FIREBASE_API_KEY}&pageSize=200`
  );
  const stData = await stResp.json();
  const sharedDue = (stData.documents || []).filter(d => {
    const f = d.fields || {};
    return f.status?.stringValue === 'pending' &&
           (f.dueDate?.stringValue || '') === today;
  });

  // קבץ לפי עובד
  const byWorker = {};
  for (const doc of sharedDue) {
    const f             = doc.fields;
    const assigneeEmail = (f.assigneeEmail?.stringValue || '').toLowerCase();
    const title         = f.title?.stringValue || '';
    if (!assigneeEmail || !title) continue;
    if (!byWorker[assigneeEmail]) byWorker[assigneeEmail] = [];
    byWorker[assigneeEmail].push(title);
  }

  for (const [email, titles] of Object.entries(byWorker)) {
    const worker = userByEmail[email];
    if (!worker) continue;
    const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const sent = await sendPush(worker.id,
      `📅 משימות שהוגדרו להיום (${titles.length})`,
      list.slice(0, 200)
    );
    if (sent > 0) notified++;
  }

  return res.status(200).json({ ok: true, notified, date: today });
};
