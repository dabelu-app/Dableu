const fetch  = require('node-fetch');
const crypto = require('crypto');
const { fsFetch } = require('../lib/firestore');


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { subscription, userId } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'missing subscription' });

  // מזהה דטרמיניסטי לפי ה-endpoint → שמירה חוזרת מעדכנת את אותה רשומה (upsert)
  // ובכך נמנעת כפילות רישומים לאותו מכשיר.
  const docId = crypto.createHash('sha1').update(subscription.endpoint).digest('hex');

  await fsFetch(
    `/pushSubscriptions/${docId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          endpoint:  { stringValue: subscription.endpoint },
          keys:      { stringValue: JSON.stringify(subscription.keys) },
          userId:    { stringValue: userId || 'admin' },
          createdAt: { stringValue: new Date().toISOString() }
        }
      })
    }
  );

  return res.status(200).json({ ok: true });
};
