const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

// שולח הודעת "ברוך הבא" למספר החדש אחרי שמשתמש שינה את מספר הטלפון בהגדרות.
// נקרא דרך api/cron?type=notify-number-change&chatId=972...&name=...
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const digits = (q.chatId || (req.body && req.body.chatId) || '').toString().replace(/[^\d]/g, '');
  const name   = (q.name   || (req.body && req.body.name)   || '').toString().trim();
  if (!digits) return res.status(400).json({ ok: false, error: 'missing chatId' });

  // אבטחה: שולחים רק אם המספר אכן רשום כ-chatId של משתמש קיים (מונע שליחת ספאם שרירותית).
  // ניסיון חוזר — כי מיד אחרי שינוי המספר ייתכן שהעדכון עדיין לא התפשט לשאילתה.
  async function chatIdRegistered(cid) {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: { fieldFilter: { field: { fieldPath: 'chatId' }, op: 'EQUAL', value: { stringValue: cid } } },
          limit: 1
        }})
      }
    );
    const data = await r.json();
    return Array.isArray(data) && data.length > 0 && !!data[0].document;
  }
  try {
    let exists = false;
    for (let i = 0; i < 4 && !exists; i++) {
      if (i) await new Promise(r => setTimeout(r, 1200));
      exists = await chatIdRegistered(digits);
    }
    if (!exists) return res.status(404).json({ ok: false, error: 'chatId not registered to any user' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'lookup failed: ' + e.message });
  }

  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  if (!instance || !token) return res.status(500).json({ ok: false, error: 'GREEN-API not configured' });

  const greeting = name ? `היי ${name}! 👋` : 'היי! 👋';
  const message =
    `${greeting}\n` +
    `ראיתי ששינית את מספר הטלפון למספר הזה — נוכל להמשיך להתכתב מכאן. ✅\n\n` +
    `אפשר לשלוח לי:\n` +
    `📋 משימות\n` +
    `🤝 פגישות\n` +
    `🔔 תזכורות\n\n` +
    `פשוט כתבו לי מה צריך ואני אדאג לזה. 💜`;

  try {
    const r = await fetch(
      `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: digits + '@c.us', message }) }
    );
    const out = await r.json().catch(() => ({}));
    return res.status(200).json({ ok: true, idMessage: out.idMessage || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
