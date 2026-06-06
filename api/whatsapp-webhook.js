const FormData = require('form-data');
const fetch    = require('node-fetch');
const { google } = require('googleapis');

// ═══════════════════════════════════════════════════════════════════
// לוח שנה עברי — מימוש מקומי, ללא ספריה חיצונית
// Month numbering: 7=Tishrei…12=Adar, 1=Nisan…6=Elul (as @hebcal/core)
// ═══════════════════════════════════════════════════════════════════
function _hIsLeap(y){return((7*y+1)%19)<7;}
function _hElapsedDays(y){
  const m=Math.floor((235*y-234)/19);
  const p=12084+13753*m;
  let d=m*29+Math.floor(p/25920);
  if((3*(d+1))%7<3)d++;
  return d;
}
function _hDaysInYear(y){return _hElapsedDays(y+1)-_hElapsedDays(y);}
function _hLongCheshvan(y){return _hDaysInYear(y)%10===5;}
function _hShortKislev(y) {return _hDaysInYear(y)%10===3;}
function _hDaysInMonth(m,y){
  if(m===8)return _hLongCheshvan(y)?30:29;
  if(m===9)return _hShortKislev(y)?29:30;
  if(m===2||m===4||m===6||m===10||m===13)return 29;
  if(m===12)return _hIsLeap(y)?30:29;
  return 30;
}
// Hebrew date → absolute day (1 = 1 Tishrei 1 AM)
function _hDateToAbs(day,month,year){
  let d=_hElapsedDays(year)+1;
  const leap=_hIsLeap(year);
  const order=[7,8,9,10,11,12,...(leap?[13]:[]),1,2,3,4,5,6];
  for(const m of order){if(m===month)break;d+=_hDaysInMonth(m,year);}
  return d+day-1;
}
// JDN → Gregorian {year,month,day}
function _jdnToGreg(jdn){
  const l=jdn+68569,n=Math.floor(4*l/146097);
  const ll=l-Math.floor((146097*n+3)/4);
  const i=Math.floor(4000*(ll+1)/1461001);
  const lll=ll-Math.floor(1461*i/4)+31;
  const j=Math.floor(80*lll/2447);
  const day=lll-Math.floor(2447*j/80);
  const l4=Math.floor(j/11);
  return{year:100*(n-49)+i+l4,month:j+2-12*l4,day};
}
// Gregorian → JDN
function _gregToJDN(y,m,d){
  const a=Math.floor((14-m)/12),yy=y+4800-a,mm=m+12*a-3;
  return d+Math.floor((153*mm+2)/5)+365*yy+Math.floor(yy/4)-Math.floor(yy/100)+Math.floor(yy/400)-32045;
}
const _H_EPOCH=347997; // JDN for abs=1 (1 Tishrei 1 AM) — verified against known dates

// find Hebrew year containing absolute day abs
function _hYearFromAbs(abs){
  let y=Math.floor(abs/365.25)+1;
  while(_hElapsedDays(y+1)<abs)y++;
  while(_hElapsedDays(y)>=abs)y--;
  return y;
}
// current Hebrew month for a given Israel-time epoch (ms)
function currentHebMonth(ilNow){
  try{
    const d=new Date(ilNow);
    const jdn=_gregToJDN(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
    const abs=jdn-_H_EPOCH;
    const y=_hYearFromAbs(abs);
    const leap=_hIsLeap(y);
    const order=[7,8,9,10,11,12,...(leap?[13]:[]),1,2,3,4,5,6];
    let rem=abs-_hElapsedDays(y);
    for(const m of order){const dm=_hDaysInMonth(m,y);if(rem<=dm)return m;rem-=dm;}
    return 7;
  }catch(e){return null;}
}
console.log('[startup] Hebrew calendar: inline math v3 loaded OK (no @hebcal/core)');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT  = 'dabelu';
const SITE_URL          = 'https://cosmic-daifuku-4d8c28.netlify.app';

// ───────────────────────────────────────────
// WhatsApp
// ───────────────────────────────────────────
async function sendWhatsAppReply(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chatId, message }) }
  );
}

// ───────────────────────────────────────────
// Firestore — משתמשים
// ───────────────────────────────────────────
async function queryFirestoreByField(field, value) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ structuredQuery:{
        from:[{collectionId:'users'}],
        where:{ fieldFilter:{ field:{fieldPath:field}, op:'EQUAL', value:{stringValue:value} }},
        limit:1
      }})
    }
  );
  const data = await resp.json();
  return Array.isArray(data) && data.length > 0 && data[0].document;
}

// תאימות לאחור
async function queryFirestoreByChatId(phone) {
  return queryFirestoreByField('chatId', phone);
}

// מזהה משתמש לפי מספר טלפון — מנסה chatId, ואם לא נמצא גם waPhone ו-phone,
// בכל הווריאציות (972XXXXXXXXX / 0XXXXXXXXX). כך לקוח רשום מזוהה גם אם
// המספר שמור אצלו בשדה אחר מ-chatId.
async function getUserDoc(phone) {
  const digits = (phone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const variants = new Set();
  variants.add(digits);
  if (digits.startsWith('972')) variants.add('0' + digits.slice(3));
  else if (digits.startsWith('0')) variants.add('972' + digits.slice(1));
  else variants.add('972' + digits);
  for (const field of ['chatId', 'waPhone', 'phone']) {
    for (const v of variants) {
      const doc = await queryFirestoreByField(field, v);
      if (doc) return doc;
    }
  }
  return null;
}

// חיפוש שם בעל עסק לפי מספר טלפון — מנסה waPhone ו-phone בנוסף ל-chatId
async function resolveOwnerName(phone, fallbackDoc, senderDisplayName) {
  console.log(`[ownerName] phone=${phone} senderDisplayName="${senderDisplayName}"`);
  const fields = fallbackDoc?.fields || {};
  console.log(`[ownerName] doc fields: name="${fields.name?.stringValue}" officeName="${fields.officeName?.stringValue}" waName="${fields.waName?.stringValue}" email="${fields.email?.stringValue}"`);

  // 0. שם WA שנשמר בעבר (נשמר בעת כל קבלת הודעה)
  const cachedWaName = fields.waName?.stringValue || '';
  if (cachedWaName && !/^\d/.test(cachedWaName)) { console.log('[ownerName] from waName:', cachedWaName); return cachedWaName; }

  // helper: שם מובהק מתוך שדות מסמך — officeName קודם לשם המשרד
  function pickName(f) {
    return (f?.officeName?.stringValue || '').trim()
        || (f?.name?.stringValue || '').trim()
        || '';
  }

  // 1. שם ישירות מהמסמך שנמצא
  const fromDoc = pickName(fields);
  console.log('[ownerName] step1 fromDoc:', fromDoc, '| officeName=', fields.officeName?.stringValue, '| name=', fields.name?.stringValue);
  if (fromDoc) return fromDoc;

  // 2. חיפוש לפי email בכל המסמכים — מוצא כל מסמך עם name/officeName
  const docEmail = fallbackDoc?.fields?.email?.stringValue || '';
  if (docEmail) {
    try {
      const r = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ structuredQuery: {
            from:[{collectionId:'users'}],
            where:{ fieldFilter:{ field:{fieldPath:'email'}, op:'EQUAL', value:{stringValue:docEmail.toLowerCase()} }},
            limit:5
          }})
        }
      );
      const d = await r.json();
      if (Array.isArray(d)) {
        for (const item of d) {
          const n = pickName(item?.document?.fields);
          if (n) return n;
        }
      }
    } catch(e) {}
  }

  // 3. חיפוש לפי waPhone / phone בכל הפורמטים
  const variants = [phone];
  if (phone.startsWith('972')) { variants.push('0'+phone.slice(3)); variants.push(phone.slice(3)); }
  else if (phone.startsWith('0')) { variants.push('972'+phone.slice(1)); variants.push(phone.slice(1)); }

  for (const ph of variants) {
    for (const field of ['waPhone','phone','chatId']) {
      try {
        const r = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
          { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ structuredQuery: {
              from:[{collectionId:'users'}],
              where:{ fieldFilter:{ field:{fieldPath:field}, op:'EQUAL', value:{stringValue:ph} }},
              limit:1
            }})
          }
        );
        const d = await r.json();
        const n = d?.[0]?.document?.fields ? pickName(d[0].document.fields) : '';
        if (n) return n;
      } catch(e) {}
    }
  }

  // 4. שם תצוגה וואטסאפ (אם לא מספר)
  const cleanSender = (senderDisplayName || '').replace(/@.*/,'').trim();
  console.log('[ownerName] step4 cleanSender:', cleanSender);
  if (cleanSender && !/^\d/.test(cleanSender)) return cleanSender;

  // 5. שאל את GreenAPI על שם פרופיל הווצאפ של השולח
  try {
    const instance = process.env.GREENAPI_INSTANCE;
    const token    = process.env.GREENAPI_TOKEN;
    const r = await fetch(
      `https://7107.api.greenapi.com/waInstance${instance}/getContactInfo/${token}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ chatId: phone+'@c.us' }) }
    );
    const info = await r.json();
    const waName = info?.name || info?.contactName || info?.displayName || '';
    console.log('[ownerName] step5 GreenAPI waName:', waName);
    if (waName && !/^\d/.test(waName)) return waName;
  } catch(e) { console.warn('[ownerName] step5 error:', e.message); }

  // 6. email username כברירת מחדל אחרונה (למשל tasks@dabelu.pro → "tasks")
  const emailField = fields.email?.stringValue || '';
  if (emailField) {
    const emailUser = emailField.split('@')[0].replace(/[._\-+]/g, ' ').trim();
    if (emailUser) { console.log('[ownerName] step6 emailUser:', emailUser); return emailUser; }
  }

  console.log('[ownerName] → empty string (all steps failed)');
  return '';
}

async function patchUserField(docName, fieldName, value) {
  await fetch(
    `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=${fieldName}&key=${FIREBASE_API_KEY}`,
    { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields:{ [fieldName]:{ stringValue: value } } }) }
  );
}

async function setPending(docName, data) {
  await patchUserField(docName, 'pendingAppt', JSON.stringify(data));
}
async function clearPending(docName) {
  await patchUserField(docName, 'pendingAppt', '');
}

// ───────────────────────────────────────────
// לקוחות — מסוננים לפי userId (אזור אישי!)
// ───────────────────────────────────────────
async function getClients(userId) {
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ structuredQuery:{
          from:[{collectionId:'clients'}],
          where:{ fieldFilter:{ field:{fieldPath:'userId'}, op:'EQUAL', value:{stringValue: userId||''} }},
          limit:100
        }})
      }
    );
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(item => item.document)
      .map(item => ({
        id:       item.document.name.split('/').pop(),
        name:     item.document.fields?.name?.stringValue     || '',
        email:    item.document.fields?.email?.stringValue    || '',
        whatsapp: item.document.fields?.whatsapp?.stringValue || ''
      })).filter(c => c.name);
  } catch(e) { return []; }
}

async function createClient(name, email, whatsapp, userId) {
  try {
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients?key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fields:{
          name:      { stringValue: name      },
          email:     { stringValue: email     || '' },
          whatsapp:  { stringValue: whatsapp  || '' },
          userId:    { stringValue: userId    || '' },
          createdAt: { stringValue: new Date().toISOString() }
        }})
      }
    );
  } catch(e) { console.error('createClient error:', e); }
}

// עדכן לקוח קיים (של המשתמש הזה) או צור חדש
async function upsertClient(name, email, whatsapp, userId) {
  try {
    const clients = await getClients(userId);
    const existing = clients.find(c => c.name.toLowerCase() === (name||'').toLowerCase());
    if (existing && existing.id) {
      const fields = {};
      if (email)    fields.email    = { stringValue: email };
      if (whatsapp) fields.whatsapp = { stringValue: whatsapp };
      if (!Object.keys(fields).length) return;
      const masks = Object.keys(fields).map(k=>`updateMask.fieldPaths=${k}`).join('&');
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients/${existing.id}?${masks}&key=${FIREBASE_API_KEY}`,
        { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fields }) }
      );
    } else {
      await createClient(name, email, whatsapp, userId);
    }
  } catch(e) { console.error('upsertClient error:', e); }
}

