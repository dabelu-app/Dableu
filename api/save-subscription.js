const fetch = require('./_firestore');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { subscription, userId } = req.body;
  if (!subscription) return res.status(400).json({ error: 'missing subscription' });

  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/pushSubscriptions?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
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
