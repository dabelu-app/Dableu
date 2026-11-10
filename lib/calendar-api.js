// נקודת הקצה של האפליקציה ל-Google Calendar (מוגשת דרך api/cron.js?type=calendar, והכתובת הישנה /api/delete-appointment מופנית אליה ב-vercel.json)
// (מגבלת הפונקציות של Vercel Hobby היא 12). הקריאות הישנות בלי action ממשיכות לעבוד.
//
//   { googleEventId }                                   — תאימות אחורה: מחיקה מהיומן המרכזי
//   { action:'delete', uid, googleEventId, personalEventId, personalCalendarId }
//   { action:'upsert', uid, apptId }                    — יוצר/מעדכן את הפגישה ביומן המרכזי וביומן האישי של המשתמש
//   { action:'test',   calendarId }                     — בודק שיש הרשאת כתיבה ליומן
//
// יומן אישי נלקח תמיד ממסמך המשתמש (users/{uid}.googleCalendarId) ולא מהלקוח, והפגישה נקראת מ-Firestore
// ולא מגוף הבקשה — כך אי אפשר לכוון אירועים ליומן שרירותי.

const { fsFetch } = require('./firestore');
const cal = require('./calendar');

const str = (f, k) => f?.[k]?.stringValue || '';

async function getFields(path) {
  const r = await fsFetch(path);
  if (!r.ok) return null;
  const d = await r.json();
  return d.fields || {};
}

// patch אם יש מזהה אירוע, אחרת (או אם האירוע נמחק ביומן) — יצירה
async function upsertEvent(calendarId, eventId, resource) {
  if (eventId) {
    try { return await cal.patchEvent(calendarId, eventId, resource); }
    catch (e) { if (![404, 410].includes(e?.code)) throw e; }
  }
  return cal.insertEvent(calendarId, resource, 'none');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return res.status(200).json({ ok: false, error: 'no service account' });

  const { action, uid, apptId, googleEventId, personalEventId, personalCalendarId, calendarId } = req.body || {};
  const central = process.env.GOOGLE_CALENDAR_ID || '';

  try {
    // ── בדיקת חיבור ליומן ──
    if (action === 'test') {
      if (!calendarId) return res.status(400).json({ ok: false, error: 'missing calendarId' });
      try { await cal.testWrite(calendarId); return res.status(200).json({ ok: true }); }
      catch (e) { return res.status(200).json({ ok: false, error: cal.describeError(e) }); }
    }

    // ── יצירה/עדכון ──
    if (action === 'upsert') {
      if (!uid || !apptId) return res.status(400).json({ ok: false, error: 'missing uid/apptId' });
      const af = await getFields(`/appointments/${encodeURIComponent(apptId)}`);
      if (!af) return res.status(200).json({ ok: false, error: 'appointment not found' });
      if (str(af, 'userId') !== uid) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (str(af, 'type') === 'reminder' || !str(af, 'date')) return res.status(200).json({ ok: true, skipped: true });

      const uf = await getFields(`/users/${encodeURIComponent(uid)}`);
      const personal = str(uf, 'googleCalendarId');
      const resource = cal.buildEvent({
        title: str(af, 'title'), date: str(af, 'date'), time: str(af, 'time'),
        clientName: str(af, 'clientName'), description: str(af, 'notes') || undefined
      });

      const out = { ok: true };
      let newCentral = str(af, 'googleEventId');
      let newPersonal = str(af, 'personalEventId');
      let newPersonalCal = str(af, 'personalCalendarId');

      if (central) {
        try { newCentral = await upsertEvent(central, newCentral, resource); }
        catch (e) { console.error('[cal] central failed:', e.message); out.centralError = cal.describeError(e); }
      }
      if (personal && personal !== central) {
        try {
          // התחברו ליומן אחר מאז הפעם הקודמת — האירוע הישן שייך ליומן הקודם
          const prev = (newPersonalCal === personal) ? newPersonal : '';
          newPersonal = await upsertEvent(personal, prev, resource);
          newPersonalCal = personal;
        } catch (e) { console.error('[cal] personal failed:', e.message); out.personalError = cal.describeError(e); }
      }

      const mask = ['googleEventId', 'personalEventId', 'personalCalendarId'].map(k => `updateMask.fieldPaths=${k}`).join('&');
      await fsFetch(`/appointments/${encodeURIComponent(apptId)}?${mask}&currentDocument.exists=true`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: {
          googleEventId:      { stringValue: newCentral || '' },
          personalEventId:    { stringValue: newPersonal || '' },
          personalCalendarId: { stringValue: newPersonalCal || '' }
        }})
      }).catch(e => console.warn('[cal] could not store event ids:', e.message));

      return res.status(200).json({ ...out, googleEventId: newCentral, personalEventId: newPersonal });
    }

    // ── מחיקה ──
    // action:'delete' וגם הקריאה הישנה (בלי action) מוחקות את האירוע מהיומן המרכזי
    if (googleEventId) {
      await cal.deleteEvent(central, googleEventId).catch(e => console.warn('[cal] delete central:', e.message));
    }
    if (action === 'delete' && uid && personalEventId && personalCalendarId) {
      const uf = await getFields(`/users/${encodeURIComponent(uid)}`);
      if (str(uf, 'googleCalendarId') === personalCalendarId) {
        await cal.deleteEvent(personalCalendarId, personalEventId).catch(e => console.warn('[cal] delete personal:', e.message));
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[calendar api] error:', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
};