function matchClient(clients, text) {
  const t = text.toLowerCase().trim();
  return clients.find(c =>
    c.name.toLowerCase().includes(t) || t.includes(c.name.split(' ')[0].toLowerCase())
  ) || null;
}

// חילוץ שם אדם מטקסט — מחזיר null אם זה ברכה/מילה שאינה שם
async function extractPersonName(text) {
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content:
`חלץ שם של אדם מהטקסט. החזר רק את השם בלבד, ללא הסברים.
אם הטקסט הוא ברכה, מילת פתיחה, מילה שאינה שם אדם, או שאין בו שם ברור — החזר: null

דוגמאות:
"דינה" → "דינה"
"יוסי כהן" → "יוסי כהן"
"עם רחל לוי" → "רחל לוי"
"שלום" → null
"היי" → null
"פגישה" → null
"כן" → null
"לא יודע" → null
"אברהם אבי" → "אברהם אבי"` },
          { role: 'user', content: text }
        ],
        max_tokens: 30,
        temperature: 0
      })
    });
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (!content || /^null$/i.test(content)) return null;
    return content;
  } catch(e) { return null; }
}

// ───────────────────────────────────────────
// סיווג הודעה (Groq)
// ───────────────────────────────────────────

// ─────────────────────────────────────────────────────
// המרת גימטריה לספרה (1-30)
// VALS בנוי מ-\uXXXX — אמין ב-encoding כלשהו
// ─────────────────────────────────────────────────────
function parseGematriya(s) {
  // הסר כל סוגי מרכאות/גרשיים — \uXXXX בלבד, בטוח בכל encoding
  // 05F3=׳ 05F4=״ 0022=” 0027=’ 201C=“ 201D=” 2018=‘ 2019=’
  // FF02=＂ FF07=＇ 00B4=´ 0060=`
  // strip ALL quote variants: geresh/gershayim, ASCII, curly double+single, fullwidth
  const clean = s.replace(/[^\u05D0-\u05EA]/g, '').trim();
  if (!clean) return null;
  // ערכי האותיות — כולן \uXXXX
  const V = {};
  V['א']=1; V['ב']=2; V['ג']=3; V['ד']=4; // א ב ג ד
  V['ה']=5; V['ו']=6; V['ז']=7; V['ח']=8; // ה ו ז ח
  V['ט']=9; V['י']=10; V['כ']=20; V['ל']=30; // ט י כ ל
  let sum = 0;
  for (const ch of clean) { if (V[ch]===undefined) return null; sum+=V[ch]; }
  return (sum>=1 && sum<=30) ? sum : null;
}

// ─────────────────────────────────────────────────────
// ממיר תאריך עברי (יום+חודש) → YYYY-MM-DD (לוח ישראלי)
// מימוש מקומי — ללא @hebcal/core
// אם התאריך עבר יותר מ-14 יום → קח שנה עברית הבאה
// ─────────────────────────────────────────────────────
function hebDateToGreg(day, month, ilNow) {
  try {
    const ilDate = new Date(ilNow);
    const jdnToday = _gregToJDN(ilDate.getUTCFullYear(), ilDate.getUTCMonth()+1, ilDate.getUTCDate());
    const absToday = jdnToday - _H_EPOCH;
    const hYear = _hYearFromAbs(absToday);

    let absTarget = _hDateToAbs(day, month, hYear);
    // אם עבר יותר מ-14 יום → קח שנה עברית הבאה
    if (absTarget < absToday - 14) absTarget = _hDateToAbs(day, month, hYear + 1);

    const g = _jdnToGreg(absTarget + _H_EPOCH);
    const dateStr = g.year+'-'+String(g.month).padStart(2,'0')+'-'+String(g.day).padStart(2,'0');
    console.log('[hebcal] day='+day+' month='+month+' hYear='+hYear+' -> '+dateStr);
    return dateStr;
  } catch(e) { console.error('[hebcal] inline error:', e.message); return null; }
}

// ─────────────────────────────────────────────────────
// זיהוי תאריך עברי בטקסט:
//   "כ״ה ניסן" | "ה׳ תמוז" | "25 ניסן" | "ראש חודש כסלו" | "כה בסיון"
// כל ה-patterns העבריים בנויים מ-\uXXXX בלבד.
// ─────────────────────────────────────────────────────
function extractHebCalDate(t, ilNow) {
  // [pattern, מספר חודש ב-HDate] — אדר א/ב לפני אדר סתם; כתיבים חלופיים לפני הכתיב הקצר
  const MONTHS = [
    ['אדר א',     12], // אדר א
    ['אדר ב',     13], // אדר ב
    ['אדר ראשון', 12], // כינוי נוסף לאדר א
    ['אדר שני',   13], // כינוי נוסף לאדר ב
    ['ניסן',       1], // ניסן
    ['אייר',       2], // אייר
    ['סיון',       3], // סיון
    ['תמוז',       4], // תמוז
    ['אב',         5], // אב
    ['אלול',       6], // אלול
    ['תשרי',       7], // תשרי
    ['מרחשוון',    8], // מרחשוון — כתיב תקני (וו כפול)
    ['מרחשון',     8], // מרחשון   — כתיב נפוץ (וו בודד)
    ['חשוון',      8], // חשוון    — כתיב תקני
    ['חשון',       8], // חשון     — כתיב נפוץ
    ['כסלו',       9], // כסלו
    ['טבת',       10], // טבת
    ['שבט',       11], // שבט
    ['אדר',       12], // אדר — חייב להיות אחרון (מניעת התאמה מוקדמת של "אדר א/ב")
  ];

  // U+05D1 = ב (מילית שייכות: "בניסן")
  const BET = 'ב';
  // האם תו הוא אות עברית U+05D0–U+05EA
  function isHebLetter(c) { if(!c) return false; const cp=c.codePointAt(0); return cp>=0x05D0&&cp<=0x05EA; }

  // חיפוש חודש עם גבולות מילה; מאפשר ב׳ שייכות מחוברת (כמו "בניסן")
  function findMonth(str, pat) {
    let i=0;
    while (i+pat.length<=str.length) {
      const p=str.indexOf(pat,i);
      if(p===-1) return null;
      const ca=p+pat.length<str.length?str[p+pat.length]:'';
      const cb=p>0?str[p-1]:'';
      if(isHebLetter(ca)){i=p+1;continue;} // לא גבול אחרי
      if(!isHebLetter(cb)) return {pos:p,len:pat.length}; // גבול נקי
      if(cb===BET&&!isHebLetter(p>1?str[p-2]:'')) return {pos:p-1,len:pat.length+1}; // ב׳ מחוברת
      i=p+1;
    }
    return null;
  }

  // ─── מרחק לוונשטיין (לשגיאות כתיב) ───
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = [];
    for (let i = 0; i <= m; i++) { dp[i] = new Array(n+1); dp[i][0] = i; }
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }

  // שלב 1: חיפוש מדויק
  let foundMonth=null, monthInfo=null;
  for(const [pat,month] of MONTHS) {
    const info=findMonth(t,pat);
    if(info){foundMonth=month;monthInfo=info;break;}
  }

  // שלב 2: חיפוש מטושטש (גיבוי לשגיאות כתיב) — רק למילים בנות 4+ תווים
  if (foundMonth===null) {
    const wordRe = /\S+/g;
    let wm;
    outer: while ((wm=wordRe.exec(t))!==null) {
      const origWord = wm[0];
      const wordPos  = wm.index;
      // הסר ב׳ שייכות מחוברת לצורך ההשוואה
      const hasBet   = origWord.codePointAt(0)===0x05D1 && origWord.length>1;
      const wClean   = hasBet ? origWord.slice(1) : origWord;
      if (wClean.length < 4) continue; // מילים קצרות — סיכוי גבוה ל-false positive
      for (const [pat,month] of MONTHS) {
        if (pat.includes(' ')) continue; // רק חודשים חד-מילתיים
        if (pat.length < 4) continue;
        // מרחק מקסימלי: 1 עריכה למילים קצרות, 2 עריכות למילים ארוכות (7+)
        const maxDist = wClean.length >= 7 ? 2 : 1;
        if (Math.abs(wClean.length - pat.length) > maxDist) continue;
        const dist = levenshtein(wClean, pat);
        if (dist <= maxDist) {
          foundMonth = month;
          monthInfo  = { pos: wordPos, len: origWord.length };
          console.log(`[hebcal] fuzzy "${origWord}" → "${pat}" (dist=${dist}, month=${month})`);
          break outer;
        }
      }
    }
  }

  // שלב 3: גימטריה עם גרשיים בתחילת הטקסט — ללא שם חודש → חודש עברי נוכחי
  // מטפל במקרה "כ\"ז יומולדת שמוליק" (יום בגימטריה, חודש לא צוין)
  // מניעת false-positive: בודק רק אם הגימטריה בתחילת הטקסט (לא אמצע משפט)
  if (foundMonth === null) {
    // נרמל ״ (Hebrew gershayim ״) ו-׳ (geresh) ל-" ו-'
    const tN = t.replace(/״/g, '"').replace(/׳/g, "'");
    // תבנית: רווחים אופציונליים + 1-2 אותיות עבריות + " + אות עברית + לא-עברית
    const m3 = /^\s*([א-ת]{1,2})"([א-ת])(?![א-ת])/.exec(tN);
    if (m3) {
      const dayNum = parseGematriya(m3[1] + m3[2]);
      if (dayNum && dayNum >= 1 && dayNum <= 30) {
        try {
          const curHebMonth = currentHebMonth(ilNow);
          const result = hebDateToGreg(dayNum, curHebMonth, ilNow);
          console.log('[hebcal] gematria-no-month "' + m3[0].trim() + '" day=' + dayNum + ' heb-month=' + curHebMonth + ' -> ' + result);
          return result;
        } catch(e) { console.error('[hebcal] gematria-no-month error:', e.message); }
      }
    }
  }

  if(foundMonth===null) return null;

  // ראש חודש = א׳ — pattern: ר(05E8)א(05D0)ש(05E9) ח(05D7)ו(05D5)ד(05D3)ש(05E9)
  const ROSH=String.fromCodePoint(0x05E8,0x05D0,0x05E9,0x0020,0x05D7,0x05D5,0x05D3,0x05E9);
  if(t.includes(ROSH)) return hebDateToGreg(1,foundMonth,ilNow);

  // חלץ מספר יום מהטקסט לפני שם החודש
  const before=t.slice(0,monthInfo.pos).trim();
  if(!before) return null;
  const words=before.split(/\s+/);
  const rawDay=words[words.length-1]||'';

  // מספר ערבי (25 ניסן) או גימטריה (כה ניסן)
  const am=rawDay.match(/^(\d{1,2})$/);
  if(am){const n=parseInt(am[1],10);return(n>=1&&n<=30)?hebDateToGreg(n,foundMonth,ilNow):null;}
  const hd=parseGematriya(rawDay);
  return hd?hebDateToGreg(hd,foundMonth,ilNow):null;
}

