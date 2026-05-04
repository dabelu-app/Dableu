// debug-email.js — endpoint זמני לאבחון בעיות זיהוי עובד במייל
// קריאה: GET /api/debug-email?email=your@email.com
const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Missing ?email= parameter' });

  const result = { email, steps: [] };

  // שלב 1: מצא משתמש לפי מייל
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
          limit: 1
        }})
      }
    );
    const data = await resp.json();
    const userDoc = Array.isArray(data) && data[0]?.document ? data[0].document : null;

    if (!userDoc) {
      result.steps.push({ step: 1, label: 'user lookup', status: 'NOT FOUND', email });
      return res.status(200).json(result);
    }

    const userId = userDoc.name.split('/').pop();
    result.steps.push({ step: 1, label: 'user lookup', status: 'FOUND', userId,
      name: userDoc.fields?.name?.stringValue,
      userDocFields: Object.keys(userDoc.fields || {})
    });
    result.userId = userId;

    // שלב 2: בדוק location 1 — team ישיר על מסמך המשתמש
    const directTeam = userDoc.fields?.team?.arrayValue?.values || [];
    result.steps.push({ step: 2, label: 'location1 (user.team field)', count: directTeam.length });

    // שלב 3: בדוק location 2 — users/{uid}/data/team
    try {
      const r2 = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userId}/data/team?key=${FIREBASE_API_KEY}`
      );
      const d2 = await r2.json();
      const arr2 = d2.fields?.team?.arrayValue?.values || [];
      result.steps.push({
        step: 3, label: 'location2 (users/{uid}/data/team)',
        docExists: !!d2.fields,
        rawKeys: d2.fields ? Object.keys(d2.fields) : [],
        teamArrayLength: arr2.length,
        members: arr2.map(v => ({
          name: v.mapValue?.fields?.name?.stringValue,
          email: v.mapValue?.fields?.email?.stringValue,
          phone: v.mapValue?.fields?.phone?.stringValue,
          notify: v.mapValue?.fields?.notify?.stringValue,
          allFields: Object.keys(v.mapValue?.fields || {})
        }))
      });
    } catch(e) { result.steps.push({ step: 3, label: 'location2', error: e.message }); }

    // שלב 4: בדוק location 3 — users/{uid}/team subcollection
    try {
      const r3 = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userId}/team?key=${FIREBASE_API_KEY}&pageSize=50`
      );
      const d3 = await r3.json();
      result.steps.push({
        step: 4, label: 'location3 (users/{uid}/team subcollection)',
        docsCount: (d3.documents || []).length,
        members: (d3.documents || []).map(doc => ({
          name: doc.fields?.name?.stringValue,
          email: doc.fields?.email?.stringValue
        }))
      });
    } catch(e) { result.steps.push({ step: 4, label: 'location3', error: e.message }); }

    // שלב 5: רשימת כל ה-subcollections של המשתמש
    try {
      const r4 = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userId}:listCollectionIds?key=${FIREBASE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const d4 = await r4.json();
      result.steps.push({ step: 5, label: 'user subcollections', collections: d4.collectionIds || [] });
    } catch(e) { result.steps.push({ step: 5, label: 'subcollections', error: e.message }); }

    // שלב 6: רשימת מסמכים תחת users/{uid}/data
    try {
      const r5 = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userId}/data?key=${FIREBASE_API_KEY}&pageSize=20`
      );
      const d5 = await r5.json();
      result.steps.push({
        step: 6, label: 'docs under users/{uid}/data',
        docs: (d5.documents || []).map(d => d.name.split('/').pop())
      });
    } catch(e) { result.steps.push({ step: 6, label: 'data subcollection list', error: e.message }); }

  } catch(e) {
    result.error = e.message;
  }

  return res.status(200).json(result);
};
