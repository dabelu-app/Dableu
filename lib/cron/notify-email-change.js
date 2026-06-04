const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT = 'dabelu';

// שולח הודעה על שינוי כתובת מייל: אישור למייל החדש + התראת אבטחה לישן.
// נקרא דרך api/cron?type=notify-email-change&newEmail=...&oldEmail=...&name=...
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const b = req.body || {};
  const newEmail = (q.newEmail || b.newEmail || '').toString().trim().toLowerCase();
  const oldEmail = (q.oldEmail || b.oldEmail || '').toString().trim().toLowerCase();
  const name     = (q.name     || b.name     || '').toString().trim();
  if (!newEmail) return res.status(400).json({ ok: false, error: 'missing newEmail' });

  // אבטחה: שולחים רק אם המייל החדש אכן רשום למשתמש קיים (מונע ספאם)
  try {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: newEmail } } },
          limit: 1
        }})
      }
    );
    const data = await r.json();
    const exists = Array.isArray(data) && data.length > 0 && data[0].document;
    if (!exists) return res.status(404).json({ ok: false, error: 'newEmail not registered' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'lookup failed: ' + e.message });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  const shell = (title, bodyHtml) => `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe">
        <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:80px;max-width:260px;display:block;margin:0 auto">
      </div>
      <div style="padding:28px;font-size:15px;color:#1e293b;line-height:1.7">
        <h1 style="color:#4c3fcc;text-align:center;font-size:21px;margin:0 0 18px">${title}</h1>
        ${bodyHtml}
      </div>
      <div style="background:#f1f5f9;padding:14px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0">
        Dabelu · <a href="https://dabelu.web.app" style="color:#94a3b8">dabelu.web.app</a>
      </div>
    </div>`;

  const hello = name ? `שלום ${name},` : 'שלום,';
  const results = {};

  // 1) אישור למייל החדש
  try {
    await transporter.sendMail({
      from: '"Dabelu" <tasks@dabelu.pro>',
      to: newEmail,
      subject: 'כתובת המייל שלך עודכנה ב-Dabelu ✅',
      html: shell('כתובת המייל עודכנה ✅',
        `<p>${hello}</p>
         <p>כתובת המייל הזו (<strong>${newEmail}</strong>) מקושרת כעת לחשבון שלך ב-Dabelu.</p>
         <p>מעכשיו תוכל/י להתחבר עם הכתובת הזו. 💜</p>`)
    });
    results.newSent = true;
  } catch (e) { results.newError = e.message; }

  // 2) התראת אבטחה למייל הישן (אם קיים ושונה)
  if (oldEmail && oldEmail !== newEmail) {
    try {
      await transporter.sendMail({
        from: '"Dabelu" <tasks@dabelu.pro>',
        to: oldEmail,
        subject: 'כתובת המייל בחשבון Dabelu שונתה',
        html: shell('שינוי כתובת מייל בחשבון',
          `<p>${hello}</p>
           <p>כתובת המייל בחשבון Dabelu שלך שונתה אל <strong>${newEmail}</strong>.</p>
           <p style="background:#fef2f2;border-right:4px solid #dc2626;padding:12px 14px;border-radius:8px;color:#991b1b">
             אם <strong>לא</strong> ביצעת את השינוי הזה — פנה/י אלינו מיד כדי לאבטח את החשבון.
           </p>`)
      });
      results.oldSent = true;
    } catch (e) { results.oldError = e.message; }
  }

  return res.status(200).json({ ok: true, ...results });
};