// ─────────────────────────────────────────────────────
// זיהוי תאריך ב-JavaScript בלבד — ה-AI לא מחשב ימים!
//
// CRITICAL: All Hebrew matching uses t.includes(pat) where pat is
// a JS string built from \uXXXX escapes.  A \uXXXX escape in a JS
// string literal is resolved by the JavaScript parser to a single
// Unicode code-point — independent of the source file's byte encoding.
// This makes the matching 100% reliable on any server.
// ─────────────────────────────────────────────────────
function extractDateJS(text) {
  if (!text) return null;
  // נרמל מרכאות מעוגלות → ASCII (לפני כל שאר העיבוד)
  // WhatsApp/מקלדות חכמות שולחות "כ"ז" עם U+201C/U+201D — נהפוך ל-"
  const textNorm = text.replace(/[\u201C\u201D\u2018\u2019\u00AB\u00BB\uFF02\uFF07]/g, '"');
  // Strip Hebrew nikud/cantillation U+0591-U+05C7 — using \uXXXX in regex, no Hebrew bytes
  const t = textNorm.replace(/[֑-ׇ]/g, '').normalize('NFC');

  // Israel time = UTC+3
  const IL_OFFSET = 3 * 60 * 60 * 1000;
  const ilNow    = Date.now() + IL_OFFSET;
  const todayDay = new Date(ilNow).getUTCDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

  function ymd(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  function shift(days) { return ymd(ilNow + days * 86400000); }

  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // Log raw code-points so we can see exactly what bytes arrived
  const hexDump = Array.from(t.slice(0,30)).map(c=>c.codePointAt(0).toString(16).padStart(4,'0')).join(' ');
  console.log(`[date] "${t}" todayDay=${todayDay}(${DAY_NAMES[todayDay]}) hex=[${hexDump}]`);

  // ─── today / tomorrow ───
  // Patterns built with String.fromCodePoint(hex) — zero Hebrew bytes in source.
  //   היום  = ה(05D4) י(05D9) ו(05D5) ם(05DD)
  const S_TODAY    = String.fromCodePoint(0x05D4,0x05D9,0x05D5,0x05DD);
  //   מחר   = מ(05DE) ח(05D7) ר(05E8)
  const S_TOMORROW = String.fromCodePoint(0x05DE,0x05D7,0x05E8);

  if (t.includes(S_TODAY))    { console.log('[date]->today');    return shift(0); }
  if (t.includes(S_TOMORROW)) { console.log('[date]->tomorrow'); return shift(1); }

  // ─── תאריך עברי (כ"ז סיון וכו') — נבדק לפני שמות ימים! ───
  // חובה: "שני" = יום שני אבל גם = "שני" כמספר סידורי ("יומולדת שני").
  // תאריך עברי מלא (יום+חודש) הוא ספציפי יותר ועדיף.
  const hebDateEarly = extractHebCalDate(t, ilNow);
  if (hebDateEarly) { console.log('[date] hebrew-cal (early) ->', hebDateEarly); return hebDateEarly; }

  // ─── weekday names ───
  // JS week: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  // Hebrew weekdays (all built from hex code points, no Hebrew source bytes):
  //   ראשון = ר(05E8) א(05D0) ש(05E9) ו(05D5) ן(05DF)  → Sun=0
  //   שני   = ש(05E9) נ(05E0) י(05D9)                  → Mon=1
  //   שלישי = ש(05E9) ל(05DC) י(05D9) ש(05E9) י(05D9)  → Tue=2
  //   רביעי = ר(05E8) ב(05D1) י(05D9) ע(05E2) י(05D9)  → Wed=3
  //   חמישי = ח(05D7) מ(05DE) י(05D9) ש(05E9) י(05D9)  → Thu=4
  //   שישי  = ש(05E9) י(05D9) ש(05E9) י(05D9)           → Fri=5
  //   שבת   = ש(05E9) ב(05D1) ת(05EA)                   → Sat=6
  const DAYS = [
    { name:'rishon',  pat:String.fromCodePoint(0x05E8,0x05D0,0x05E9,0x05D5,0x05DF), num:0 },
    { name:'sheni',   pat:String.fromCodePoint(0x05E9,0x05E0,0x05D9),               num:1 },
    { name:'shlishi', pat:String.fromCodePoint(0x05E9,0x05DC,0x05D9,0x05E9,0x05D9), num:2 },
    { name:'revii',   pat:String.fromCodePoint(0x05E8,0x05D1,0x05D9,0x05E2,0x05D9), num:3 },
    { name:'hamishi', pat:String.fromCodePoint(0x05D7,0x05DE,0x05D9,0x05E9,0x05D9), num:4 },
    { name:'shishi',  pat:String.fromCodePoint(0x05E9,0x05D9,0x05E9,0x05D9),         num:5 },
    { name:'shabbat', pat:String.fromCodePoint(0x05E9,0x05D1,0x05EA),               num:6 },
  ];

  // ─── "שבוע הבא" / "[יום] הבא" → היום המבוקש בשבוע (ראשון–שבת) שאחרי הנוכחי ───
  //   שבוע = ש(05E9) ב(05D1) ו(05D5) ע(05E2) ; הבא = ה(05D4) ב(05D1) א(05D0)
  //   דורשים ש-"הבא" יופיע אחרי "שבוע" או אחרי שם יום — כדי לא לתפוס "הבא" במובן "תביא".
  const S_SHAVUA = String.fromCodePoint(0x05E9,0x05D1,0x05D5,0x05E2);
  const S_HABA   = String.fromCodePoint(0x05D4,0x05D1,0x05D0);
  const nextWeek = new RegExp('(?:' + S_SHAVUA + '|' + DAYS.map(d => d.pat).join('|') + ')\\s+' + S_HABA).test(t);

  for (const { name, pat, num } of DAYS) {
    if (t.includes(pat)) {
      let diff;
      if (nextWeek) {
        // היום המבוקש בשבוע שאחרי הנוכחי (השבוע מתחיל בראשון)
        diff = (7 - todayDay) + num;
      } else {
        diff = num - todayDay;
        if (diff < 0) diff += 7;   // past weekday → schedule next week
        // diff==0 means today (same weekday) → schedule today
      }
      const result = shift(diff);
      console.log(`[date] matched ${name}(day=${num}) todayDay=${todayDay} diff=${diff} nextWeek=${nextWeek} -> ${result}`);
      return result;
    }
  }

  // ─── numeric date: DD/MM or DD-MM or DD.MM [/YYYY or /YY] ───
  const m = t.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  if (m) {
    const dy = m[1].padStart(2,'0');
    const mo = m[2].padStart(2,'0');
    const hasExplicitYear = !!m[3];
    const yr = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : String(new Date(ilNow).getUTCFullYear());
    let result = `${yr}-${mo}-${dy}`;
    // אם לא צוינה שנה מפורשת ותאריך עבר — קדם לשנה הבאה
    if (!hasExplicitYear) {
      const _il = new Date(ilNow);
      const _today = _il.getUTCFullYear()+'-'+String(_il.getUTCMonth()+1).padStart(2,'0')+'-'+String(_il.getUTCDate()).padStart(2,'0');
      if (result < _today) {
        result = (parseInt(yr)+1)+'-'+mo+'-'+dy;
        console.log(`[date] numeric past-date -> advanced to next year: ${result}`);
      }
    }
    console.log(`[date] numeric -> ${result}`);
    return result;
  }

  // (extractHebCalDate already ran above, before weekday check)
  console.log('[date] no match');
  return null;
}

// ─────────────────────────────────────────────────────
// זיהוי שעה מטקסט
// ─────────────────────────────────────────────────────
function extractTimeJS(text) {
  if (!text) return null;
  // HH:MM or H:MM or HH.MM
  const m1 = text.match(/(\d{1,2})[:\.](\d{2})/);
  if (m1) return `${m1[1].padStart(2,'0')}:${m1[2].padStart(2,'0')}`;
  // בשעה (05D1 05E9 05E2 05D4) or שעה (05E9 05E2 05D4) followed by a number
  const S_BESHA  = String.fromCodePoint(0x05D1,0x05E9,0x05E2,0x05D4); // בשעה
  const S_SHA    = String.fromCodePoint(0x05E9,0x05E2,0x05D4);         // שעה
  const m2re = new RegExp('(?:' + S_BESHA + '|' + S_SHA + ')\\s*(\\d{1,2})');
  const m2 = text.match(m2re);
  if (m2) return `${m2[1].padStart(2,'0')}:00`;
  return null;
}

async function classifyMessage(text) {
  // ── שלב 1: חלץ תאריך ב-JavaScript — אמין 100% ──
  const jsDate = extractDateJS(text);

  const todayDisplay = new Date().toLocaleDateString('he-IL', {
    weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Asia/Jerusalem'
  });
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.GROQ_KEY}`},
      body: JSON.stringify({
        // Llama 3.3 70B — מודל גדול הרבה יותר חכם מ-8B, מבין עברית טוב יותר.
        // עדיין חינמי דרך Groq וכמעט באותה מהירות.
        model:'llama-3.3-70b-versatile',
        // response_format JSON — Groq תומך בזה, מבטיח שהתשובה תהיה JSON תקין
        response_format: { type: 'json_object' },
        messages:[
          { role:'system', content:
`היום הוא ${todayDisplay}. אתה מסווג הודעות בעברית לעו"ד/יועצת מס. צריך להחזיר JSON בלבד.

═══ קטגוריות ═══
"appointment" — קביעת פגישה/תור/מפגש *עם אדם מסוים*. סימני זיהוי:
  • מילים מפורשות: "פגישה", "תור", "להיפגש", "מפגש", "נתראה", "נפגשים"
  • שאלות: "מתי פנוי/ה?", "אפשר לקבוע?", "יש זמן ב..?"
  • תבנית: "[שם אדם] ב[יום/שעה]" כשמשתמע מפגש
  • דרישה: צריך להיות שם של אדם להיפגש איתו

"reminder" — *תזכורת לאירוע/פעולה בתאריך ספציפי* ללא מפגש עם לקוח. סימני זיהוי:
  • מילים מפורשות: "תזכיר/י לי", "להזכיר לי", "תזכורת", "אל תשכח/י"
  • *כל הודעה עם תאריך + שעה מפורשים* (גם בלי מילים מפורשות) — זו תזכורת
  • פעולה/אירוע בתאריך עתידי: "שיעור נהיגה מחר ב-09:00", "להגיש מקדמה ב-25/5"
  • דרישה: חייב להיות תאריך (אחרת זה task)

"task" — *כל* בקשה אחרת ללא תאריך+שעה ספציפיים. למשל:
  • הוראה לעובד ללא תאריך מחייב: "תתקשרי לדינה", "שרה תכין דוח"
  • פעולה ללא תאריך: "להגיש מקדמה", "לשלוח חשבונית", "להעלות מסמך"
  • שאלה עם תוכן: "מה המצב עם...", "האם טופל..."
  • הודעה לא ברורה — תמיד "task" (כלל ברזל!)

"invalid" — *רק* ברכות/סטיקרים ריקים: "שלום", "היי", "בוקר טוב", "תודה", "ok", "👍"

═══ דוגמאות ═══
"פגישה עם דינה ביום שלישי" → appointment, with="דינה"
"להתקשר לדינה" → task
"שרה תכין דוח מע"מ" → task, assignee="שרה"
"מתי אני פנויה השבוע?" → appointment

"תזכיר לי להגיש מקדמה ב-25/5" → reminder, title="להגיש מקדמה"
"להגיש מקדמה 25/5" → reminder
"תזכורת: לשלם חשבונית ב-1/6" → reminder, title="לשלם חשבונית"
"אל תשכחי לשלוח דוח עד יום שלישי" → reminder
"אל תשכח מחר שיעור נהיגה בשעה 09:00" → reminder, title="שיעור נהיגה"
"מחר ב-14:00 לשלם ארנונה" → reminder, title="לשלם ארנונה"
"ביום ראשון ב-10:00 להזכיר לי טיפולים" → reminder, title="טיפולים"

⚠️ כלל ברזל לתזכורות: אם יש *תאריך + שעה ספציפית* בהודעה → תמיד reminder (גם בלי "תזכיר לי")

"להעלות חשבוניות של ישראל" → task (אין תאריך)
"להזכיר לי להגיש מקדמה" → task (אין תאריך מפורש)
"היי" → invalid

⚠️ תבנית "משימה ל[שם]":
"משימה לחיים לעשות דוח" → task, assignee="חיים", title="לעשות דוח"
"משימה ליוסי: להתקשר לדינה" → task, assignee="יוסי", title="להתקשר לדינה"
"לחיים תכין דוח" → task, assignee="חיים", title="תכין דוח"
"חיים: דוח מע\\"מ" → task, assignee="חיים", title="דוח מע\\"מ"

הבחנה חשובה:
  appointment = יש שם של אדם להיפגש איתו
  reminder    = יש תאריך אבל אין שם של אדם
  task        = אין תאריך מפורש או אין משמעות לוח זמנים

═══ פורמט JSON ═══
{
  "intent": "appointment" | "reminder" | "task" | "invalid",
  "date": "YYYY-MM-DD" | null,    // null — מחושב בקוד נפרד
  "time": "HH:MM" | null,
  "with": "שם הלקוח" | null,        // רק לappointment, אחרי "עם"
  "assignee": "שם העובד" | null,   // רק לtask, אם מצוין בתחילת ההודעה
  "title": "תוכן ההודעה ללא מילות חיבור (תזכיר לי, אל תשכח וכו') ובלי שם העובד אם בהתחלה"
}

⚠️ כללים נוספים:
1. אם בספק בין task ל-appointment — בחר "task"
2. assignee הוא רק אם השם בתחילת ההודעה ("שרה — תכיני דוח") או אחרי "ש[שם] תעשה"
3. title צריך להכיל את הפעולה/בקשה, לא להחזיר רק את השם
4. אל תכלול את התאריך/שעה ב-title — אבל כן שמור הקשר משמעותי`
          },
          { role:'user', content: text }
        ],
        max_tokens:250, temperature:0
      })
    });
    const data = await resp.json();
    const content = (data.choices?.[0]?.message?.content || '{}').trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const result = JSON.parse(match[0]);
      // ── שלב 2: תאריך JS תמיד מנצח את ה-AI ──
      if (jsDate) result.date = jsDate;
      // ── שלב 3: אסור להחזיר תאריך מהעבר — רק קדימה! ──
      if (result.date) {
        const _il = new Date(Date.now() + 3*60*60*1000);
        const _today = _il.getUTCFullYear()+'-'+String(_il.getUTCMonth()+1).padStart(2,'0')+'-'+String(_il.getUTCDate()).padStart(2,'0');
        if (result.date < _today) {
          // הייתה שנה שגויה (AI חישב שנה ישנה) — דחוף שנה קדימה
          const _p = result.date.split('-');
          result.date = (parseInt(_p[0])+1)+'-'+_p[1]+'-'+_p[2];
          console.log('[date] past-date pushed to next year:', result.date);
        }
      }
      return result;
    }
  } catch(err) { console.error('Classify error:', err); }
  return { intent:'task', date: jsDate, time:null, title:text };
}

// ───────────────────────────────────────────
// Google Calendar
// ───────────────────────────────────────────
async function createCalendarEvent(title, date, time, clientName, calendarId, clientEmail) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/calendar'] });
    const calendar = google.calendar({ version:'v3', auth });
    calendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    const startTime = time || '09:00';
    const [h] = startTime.split(':').map(Number);
    const endTime = `${String(h+1).padStart(2,'0')}:00`;
    const attendees = clientEmail ? [{ email:clientEmail, displayName:clientName }] : [];
    const event = await calendar.events.insert({
      calendarId,
      sendUpdates: clientEmail ? 'all' : 'none',
      resource:{
        summary:`📋 ${title} — ${clientName}`,
        description:`פגישה שנקבעה דרך WhatsApp עם ${clientName}`,
        start:{ dateTime:`${date}T${startTime}:00`, timeZone:'Asia/Jerusalem' },
        end:  { dateTime:`${date}T${endTime}:00`,   timeZone:'Asia/Jerusalem' },
        attendees
      }
    });
    return event.data.id;
  } catch(err) { console.error('Calendar error:', err); return null; }
}

// ───────────────────────────────────────────
// Firestore — שמירת פגישה / משימה
// ───────────────────────────────────────────
async function saveAppointment(title, date, time, clientName, chatId, googleEventId, userId) {
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/appointments?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields:{
        title:        {stringValue: title||''},
        date:         {stringValue: date||''},
        time:         {stringValue: time||''},
        clientName:   {stringValue: clientName},
        chatId:       {stringValue: chatId},
        googleEventId:{stringValue: googleEventId||''},
        userId:       {stringValue: userId||''},
        status:       {stringValue: 'confirmed'},
        type:         {stringValue: 'appointment'},
        createdAt:    {stringValue: new Date().toISOString()},
        reminderSent: {booleanValue: false}
      }})
    }
  );
}

// ── שמירת תזכורת (נרשמת באוסף appointments עם type='reminder' — מופיעה ביומן) ──
async function saveReminder(title, date, time, chatId, userId) {
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/appointments?key=${FIREBASE_API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields:{
        title:        {stringValue: title||''},
        date:         {stringValue: date||''},
        time:         {stringValue: time||''},
        clientName:   {stringValue: ''},
        chatId:       {stringValue: chatId||''},
        userId:       {stringValue: userId||''},
        status:       {stringValue: 'confirmed'},
        type:         {stringValue: 'reminder'},
        createdAt:    {stringValue: new Date().toISOString()},
        reminderSent: {booleanValue: false}
      }})
    }
  );
}

// מחיקת פגישה מ-Firestore לפי userId+date+clientName — מחזיר googleEventId
async function cancelAppointmentInFirestore(ownerUserId, date, clientName) {
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: 'appointments' }],
          where: { compositeFilter: { op: 'AND', filters: [
            { fieldFilter: { field: { fieldPath: 'userId'     }, op: 'EQUAL', value: { stringValue: ownerUserId } } },
            { fieldFilter: { field: { fieldPath: 'date'       }, op: 'EQUAL', value: { stringValue: date        } } },
            { fieldFilter: { field: { fieldPath: 'clientName' }, op: 'EQUAL', value: { stringValue: clientName  } } }
          ]}},
          limit: 1
        }})
      }
    );
    const data = await resp.json();
    if (!Array.isArray(data) || !data[0]?.document) {
      console.log(`[cancelAppt] no appointment found for userId=${ownerUserId} date=${date} client=${clientName}`);
      return null;
    }
    const doc           = data[0].document;
    const docPath       = doc.name;
    const googleEventId = doc.fields?.googleEventId?.stringValue || '';

    await fetch(`https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}`, { method: 'DELETE' });
    console.log(`🗑️ appointment deleted: ${docPath} | googleEventId=${googleEventId}`);
    return googleEventId || null;
  } catch(e) {
    console.error('cancelAppointmentInFirestore error:', e);
    return null;
  }
}

// מחיקת אירוע מגוגל קלנדר לפי eventId
async function deleteCalendarEvent(eventId, calendarId) {
  if (!eventId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth     = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/calendar'] });
    const calendar = google.calendar({ version: 'v3', auth });
    calendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    await calendar.events.delete({ calendarId, eventId });
    console.log(`🗑️ google calendar event deleted: ${eventId}`);
  } catch(e) {
    console.error('deleteCalendarEvent error:', e.message);
  }
}

// ───────────────────────────────────────────
// צוות עובדים — שליפה מ-Firestore (מנסה מספר מיקומים)
// ───────────────────────────────────────────
function parseTeamArray(arr) {
  return (arr || []).map(v => {
    const f = v.mapValue?.fields || {};
    // phone ו-whatsapp יכולים להיות שדות נפרדים — ניקח את מה שיש
    const phone = f.phone?.stringValue || f.whatsapp?.stringValue || '';
    return {
      name:  f.name?.stringValue  || '',
      email: f.email?.stringValue || '',
      phone
    };
  }).filter(m => m.name && m.name.length > 1);
}

async function getTeamMembers(userDocId, userDocFields) {
  // מיקום 1: שדה team ישיר במסמך המשתמש (users/{uid}.team)
  const directArr = userDocFields?.team?.arrayValue?.values;
  if (directArr && directArr.length > 0) {
    const members = parseTeamArray(directArr);
    console.log(`📋 team from user doc: ${members.length} members:`, members.map(m=>m.name));
    return members;
  }

  // מיקום 2: users/{uid}/data/team (sub-document)
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/data/team?key=${FIREBASE_API_KEY}`
    );
    const data = await resp.json();
    console.log(`📋 team subcollection raw:`, JSON.stringify(data).slice(0, 300));
    if (data.fields) {
      const arr = data.fields?.team?.arrayValue?.values || [];
      const members = parseTeamArray(arr);
      console.log(`📋 team from subcollection: ${members.length} members:`, members.map(m=>m.name));
      return members;
    }
  } catch(e) { console.error('getTeamMembers subcollection error:', e.message); }

  // מיקום 3: users/{uid}/team (subcollection עם מסמכים נפרדים)
  try {
    const resp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/team?key=${FIREBASE_API_KEY}&pageSize=50`
    );
    const data = await resp.json();
    if (data.documents && data.documents.length > 0) {
      const members = data.documents.map(doc => {
        const f = doc.fields || {};
        return {
          name:  f.name?.stringValue  || '',
          email: f.email?.stringValue || '',
          phone: f.phone?.stringValue || f.whatsapp?.stringValue || ''
        };
      }).filter(m => m.name && m.name.length > 1);
      console.log(`📋 team from docs: ${members.length} members:`, members.map(m=>m.name));
      return members;
    }
  } catch(e) { console.error('getTeamMembers team-docs error:', e.message); }

  console.log(`📋 no team found for userId=${userDocId}`);
  return [];
}

// התאמה גמישה של שם עובד לרשימת הצוות (כולל וריאציות עבריות)
function findWorkerByName(extractedName, team) {
  if (!extractedName || !team.length) return null;
  const q = extractedName.toLowerCase().trim();
  // 1. התאמה מדויקת
  for (const m of team) {
    if (m.name.toLowerCase() === q) return m;
  }
  // 2. שם פרטי מדויק
  for (const m of team) {
    const first = m.name.split(' ')[0].toLowerCase();
    const qFirst = q.split(' ')[0];
    if (first === qFirst) return m;
  }
  // 3. וריאציה עברית — אחד מתחיל בשני (רות↔רותי, יוסף↔יוסי)
  for (const m of team) {
    const first = m.name.split(' ')[0].toLowerCase();
    const qFirst = q.split(' ')[0];
    if (first.startsWith(qFirst) || qFirst.startsWith(first)) return m;
  }
  return null;
}

// מחפש שם עובד בתוך הטקסט (חיפוש רגקס כגיבוי)
function findWorkerMatch(text, team) {
  if (!text || !team.length) return null;
  const lower = text.toLowerCase().trim();
  for (const m of team) {
    if (!m.name || m.name.length < 2) continue;
    const full  = m.name.toLowerCase();
    const first = m.name.split(' ')[0].toLowerCase();
    if (first.length < 2) continue;
    // שם מלא בטקסט בכל מיקום
    if (lower.includes(full)) return m;
    // שם פרטי עם אות שימוש עברית לפניו (ל, מ, ב, ש, כ) בכל מיקום
    if (new RegExp(`(?:^|\\s)[לבמשכ]?${first}(?:[:\\-,\\s]|$)`).test(lower)) return m;
  }
  return null;
}

// ניקוי כותרת מרישום שם עובד בהתחלה
function cleanTitleFromWorker(title, workerName) {
  if (!workerName || !title) return title;
  const first = workerName.split(' ')[0];
  // נסיר תחיליות נפוצות כשהשם מופיע בתחילת ההודעה:
  // "משימה לחיים: ...", "לחיים: ...", "חיים: ...", "חיים - ...", "חיים, ..."
  // וגם עם השם המלא או השם הפרטי בלבד
  const cleaned = title
    .replace(new RegExp(`^משימה ל?${workerName}[:\\-,\\s]+`, 'i'), '')
    .replace(new RegExp(`^משימה ל?${first}[:\\-,\\s]+`,       'i'), '')
    .replace(new RegExp(`^ל?${workerName}[:\\-,\\s]+`,        'i'), '')
    .replace(new RegExp(`^ל?${first}[:\\-,\\s]+`,             'i'), '')
    .trim();
  // אם הניקוי "אכל" את כל ההודעה — נחזיר את המקור (כנראה שהתבנית לא הייתה רלוונטית)
  return cleaned || title;
}

// שמירת משימה — נשמרת ב-users/{uid}/data/tasks (המקום שהאפליקציה קוראת ממנו)
async function saveTask(title, clientName, source, userDocId, assignee, assigneeEmail) {
  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const taskFields = {
    id:          { stringValue: taskId },
    title:       { stringValue: title.trim() },
    assignee:    { stringValue: assignee || '' },
    clientName:  { stringValue: clientName || '' },
    source:      { stringValue: source || 'bot' },
    status:      { stringValue: 'pending' },
    priority:    { stringValue: 'normal' },
    createdAt:   { stringValue: new Date().toISOString() },
    description: { stringValue: source !== 'whatsapp-text' ? '🎤 תומלל מהודעה קולית' : '' }
  };
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:commit?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [{ transform: {
        document: `projects/${FIREBASE_PROJECT}/databases/(default)/documents/users/${userDocId}/data/tasks`,
        fieldTransforms: [{ fieldPath: 'tasks', appendMissingElements: { values: [{ mapValue: { fields: taskFields } }] } }]
      }}]})
    }
  );
  console.log(`💾 saveTask → users/${userDocId}/data/tasks | id:${taskId} | assignee:${assignee}`);
  return { ok: resp.ok, docId: taskId };
}

// יצירת sharedTask כדי שהעובד יראה את המשימה
async function createSharedTask(taskDocId, title, assigneeName, assigneeEmail, employerEmail, clientName, source) {
  try {
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/sharedTasks?documentId=${taskDocId}&key=${FIREBASE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fields:{
          title:             {stringValue: title},
          status:            {stringValue: 'pending'},
          priority:          {stringValue: 'normal'},
          description:       {stringValue: ''},
          assignee:          {stringValue: assigneeName},
          assigneeEmail:     {stringValue: assigneeEmail},
          employerEmail:     {stringValue: employerEmail},
          client:            {stringValue: clientName},
          source:            {stringValue: source},
          createdAt:         {stringValue: new Date().toISOString()},
          workerUnreadCount: {integerValue: '1'},
          unreadCount:       {integerValue: '0'},
          lastMessage:       {stringValue: ''},
          taskId:            {stringValue: taskDocId}
        }})
      }
    );
  } catch(e) { console.error('createSharedTask error:', e); }
}

// נרמול טלפון — מסיר את כל התווים שאינם ספרות (כולל תווי Unicode)
function normalizeWorkerPhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

// שליחת מייל לעובד
async function notifyWorkerByEmail(workerEmail, workerName, taskTitle, senderName) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
    });
    const SITE_URL = 'https://dabelu.vercel.app';
    const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
      <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe;border-radius:12px 12px 0 0">
        <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:90px;max-width:280px;display:block;margin:0 auto">
      </div>
      <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:20px 28px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">📋 משימה חדשה שובצה אליך!</h1>
      </div>
      <div style="padding:32px;background:#fff">
        <p style="font-size:16px;color:#1e293b;margin:0 0 8px">שלום <strong>${workerName}</strong> 👋</p>
        <p style="font-size:14px;color:#475569;margin:0 0 24px">${senderName} שיבצ/ה לך משימה חדשה:</p>
        <div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:10px;padding:18px 20px;margin-bottom:28px">
          <div style="color:#6366f1;font-size:12px;font-weight:600;margin-bottom:8px">📝 פרטי המשימה</div>
          <div style="color:#1e293b;font-size:16px;font-weight:700">${taskTitle}</div>
        </div>
        <div style="text-align:center">
          <a href="${SITE_URL}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700">פתח את Dabelu לאישור ←</a>
        </div>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
    </div>`;
    await transporter.sendMail({
      from: '"Dabelu מערכת משימות" <tasks@dabelu.pro>',
      to: workerEmail,
      subject: `📋 משימה חדשה: ${taskTitle}`,
      html
    });
    console.log('✅ worker email sent to:', workerEmail);
  } catch(e) { console.error('notifyWorkerByEmail error:', e.message); }
}

