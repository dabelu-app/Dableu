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
      if (status !== 'done' && date === today && title) {
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
