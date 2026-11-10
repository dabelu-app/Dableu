// Google Calendar — לוגיקה משותפת לבוט (api/whatsapp-webhook.js) ולסנכרון מהאפליקציה (api/delete-appointment.js).
//
// ההתחברות היא דרך חשבון השירות ב-GOOGLE_SERVICE_ACCOUNT_JSON: היומן חייב להיות משותף איתו בהרשאת עריכה.
// לכל אירוע מוגדרות תזכורות מפורשות (התראה בטלפון שעה ו-10 דקות לפני), כדי שלא נסתמך על ברירת המחדל של היומן.

const { google } = require('googleapis');

const TZ = 'Asia/Jerusalem';
const REMINDERS = {
  useDefault: false,
  overrides: [
    { method: 'popup', minutes: 60 },
    { method: 'popup', minutes: 10 }
  ]
};

function getCalendar() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/calendar'] });
  return google.calendar({ version: 'v3', auth });
}

// שעת התחלה (ברירת מחדל 09:00) ושעת סיום = שעה אחרי, בלי לחצות חצות
function eventTimes(date, time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  const startMin = m ? Math.min(Number(m[1]) * 60 + Number(m[2]), 23 * 60) : 9 * 60;
  const endMin = Math.min(startMin + 60, 23 * 60 + 59);
  const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return {
    start: { dateTime: `${date}T${hhmm(startMin)}:00`, timeZone: TZ },
    end:   { dateTime: `${date}T${hhmm(endMin)}:00`,   timeZone: TZ }
  };
}

function buildEvent({ title, date, time, clientName, description, attendeeEmail, location }) {
  const name = clientName || '';
  const base = title || 'פגישה';
  // כשהכותרת כבר כוללת את שם הלקוח ("פגישה עם דינה") לא מוסיפים אותו פעם שנייה
  const summary = (name && !base.includes(name)) ? `📋 ${base} — ${name}` : `📋 ${base}`;
  const resource = {
    summary,
    description: description || `פגישה שנקבעה דרך Dabelu${name ? ' עם ' + name : ''}`,
    ...eventTimes(date, time),
    reminders: REMINDERS
  };
  if (attendeeEmail) resource.attendees = [{ email: attendeeEmail, displayName: name }];
  if (location) resource.location = location;
  return resource;
}

async function insertEvent(calendarId, resource, sendUpdates) {
  const ev = await getCalendar().events.insert({
    calendarId, resource,
    sendUpdates: sendUpdates || (resource.attendees ? 'all' : 'none')
  });
  return ev.data.id;
}

async function patchEvent(calendarId, eventId, resource) {
  const ev = await getCalendar().events.patch({ calendarId, eventId, resource, sendUpdates: 'none' });
  return ev.data.id;
}

async function deleteEvent(calendarId, eventId) {
  if (!calendarId || !eventId) return;
  await getCalendar().events.delete({ calendarId, eventId });
}

// יוצר ומוחק אירוע בדיקה — מוכיח שיש לחשבון השירות הרשאת כתיבה ביומן
async function testWrite(calendarId) {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const date = d.toISOString().slice(0, 10);
  const id = await insertEvent(calendarId, buildEvent({ title: 'בדיקת חיבור Dabelu', date, time: '23:00' }), 'none');
  await deleteEvent(calendarId, id);
  return true;
}

function describeError(e) {
  const code = e?.code || e?.response?.status;
  if (code === 404) return 'היומן לא נמצא — בדקו את מזהה היומן.';
  if (code === 403 || code === 401) return 'אין הרשאה ליומן — שתפו אותו עם חשבון השירות בהרשאת "ביצוע שינויים באירועים".';
  return 'שגיאה בגישה ליומן: ' + (e?.message || 'לא ידוע');
}

module.exports = { TZ, REMINDERS, buildEvent, insertEvent, patchEvent, deleteEvent, testWrite, describeError };