// שליחה לעובד לפי נתוני ההתקשרות שהוגדרו לו — ווצאפ אם יש טלפון, מייל אם יש מייל
async function notifyWorkerOfTask(workerMember, taskTitle, senderName) {
  const { name, email, phone } = workerMember;

  // ווצאפ — אם הוגדר טלפון לעובד
  if (phone) {
    try {
      const normalized = normalizeWorkerPhone(phone);
      if (normalized) {
        await sendWhatsAppReply(normalized + '@c.us',
          `📋 *משימה חדשה שובצה אליך!*\n\n📝 *תוכן המשימה:*\n${taskTitle}\n\n👤 הוקצה על ידי: ${senderName}\n\nיש לפתוח את המערכת לפרטים ולאישור ✅`
        );
        console.log('✅ worker WA sent to:', normalized);
      }
    } catch(e) { console.error('notifyWorker WA error:', e.message); }
  }

  // מייל — אם הוגדר מייל לעובד
  if (email) {
    await notifyWorkerByEmail(email, name, taskTitle, senderName);
  }

  if (!phone && !email) {
    console.warn(`⚠️ worker ${name} has no contact info — cannot notify`);
  }
}

// ───────────────────────────────────────────
// סיום קביעת פגישה
// pending.withName  = שם הלקוח
// pending.withEmail = מייל הלקוח (לזימון)
// senderCalId       = יומן גוגל אישי של השולח (אם חובר)
// ───────────────────────────────────────────
async function finalizeAppointment(chatId, userDocName, pending, senderCalId, userId) {
  await clearPending(userDocName);

  const apptWith     = pending.withName     || '';
  const apptEmail    = pending.withEmail    || '';
  const apptWhatsapp = pending.withWhatsapp || '';
  const cleanTitle   = `פגישה עם ${apptWith}`;

  let eventId = null;
  let addedToClientCalendar = false;

  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID) {
      // יומן של בעל העסק
      eventId = await createCalendarEvent(
        cleanTitle, pending.date, pending.time||null,
        apptWith, process.env.GOOGLE_CALENDAR_ID, apptEmail
      );
      // יומן אישי של השולח (אם חיבר)
      if (senderCalId) {
        await createCalendarEvent(
          cleanTitle, pending.date, pending.time||null,
          apptWith, senderCalId, apptEmail
        );
      }
      // ── בדוק אם הלקוח עצמו הוא משתמש רשום במערכת ──
      // מחפש לפי ווצאפ ואם לא נמצא — לפי מייל
      let clientUserDoc = null;
      if (apptWhatsapp) {
        const digits = apptWhatsapp.replace(/[^\d]/g, '');
        try { clientUserDoc = await getUserDoc(digits); } catch(e) {}
      }
      if (!clientUserDoc && apptEmail) {
        try {
          const resp = await fetch(
            `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ structuredQuery: {
                from: [{ collectionId: 'users' }],
                where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: apptEmail.toLowerCase() } } },
                limit: 1
              }})
            }
          );
          const data = await resp.json();
          if (Array.isArray(data) && data[0]?.document) clientUserDoc = data[0].document;
        } catch(e) {}
      }

      if (clientUserDoc) {
        const clientCalId    = clientUserDoc.fields?.googleCalendarId?.stringValue || '';
        const clientUserName = clientUserDoc.fields?.name?.stringValue || apptWith;
        if (clientCalId) {
          // שלוף מייל של בעל העסק לצורך הזמנה ביומן הלקוח
          let ownerEmail = '';
          try {
            const ownerResp = await fetch(
              `https://firestore.googleapis.com/v1/${userDocName}?key=${FIREBASE_API_KEY}`
            );
            const ownerData = await ownerResp.json();
            ownerEmail = ownerData.fields?.email?.stringValue || '';
          } catch(e) {}

          await createCalendarEvent(
            cleanTitle, pending.date, pending.time||null,
            clientUserName, clientCalId, ownerEmail
          );
          addedToClientCalendar = true;
          console.log(`📅 פגישה נוספה גם ליומן הלקוח ${clientUserName} (${clientCalId})`);
        }
      }
    }
  } catch(e) { console.error('Calendar finalize error:', e); }

  await saveAppointment(cleanTitle, pending.date, pending.time||'', apptWith, chatId, eventId, userId);

  const dateStr      = formatDateHebrew(pending.date);
  const timeStr      = pending.time ? ` בשעה ${pending.time}` : '';
  const inviteMsg    = apptEmail ? `\n📧 זימון נשלח ל-${apptEmail}` : '';
  const clientCalMsg = addedToClientCalendar ? `\n📅 נוסף גם ליומן של ${apptWith} אוטומטית!` : '';

  await sendWhatsAppReply(chatId,
    `✅ הפגישה נקבעה! 📆\n👤 עם: ${apptWith}\n📅 ${dateStr}${timeStr}${inviteMsg}${clientCalMsg}\n\n🔔 תקבל תזכורת יום לפני!`
  );
}

