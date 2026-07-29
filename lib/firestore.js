// גישה ל-Firestore מצד השרת דרך חשבון שירות (service account).
//
// למה: עד היום קוד השרת פנה ל-Firestore REST עם מפתח ה-API הציבורי בלבד.
// מפתח כזה אינו הרשאה — הוא רק מזהה את הפרויקט — ולכן הוא עבד רק משום
// שכללי האבטחה היו פתוחים לגמרי (`allow read, write: if true`).
// ברגע שהכללים נסגרים, פנייה עם מפתח API נחסמת.
//
// חשבון שירות מקבל הרשאת גישה אמיתית ועוקף את כללי האבטחה כדין,
// כך שאפשר לסגור את המאגר לחלוטין בפני העולם ועדיין לתת לקרונים
// ולוובהוקים לעבוד.
//
// משתמש באותו GOOGLE_SERVICE_ACCOUNT_JSON שכבר מוגדר ב-Vercel עבור
// יומן Google — צריך רק לוודא שלחשבון השירות יש הרשאת Firestore
// בפרויקט (תפקיד "Cloud Datastore User").

const { google } = require('googleapis');
const fetch = require('node-fetch');

const PROJECT = process.env.FIREBASE_PROJECT || 'dabelu';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// גיבוי: מפתח ה-API הישן. משמש רק אם חשבון השירות אינו זמין או חסר
// הרשאת Firestore — כדי שהמעבר לא יפיל את הבוט והקרונים.
// עובד רק כל עוד כללי האבטחה פתוחים; ברגע שהם נסגרים הוא ייכשל,
// וזו בדיוק הנקודה שבה חשבון השירות חייב לעבוד.
const FALLBACK_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
let _saBroken = false;

let _authClient = null;

async function getAuthClient() {
  if (_authClient) return _authClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/datastore']
  });
  _authClient = await auth.getClient();
  return _authClient;
}

// getAccessToken של google-auth-library כבר מטפל בקאשינג וברענון הטוקן
async function getToken() {
  const client = await getAuthClient();
  const t = await client.getAccessToken();
  return typeof t === 'string' ? t : t.token;
}

// חתימה זהה ל-fetch, אבל הפרמטר הראשון הוא הנתיב שאחרי /documents
// לדוגמה: fsFetch(':runQuery', { method:'POST', body:... })
//         fsFetch(`/users/${uid}?updateMask.fieldPaths=plan`, { method:'PATCH', ... })
async function fsFetch(path, init = {}) {
  return request(BASE + path, init);
}

// כמו fsFetch, אבל מקבל נתיב משאב מלא כפי ש-Firestore מחזיר בשדה `name`
// (למשל "projects/dabelu/databases/(default)/documents/users/abc"), עם או בלי query.
// לדוגמה: fsFetchV1(`${doc.name}?updateMask.fieldPaths=seen`, { method:'PATCH', ... })
async function fsFetchV1(resourcePath, init = {}) {
  return request('https://firestore.googleapis.com/v1/' + resourcePath, init);
}

// מבצע את הקריאה עם חשבון שירות; אם אין חשבון שירות זמין או שהוא
// נדחה (403) — נופל בחזרה למפתח ה-API ומדווח בלוג.
async function request(url, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };

  if (!_saBroken) {
    try {
      const token = await getToken();
      const resp = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${token}` } });
      if (resp.status !== 403) return resp;
      console.error('[firestore] service account denied (403) — ' +
        'grant the "Cloud Datastore User" role to the service account. Falling back to API key.');
      _saBroken = true;
    } catch (e) {
      console.error('[firestore] service account unavailable — falling back to API key:', e.message);
      _saBroken = true;
    }
  }

  const sep = url.includes('?') ? '&' : '?';
  return fetch(`${url}${sep}key=${FALLBACK_API_KEY}`, { ...init, headers });
}

module.exports = { fsFetch, fsFetchV1, PROJECT, BASE };
