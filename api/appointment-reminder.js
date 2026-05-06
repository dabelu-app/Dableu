const fetch = require('./_firestore');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

async function sendWhatsApp(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }) }
  );
}

module.exports = async (req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // שאיל פגישות למחר שתזכורת לא נשלחה
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: tomorrowStr } } },
                { fieldFilter: { field: { fieldPath: 'reminderSent' }, op: 'EQUAL', value: { booleanValue: false } } }
              ]
            }
          }
        }
      })
    }
  );

  const data = await resp.json();
  const appointments = Array.isArray(data) ? data.filter(d => d.document) : [];

  let sent = 0;
  for (const item of appointments) {
    const doc    = item.document;
    const fields = doc.fields;
    const chatId = fields.chatId?.stringValue;
    const time   = fields.time?.stringValue || '';
    const title  = fields.title?.stringValue || 'פגישה';
    const docId  = doc.name.split('/').pop();

    if (chatId) {
      const timeStr = time ? ` בשעה ${time}` : '';
      await sendWhatsApp(chatId,
        `🔔 תזכורת לפגישה!\n\nמחר יש לך פגישה${timeStr}\n📋 ${title}\n\nנתראה! 👋`
      );

      // סמן תזכורת כנשלחה
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/appointments/${docId}?updateMask.fieldPaths=reminderSent&key=${FIREBASE_API_KEY}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { reminderSent: { booleanValue: true } } })
        }
      );
      sent++;
    }
  }

  return res.status(200).json({ ok: true, sent, date: tomorrowStr });
};