function formatDateHebrew(dateStr) {
  if (!dateStr) return '';
  // Append T12:00:00Z (noon UTC) so the date never shifts due to server timezone.
  // timeZone:'Asia/Jerusalem' ensures the weekday is displayed in Israel time.
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('he-IL', {
    weekday:'long', day:'numeric', month:'long', year:'numeric',
    timeZone:'Asia/Jerusalem'
  });
}

// ───────────────────────────────────────────
// עזר: אחרי שיש תאריך+שעה+שם — בדוק אם יש מייל
// אם כן → קבע. אם לא → שאל פרטי קשר.
// ───────────────────────────────────────────
// בניית הודעת זימון ברורה למוזמן לפגישה
function buildInviteMessage(ownerName, date, time) {
  const dateStr     = formatDateHebrew(date || '');
  // displayName: שם הבעלים, או 'העסק' כ-fallback מוחלט
  const displayName = ownerName || 'העסק';
  const lines = [
    `📅 *${displayName}* מזמין/ה אותך לפגישה!`,
    ''
  ];
  if (dateStr) lines.push(`🗓 ${dateStr}`);
  if (time)    lines.push(`🕐 בשעה ${time}`);
  lines.push('', 'נתראה! 👋');
  return lines.join('\n');
}

// שליחת זימון עם RSVP אם המוזמן הוא משתמש מערכת, אחרת זימון רגיל
async function sendInviteWithConfirmation(clientPhoneClean, effectiveOwner, date, time, ownerChatId, ownerDocName, clientDisplayName) {
  const digits     = clientPhoneClean.replace(/[^\d]/g, '');
  const normalized = digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
  const waId       = normalized + '@c.us';

  let clientUserDoc = null;
  try { clientUserDoc = await getUserDoc(digits); } catch(e) {}

  if (clientUserDoc) {
    // משתמש רשום — שלח זימון עם אפשרות אישור/ביטול
    const clientDocName   = clientUserDoc.name;
    const clientSavedName = (clientUserDoc.fields?.name?.stringValue || clientDisplayName || '').trim();
    const dateStr         = formatDateHebrew(date || '');
    const displayName     = effectiveOwner || 'העסק';
    const lines = [`📅 *${displayName}* מזמין/ה אותך לפגישה!`, ''];
    if (dateStr) lines.push(`🗓 ${dateStr}`);
    if (time)    lines.push(`🕐 בשעה ${time}`);
    lines.push('', '───────────────', '✅ לאישור שלח: *אשר*', '❌ לביטול שלח: *בטל*');

    await setPending(clientDocName, {
      step:        'confirm_appointment',
      date,
      time,
      ownerName:   effectiveOwner,
      ownerChatId,
      ownerDocName,
      clientName:  clientDisplayName || clientSavedName
    });
    await sendWhatsAppReply(waId, lines.join('\n'));
  } else {
    // לא משתמש מערכת — שלח זימון רגיל
    await sendWhatsAppReply(waId, buildInviteMessage(effectiveOwner, date, time));
  }
}

