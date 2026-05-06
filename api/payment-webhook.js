const fetch = require('./_firestore');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

// מחירים לזיהוי תוכנית
const PLAN_BY_AMOUNT = {
  '20': 'basic',
  '50': 'business'
};

module.exports = async (req, res) => {
  // YoPay שולח POST עם נתוני התשלום
  const body = req.body || {};

  console.log('payment-webhook received:', JSON.stringify(body));

  // חלץ אימייל, סכום וסטטוס
  const email  = (body.customer_email || body.email || body.Email || '').toLowerCase().trim();
  const amount = String(body.sum || body.amount || body.Amount || body.price || '').replace(/[^\d]/g,'');
  const status = (body.status || body.Status || body.payment_status || 'success').toLowerCase();

  // אשר רק תשלומים מוצלחים
  if(status && status !== 'success' && status !== 'approved' && status !== '1') {
    console.log('payment not successful, status:', status);
    return res.status(200).json({ ok: false, reason: 'payment not successful' });
  }

  if(!email) {
    console.log('no email in webhook');
    return res.status(200).json({ ok: false, reason: 'no email' });
  }

  // זהה תוכנית לפי סכום
  const plan = PLAN_BY_AMOUNT[amount] || (parseInt(amount) <= 25 ? 'basic' : 'business');

  // מצא משתמש לפי אימייל ב-Firestore
  const queryResp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
          limit: 1
        }
      })
    }
  );
  const queryData = await queryResp.json();
  if(!Array.isArray(queryData) || !queryData[0]?.document) {
    console.log('user not found for email:', email);
    return res.status(200).json({ ok: false, reason: 'user not found' });
  }

  const uid = queryData[0].document.name.split('/').pop();

  // עדכן subscription ו-plan ב-Firestore
  const updateResp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=subscription&updateMask.fieldPaths=plan&updateMask.fieldPaths=paidAt&key=${FIREBASE_API_KEY}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          subscription: { stringValue: plan },
          plan:         { stringValue: plan },
          paidAt:       { stringValue: new Date().toISOString() }
        }
      })
    }
  );

  console.log('subscription updated → uid:', uid, 'plan:', plan);
  return res.status(200).json({ ok: true, uid, plan });
};