async function tryFinalize(chatId, userDocName, pending, senderCalId, res, userId, ownerName) {
  // Use stored ownerName from pending (persisted across messages) as primary source
  const effectiveOwner = pending.ownerName || ownerName || '';
  if (pending.withEmail || pending.withWhatsapp) {
    if (pending.withWhatsapp && !pending.withEmail) {
      const phoneClean = pending.withWhatsapp.replace(/[-\s+]/g, '');
      await sendInviteWithConfirmation(phoneClean, effectiveOwner, pending.date, pending.time, chatId, userDocName, pending.withName || '').catch(()=>{});
    }
    await finalizeAppointment(chatId, userDocName, pending, senderCalId, userId);
  } else {
    await setPending(userDocName, { ...pending, step:'ask_contact', contactAskedAt: new Date().toISOString() });
    await sendWhatsAppReply(chatId,
      `👤 ${pending.withName}\n📅 ${formatDateHebrew(pending.date)}${pending.time?' בשעה '+pending.time:''}\n\nשלח פרטי קשר לזימון:\n📧 כתובת מייל\n📱 מספר ווצאפ\nאו "ללא זימון"`
    );
  }
  return res.status(200).send('ok');
}

// ───────────────────────────────────────────
// MAIN HANDLER
// ───────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const body = req.body;
  if (!body || body.typeWebhook !== 'incomingMessageReceived')
    return res.status(200).send('ok');

  const { messageData, senderData } = body;
  const senderName = senderData?.senderName || senderData?.sender || 'לא ידוע';
  const chatId     = senderData?.chatId;
  const msgType    = messageData?.typeMessage;
  const phone      = chatId ? chatId.replace('@c.us','').replace('@g.us','') : '';
  const inText     = msgType === 'textMessage' ? (messageData.textMessageData?.textMessage || '').trim() : '';

  // ── תמיכה בשיתוף איש קשר (vCard): חילוץ מספר טלפון ושם — חסין לכל מבנה ──
  let sharedPhone = '', sharedContactName = '';
  {
    const mdStr = JSON.stringify(messageData || {});
    if (/contact/i.test(msgType || '') || /vcard|waid=/i.test(mdStr)) {
      const cd = messageData.contactMessageData
              || messageData.contactMessageContactData
              || (messageData.contactsArrayMessageData && (messageData.contactsArrayMessageData.contacts || [])[0])
              || {};
      sharedContactName = (cd.displayName || '').trim();
      // עדיפות ל-waid (מספר וואטסאפ נקי), אחרת TEL מתוך ה-vCard
      const waidM = mdStr.match(/waid=(\d{8,15})/);
      if (waidM) {
        sharedPhone = waidM[1];
      } else {
        const telM = mdStr.match(/TEL[^:]*:\s*([+\d\s\-().]{8,})/i);
        if (telM) sharedPhone = telM[1].replace(/[^\d]/g, '');
      }
    }
  }


  // ── שלוף מסמך משתמש (כולל pending ו-calId) ──
  let userDoc = null;
  try { userDoc = await getUserDoc(phone); } catch(err) { console.error('getUserDoc:', err); }

  if (!userDoc) {
    if (chatId) await sendWhatsAppReply(chatId, `❌ אינך מנוי במערכת Dabelu.\n\nלהרשמה:\n${SITE_URL}`);
    return res.status(200).send('not registered');
  }

  const userDocName  = userDoc.name;
  const userDocId    = userDocName.split('/').pop();          // ← מזהה ייחודי של המשתמש
  const clientEmail  = userDoc.fields?.email?.stringValue  || '';
  const clientName   = userDoc.fields?.name?.stringValue   || senderName;
  const senderCalId  = userDoc.fields?.googleCalendarId?.stringValue || '';

  const rawSenderName = senderData?.senderName || senderData?.chatName || senderData?.senderContactName || '';

  // ── שם בעל העסק ──
  // 1. officeName מהמסמך — הכי אמין, זה מה שהמשתמש הגדיר
  // 2. name מהמסמך — שם פרטי כ-fallback
  // 3. resolveOwnerName — חיפוש מורחב (email, waPhone, GreenAPI)
  // 4. rawSenderName — שם WA אם לא מספר
  // 5. email username
  const _docOfficeName = (userDoc.fields?.officeName?.stringValue || '').trim();
  const _docName       = (userDoc.fields?.name?.stringValue       || '').trim();
  let ownerName = _docOfficeName || _docName;
  console.log(`[webhook] doc lookup: officeName="${_docOfficeName}" name="${_docName}" → ownerName="${ownerName}" | phone=${phone}`);

  if (!ownerName) {
    ownerName = await resolveOwnerName(phone, userDoc, rawSenderName);
  }
  if (!ownerName) {
    const safeWaName = (rawSenderName && !/^\d/.test(rawSenderName)) ? rawSenderName : '';
    const emailFallback = clientEmail
      ? clientEmail.split('@')[0].replace(/[._\-+]/g, ' ').trim()
      : '';
    ownerName = safeWaName || emailFallback;
  }
  console.log(`[webhook] final ownerName="${ownerName}"`);

  // ── pending מתוך מסמך המשתמש ──
  const pendingStr = userDoc.fields?.pendingAppt?.stringValue || '';
  let pending = null;
  if (pendingStr) { try { pending = JSON.parse(pendingStr); } catch(e) {} }

  // ── בדיקת פקיעת תוקף ask_contact (מעל שעה ללא תגובה) ──
  if (pending && pending.step === 'ask_contact' && pending.contactAskedAt) {
    const elapsed = Date.now() - new Date(pending.contactAskedAt).getTime();
    if (elapsed > 60 * 60 * 1000) { // שעה
      await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
      pending = null;
    }
  }

  // ══════════════════════════════════════════
  // עיבוד שלבי קביעת פגישה
  // ══════════════════════════════════════════
  if (pending && (inText || sharedPhone)) {

    // ── שלב: אישור/ביטול פגישה (כאשר המוזמן הוא משתמש מערכת) ──
    if (pending.step === 'confirm_appointment') {
      const txtNorm = inText.trim();

      if (/^אשר$/.test(txtNorm)) {
        await clearPending(userDocName);
        const ownerDisplayName = pending.ownerName || 'העסק';
        const dateStr          = formatDateHebrew(pending.date);
        const timeStr          = pending.time ? ` בשעה ${pending.time}` : '';
        const cleanApptTitle   = `פגישה עם ${ownerDisplayName}`;

        // שמור פגישה ביומן הלקוח (Firestore)
        await saveAppointment(cleanApptTitle, pending.date, pending.time || '', ownerDisplayName, chatId, null, userDocId);

        // הוסף ליומן גוגל של הלקוח אם מחובר
        if (senderCalId) {
          try { await createCalendarEvent(cleanApptTitle, pending.date, pending.time || null, ownerDisplayName, senderCalId, ''); } catch(e) {}
        }

        // הודע ללקוח
        await sendWhatsAppReply(chatId,
          `✅ *אישרת את הפגישה!*\n📅 ${dateStr}${timeStr}\n\nהפגישה נוספה ליומן שלך 📆`
        );

        // הודע לבעל העסק
        if (pending.ownerChatId) {
          const clientOwnName = pending.clientName || clientName || '';
          await sendWhatsAppReply(pending.ownerChatId,
            `✅ *${clientOwnName}* אישר/ה את הפגישה!\n📅 ${dateStr}${timeStr}`
          );
        }
        return res.status(200).send('ok');
      }

      if (/^בטל$/.test(txtNorm)) {
        await clearPending(userDocName);
        const ownerDisplayName = pending.ownerName || 'העסק';
        const dateStr          = formatDateHebrew(pending.date);
        const timeStr          = pending.time ? ` בשעה ${pending.time}` : '';
        const clientOwnName    = pending.clientName || clientName || '';

        // מחק פגישה מ-Firestore ומגוגל קלנדר של הבעלים
        if (pending.ownerDocName) {
          const ownerUserId   = pending.ownerDocName.split('/').pop();
          const googleEventId = await cancelAppointmentInFirestore(ownerUserId, pending.date, clientOwnName);
          if (googleEventId) {
            await deleteCalendarEvent(googleEventId, process.env.GOOGLE_CALENDAR_ID);
          }
        }

        // הודע ללקוח על הביטול
        await sendWhatsAppReply(chatId,
          `❌ ביטלת את הפגישה.\n📅 ${dateStr}${timeStr}\n\nניתן לפנות ל${ownerDisplayName} לקביעה מחדש.`
        );

        // הודע לבעל העסק על הביטול
        if (pending.ownerChatId) {
          await sendWhatsAppReply(pending.ownerChatId,
            `❌ *${clientOwnName}* ביטל/ה את הפגישה.\n📅 ${dateStr}${timeStr}\n🗑️ הפגישה נמחקה מהיומן.`
          );
        }
        return res.status(200).send('ok');
      }

      // לא אשר ולא בטל — שלח תזכורת
      const dateStr = formatDateHebrew(pending.date);
      const timeStr = pending.time ? ` בשעה ${pending.time}` : '';
      await sendWhatsAppReply(chatId,
        `📅 *${pending.ownerName || 'העסק'}* הזמין/ה אותך לפגישה\n🗓 ${dateStr}${timeStr}\n\n✅ לאישור שלח: *אשר*\n❌ לביטול שלח: *בטל*`
      );
      return res.status(200).send('ok');
    }

    // ── שלב: תאריך ──
    if (pending.step === 'ask_date') {
      // תאריך ושעה: JS קודם (100% אמין), אחר-כך AI כגיבוי
      const jsDateOnly = extractDateJS(inText);
      const jsTimeOnly = extractTimeJS(inText);
      let parsed;
      if (jsDateOnly) {
        parsed = { date: jsDateOnly, time: jsTimeOnly || null };
      } else {
        parsed = await classifyMessage(inText).catch(()=>null);
        if (parsed && jsTimeOnly) parsed.time = jsTimeOnly; // JS time overrides AI
      }
      if (!parsed?.date) {
        await sendWhatsAppReply(chatId, '⚠️ לא הצלחתי לזהות תאריך.\nנסה שוב, לדוגמה: "7/5" או "יום שישי"');
        return res.status(200).send('ok');
      }
      const upd = { ...pending, date: parsed.date, time: parsed.time || pending.time || '' };

      if (upd.date && upd.time && upd.withName) {
        return tryFinalize(chatId, userDocName, upd, senderCalId, res, userDocId, ownerName);
      }
      if (upd.date && upd.time && !upd.withName) {
        const clients = await getClients(userDocId);
        const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
        await setPending(userDocName, { ...upd, step:'ask_with_whom' });
        await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(upd.date)} בשעה ${upd.time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
        return res.status(200).send('ok');
      }
      await setPending(userDocName, { ...upd, step:'ask_time' });
      await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(upd.date)} ✓\n\nבאיזו שעה? (לדוגמה: 14:00)`);
      return res.status(200).send('ok');
    }

    // ── שלב: שעה ──
    if (pending.step === 'ask_time') {
      const timeMatch = inText.match(/(\d{1,2})[:\.](\d{2})|^(\d{1,2})$/);
      if (!timeMatch) {
        await sendWhatsAppReply(chatId, '⚠️ לא זיהיתי שעה. נסה שוב, לדוגמה: "14:00" או "9"');
        return res.status(200).send('ok');
      }
      const raw = timeMatch[0].replace('.', ':');
      const parts = raw.includes(':') ? raw.split(':') : [raw, '00'];
      const time  = `${parts[0].padStart(2,'0')}:${(parts[1]||'00').padStart(2,'0')}`;
      const upd = { ...pending, time };

      if (upd.withName) {
        return tryFinalize(chatId, userDocName, upd, senderCalId, res, userDocId, ownerName);
      }
      const clients = await getClients(userDocId);
      const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
      await setPending(userDocName, { ...upd, step:'ask_with_whom' });
      await sendWhatsAppReply(chatId, `🕐 שעה ${time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
      return res.status(200).send('ok');
    }

    // ── שלב: עם מי (חיפוש בלקוחות) ──
    if (pending.step === 'ask_with_whom') {
      const clients = await getClients(userDocId);

      // שלב 1: חלץ שם אדם מהטקסט (לא להעתיק מילה במילה)
      const personName = await extractPersonName(inText);
      if (!personName) {
        const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
        await sendWhatsAppReply(chatId,
          `לא הבנתי שם לקוח.\nשלח שם של אדם (לדוגמה: "דינה" או "יוסי כהן")${list?'\n\nלקוחות קיימים:\n'+list:''}`
        );
        return res.status(200).send('ok');
      }

      // שלב 2: חפש את השם שחולץ ברשימת הלקוחות
      const matched = matchClient(clients, personName);

      if (!matched) {
        // לקוח חדש — שאל פרטי קשר
        await setPending(userDocName, { ...pending, step:'ask_contact', withName: personName, withEmail:'', contactAskedAt: new Date().toISOString() });
        await sendWhatsAppReply(chatId,
          `לא מצאתי לקוח בשם "${personName}" במערכת.\nלהוסיף לקוח חדש, שלח:\n📧 כתובת מייל לשליחת זימון\n📱 מספר ווצאפ לשליחת זימון\nאו "ללא זימון"`
        );
        return res.status(200).send('ok');
      }

      // לקוח קיים
      const upd = { ...pending, withName: matched.name, withEmail: matched.email || '' };
      if (matched.email || matched.whatsapp) {
        // יש פרטי קשר שמורים — שלח זימון ישירות ללא שאלה
        if (matched.whatsapp && !matched.email) {
          const phoneClean = matched.whatsapp.replace(/[-\s+]/g, '');
          await sendInviteWithConfirmation(phoneClean, upd.ownerName || ownerName, upd.date, upd.time, chatId, userDocName, matched.name).catch(()=>{});
        }
        await finalizeAppointment(chatId, userDocName, upd, senderCalId, userDocId);
      } else {
        await setPending(userDocName, { ...upd, step:'ask_contact', contactAskedAt: new Date().toISOString() });
        await sendWhatsAppReply(chatId,
          `👤 ${matched.name} ✓\nאין פרטי קשר שמורים.\n\nשלח:\n📧 מייל לזימון\n📱 ווצאפ לזימון\nאו "ללא זימון"`
        );
      }
      return res.status(200).send('ok');
    }

    // ── שלב: פרטי קשר של לקוח (מייל / ווצאפ / ללא) ──
    if (pending.step === 'ask_contact') {
      // אם שותף איש קשר (כרטיס vCard) — השתמש במספר שלו ישירות
      if (sharedPhone && /^\d{9,15}$/.test(sharedPhone)) {
        const sp = sharedPhone.startsWith('972') ? sharedPhone : '972' + sharedPhone.replace(/^0/, '');
        await upsertClient(pending.withName, '', sp, userDocId);
        await sendInviteWithConfirmation(sp, pending.ownerName || ownerName, pending.date, pending.time, chatId, userDocName, pending.withName || '');
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
        return res.status(200).send('ok');
      }
      const txt = inText.trim();

      // ללא זימון
      if (/^ללא(\s+זימון)?$|^לא$/i.test(txt)) {
        await upsertClient(pending.withName, '', '', userDocId);
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
        return res.status(200).send('ok');
      }

      // מייל
      if (txt.includes('@') && txt.includes('.')) {
        const email = txt.toLowerCase();
        await upsertClient(pending.withName, email, '', userDocId);
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail: email }, senderCalId, userDocId);
        return res.status(200).send('ok');
      }

      // ווצאפ / טלפון
      const phoneClean = txt.replace(/[-\s+]/g, '');
      if (/^\d{9,12}$/.test(phoneClean)) {
        await upsertClient(pending.withName, '', phoneClean, userDocId);
        await sendInviteWithConfirmation(phoneClean, pending.ownerName || ownerName, pending.date, pending.time, chatId, userDocName, pending.withName || '');
        await finalizeAppointment(chatId, userDocName, { ...pending, withEmail:'' }, senderCalId, userDocId);
        return res.status(200).send('ok');
      }

      await sendWhatsAppReply(chatId, '⚠️ לא זיהיתי. שלח מייל, מספר ווצאפ, או "ללא זימון"');
      return res.status(200).send('ok');
    }

    // שלב לא מוכר — נקה
    await clearPending(userDocName);
    return res.status(200).send('ok');
  }

  // ══════════════════════════════════════════
  // הודעה חדשה (לא בתהליך פגישה)
  // ══════════════════════════════════════════
  let msgText = '';
  let source  = 'whatsapp-text';

  try {
    if (msgType === 'textMessage') {
      msgText = messageData.textMessageData?.textMessage || '';

    } else if (['audioMessage','voiceMessage','pttMessage'].includes(msgType)) {
      source = 'whatsapp-voice';
      const idMessage = body.idMessage;
      const instance  = process.env.GREENAPI_INSTANCE;
      const token     = process.env.GREENAPI_TOKEN;

      let audioUrl = messageData?.fileMessageData?.downloadUrl
                  || messageData?.pttMessageData?.downloadUrl || null;
      if (!audioUrl) {
        const dlResp = await fetch(
          `https://7107.api.greenapi.com/waInstance${instance}/downloadFile/${token}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ chatId, idMessage }) }
        );
        const dlData = await dlResp.json();
        audioUrl = dlData.downloadUrl;
        if (!audioUrl) throw new Error('downloadFile failed');
      }
      const audioResp   = await fetch(audioUrl);
      if (!audioResp.ok) throw new Error('Audio fetch failed: ' + audioResp.status);
      const audioBuffer = await audioResp.buffer();
      if (!audioBuffer || audioBuffer.length === 0) throw new Error('Empty audio buffer');

      const form = new FormData();
      form.append('file', audioBuffer, { filename:'voice.ogg', contentType:'audio/ogg' });
      form.append('model', 'whisper-large-v3');
      form.append('prompt', 'שמות ישראלים, עסקים, משימות עבודה, מינוחים פיננסיים, מונחי מס ומקדמות.');
      form.append('language', 'he');

      const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method:'POST',
        headers:{ Authorization:`Bearer ${process.env.GROQ_KEY}`, ...form.getHeaders() },
        body: form
      });
      const whisperData = await whisperResp.json();
      if (whisperData.error) throw new Error('Whisper error: ' + whisperData.error.message);
      msgText = whisperData.text || '';

    } else {
      return res.status(200).send('unsupported');
    }
  } catch(err) {
    console.error('Processing error:', err);
    if (chatId) await sendWhatsAppReply(chatId, '❌ שגיאה בעיבוד ההודעה.');
    return res.status(200).send('error');
  }

  if (!msgText.trim()) return res.status(200).send('empty');

  // ── פקודת דיבאג: "שם" — מה הבוט רואה כשם המשרד ──
  if (/^שם(\s+משרד)?$/.test(msgText.trim())) {
    const dbgOfficeName = (userDoc.fields?.officeName?.stringValue || '').trim();
    const dbgName       = (userDoc.fields?.name?.stringValue       || '').trim();
    const dbgWaName     = (userDoc.fields?.waName?.stringValue     || '').trim();
    const dbgEmail      = (userDoc.fields?.email?.stringValue      || '');
    await sendWhatsAppReply(chatId,
      `🔍 נתוני המשרד בדוק:\n\n` +
      `officeName: "${dbgOfficeName}"\n` +
      `name: "${dbgName}"\n` +
      `waName: "${dbgWaName}"\n` +
      `email: "${dbgEmail}"\n` +
      `ownerName שנקבע: "${ownerName}"\n` +
      `docId: ${userDocId}`
    );
    return res.status(200).send('ok');
  }

  // ── סיווג ──
  let classified = { intent:'task', date:null, time:null, title:msgText };
  try { classified = await classifyMessage(msgText.trim()); }
  catch(err) { console.error('Classification error:', err); }

  const title = classified.title || msgText.trim();

  if (classified.intent === 'invalid') {
    if (chatId) await sendWhatsAppReply(chatId,
      '👋 שלום!\n\nכדי ליצור משימה — שלחו הודעה עם תוכן המשימה.\nכדי לקבוע פגישה — ציינו "פגישה" בהודעה.\n\nניתן גם לשלוח הודעה קולית! 🎤'
    );
    return res.status(200).send('unclear');
  }

  // ── פגישה ──
  if (classified.intent === 'appointment') {
    const apptTitle = title || 'פגישה';

    // נסה לזהות לקוח — רק לקוחות של המשתמש הזה
    const clients = await getClients(userDocId);
    let matchedClient = null;
    let withName = classified.with || '';
    if (withName) {
      matchedClient = matchClient(clients, withName);
      // אם לא נמצא — ודא שזה שם אדם אמיתי ולא מילה אחרת
      if (!matchedClient) {
        const verified = await extractPersonName(withName);
        withName = verified || ''; // אם לא שם — נשכח ונשאל בהמשך
      }
    }

    const hasDate  = !!classified.date;
    const hasTime  = !!classified.time;
    const hasWith  = !!withName;       // שם אדם אמיתי צוין בהודעה
    const hasMatch = !!matchedClient;  // נמצא ברשימת הלקוחות

    const knownWith = hasMatch
      ? { withName: matchedClient.name, withEmail: matchedClient.email || '', withWhatsapp: matchedClient.whatsapp || '' }
      : hasWith
        ? { withName: withName,          withEmail: '', withWhatsapp: '' }
        : { withName: '',                withEmail: '', withWhatsapp: '' };

    // ── הכל ידוע + לקוח נמצא ──
    if (hasDate && hasTime && hasMatch) {
      const upd = { date:classified.date, time:classified.time, title:apptTitle, ...knownWith };
      return tryFinalize(chatId, userDocName, upd, senderCalId, res, userDocId, ownerName);
    }

    // ── תאריך+שעה ידועים, שם צוין אבל לא נמצא ──
    if (hasDate && hasTime && hasWith && !hasMatch) {
      await setPending(userDocName, { step:'ask_contact', date:classified.date, time:classified.time, title:apptTitle, ...knownWith, ownerName, contactAskedAt: new Date().toISOString() });
      await sendWhatsAppReply(chatId,
        `לא מצאתי לקוח בשם "${classified.with}" במערכת.\n\nשלח:\n📧 מייל לזימון\n📱 ווצאפ לזימון\nאו "ללא זימון"`
      );
      return res.status(200).send('ok');
    }

    if (!hasDate) {
      await setPending(userDocName, { step:'ask_date', title:apptTitle, ...knownWith, ownerName });
      await sendWhatsAppReply(chatId, `📅 רוצה לקבוע פגישה!\n\nמתי? (תאריך ושעה)\nלדוגמה: "5/5 בשעה 14:00"`);
      return res.status(200).send('ok');
    }
    if (!hasTime) {
      await setPending(userDocName, { step:'ask_time', date:classified.date, title:apptTitle, ...knownWith, ownerName });
      await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(classified.date)} ✓\n\nבאיזו שעה?`);
      return res.status(200).send('ok');
    }
    if (!hasWith) {
      await setPending(userDocName, { step:'ask_with_whom', date:classified.date, time:classified.time, title:apptTitle, withName:'', withEmail:'', ownerName });
      const list = clients.slice(0,20).map((c,i)=>`${i+1}. ${c.name}`).join('\n');
      await sendWhatsAppReply(chatId, `📅 ${formatDateHebrew(classified.date)} בשעה ${classified.time} ✓\n\nעם מי הפגישה?\n${list||'(שם הלקוח)'}`);
      return res.status(200).send('ok');
    }
  }

  // ── תזכורת — נרשמת ביומן ושולחת התראה בתאריך ──
  if (classified.intent === 'reminder') {
    const remTitle = (classified.title || msgText).trim();
    if (!classified.date) {
      // תזכורת חייבת תאריך — אם אין, ניצור משימה רגילה במקום זה
      // ניפול לטיפול במשימה למטה
    } else {
      try {
        await saveReminder(remTitle, classified.date, classified.time || '', chatId, userDocId);
      } catch(e) { console.error('saveReminder error:', e); }
      if (chatId) {
        const timeStr = classified.time ? ` בשעה ${classified.time}` : '';
        await sendWhatsAppReply(chatId,
          `🔔 תזכורת נרשמה ביומן!\n📅 ${formatDateHebrew(classified.date)}${timeStr}\n📝 ${remTitle}\n\nתקבל/י התראה בטלפון ביום עצמו.`
        );
      }
      return res.status(200).json({ ok:true, type:'reminder', title:remTitle, date:classified.date });
    }
  }

  // ── משימה — זיהוי עובד ושיוך ──
  // מעביר את שדות המשתמש כדי לחפש team בכל מיקום אפשרי
  let teamMembers = [];
  try { teamMembers = await getTeamMembers(userDocId, userDoc.fields); } catch(e) {
    console.error('getTeamMembers failed:', e.message);
  }

  // עדיפות 1: Groq זיהה שם עובד בסיווג → התאמה גמישה
  // עדיפות 2: חיפוש regex בטקסט המלא
  // אם לא מצוין שם עובד בהודעה — המשימה תיווצר כללית (לא משויכת אוטומטית גם אם יש רק עובד אחד בצוות)
  const aiAssignee  = classified.assignee || null;
  const workerMatch = (aiAssignee ? findWorkerByName(aiAssignee, teamMembers) : null)
                   || findWorkerMatch(msgText, teamMembers);

  console.log(`👥 assignee from AI: "${aiAssignee}" | matched: ${workerMatch?.name || 'none'}`);

  // תמיד שומרים את הטקסט המקורי המלא — רק מסירים שם עובד מההתחלה
  const cleanTitle = workerMatch
    ? cleanTitleFromWorker(msgText.trim(), workerMatch.name)
    : msgText.trim();

  // שם המשוב: עובד אם נמצא בצוות, אחרת המעביד עצמו ("כללי")
  const assigneeName  = workerMatch ? workerMatch.name  : clientName;
  const assigneeEmail = workerMatch ? workerMatch.email : clientEmail;

  const { ok: firestoreOk, docId: taskDocId } = await saveTask(
    cleanTitle, clientName, source, userDocId,
    assigneeName, assigneeEmail
  );

  // sharedTask + התרעה — רק כשמשובצת לעובד (לא לכללי)
  if (firestoreOk && workerMatch && taskDocId) {
    await createSharedTask(taskDocId, cleanTitle, workerMatch.name, workerMatch.email, clientEmail, clientName, source);
    await notifyWorkerOfTask(workerMatch, cleanTitle, clientName);
  }

  if (chatId) {
    const assignMsg = workerMatch
      ? `\n👤 שובצה ל: *${workerMatch.name}*`
      : `\n👤 שובצה כללי (${clientName})`;
    await sendWhatsAppReply(chatId, firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!${assignMsg}\n📝 ${cleanTitle}`
      : '⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה.');
  }
  return res.status(200).json({ ok:true, type:'task', task:cleanTitle });
};
