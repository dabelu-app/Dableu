const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const clientOnboarding = require('../lib/client-onboarding');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── טופס פרטי לקוח (public/onboarding.html) ──
  // מנותב לכאן ולא לקובץ api נפרד בגלל מגבלת 12 ה-serverless functions
  // של Vercel Hobby. הלוגיקה עצמה ב-lib/client-onboarding.js.
  const action = (req.query && req.query.action) || '';
  if (action === 'check')  return clientOnboarding.check(req, res);
  if (action === 'submit') return clientOnboarding.submit(req, res);

  // ── ברירת מחדל: אונבורדינג של מנוי Dabelu חדש ──
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { name, email, phone, plan } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ ok: false, error: `כתובת המייל "${email}" אינה תקינה` });
  }

  const siteName  = 'Dabelu';
  const siteUrl   = 'https://dabelu.vercel.app';
  const taskEmail = 'tasks@dabelu.pro';

  // ── Get bot WhatsApp number from GreenAPI ──
  let botPhone = '';
  try {
    const instance = process.env.GREENAPI_INSTANCE;
    const token    = process.env.GREENAPI_TOKEN;
    const r = await fetch(
      `https://7107.api.greenapi.com/waInstance${instance}/getSettings/${token}`
    );
    const s = await r.json();
    // wid format: "972XXXXXXXXX@c.us"
    if (s && s.wid) botPhone = s.wid.replace('@c.us', '');
  } catch(e) { console.warn('Could not get bot phone:', e.message); }

  const botPhoneFormatted = botPhone ? `+${botPhone}` : 'בהגדרה';
  const waLink = botPhone ? `https://wa.me/${botPhone}` : '#';
  const planLabel = { free: 'חינמי', active: 'פרימיום', trial: 'ניסיון' }[plan] || 'ניסיון';

  // ══════════════════════════════════════
  //  EMAIL
  // ══════════════════════════════════════
  const emailResult = { ok: false };
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: taskEmail, pass: process.env.ZOHO_PASS }
    });

    const features = [
      ['✅', 'ניהול משימות', 'צרו, עקבו ועדכנו משימות לבד או עם הצוות'],
      ['📅', 'פגישות ויומן', 'קביעת פגישות עם לקוחות ותזכורות אוטומטיות'],
      ['👥', 'ניהול לקוחות', 'כרטיסייה מסודרת לכל לקוח עם היסטוריה מלאה'],
      ['💬', 'בוט ווצאפ', 'שליחת משימות ופגישות ישירות דרך ווצאפ!'],
    ];

    const html = `
<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;background:#f0f4ff;border-radius:16px;overflow:hidden">

  <!-- Header -->
  <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe">
    <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:90px;max-width:280px;display:block;margin:0 auto">
  </div>
  <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:28px 32px;text-align:center">
    <h1 style="color:#fff;font-size:24px;margin:0;font-weight:800">ברוכים הבאים!</h1>
    <p style="color:#bfdbfe;font-size:14px;margin:8px 0 0">מנהל המשימות החכם של המשרד שלכם</p>
  </div>

  <!-- Body -->
  <div style="background:#fff;padding:36px 32px">
    <p style="font-size:18px;color:#1e293b;margin:0 0 6px;font-weight:700">שלום ${name || 'חבר/ה יקר/ה'} 👋</p>
    <p style="font-size:15px;color:#475569;line-height:1.8;margin:0 0 28px">
      שמחים שהצטרפת ל-${siteName}!<br>
      החשבון שלך <strong style="color:#16a34a">מוכן ופעיל</strong> עם תכנית <strong>${planLabel}</strong>.
    </p>

    <!-- Features -->
    <h3 style="color:#1e293b;font-size:15px;margin:0 0 14px;font-weight:700">🚀 מה אפשר לעשות עם Dabelu?</h3>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px">
      ${features.map(([icon,title,desc]) => `
      <div style="display:flex;align-items:center;gap:14px;background:#f8faff;border:1px solid #e0e7ff;border-radius:10px;padding:14px 16px">
        <span style="font-size:24px;flex-shrink:0">${icon}</span>
        <div>
          <div style="font-weight:700;color:#1e293b;font-size:14px">${title}</div>
          <div style="color:#64748b;font-size:13px;margin-top:2px">${desc}</div>
        </div>
      </div>`).join('')}
    </div>

    <!-- Contact Box -->
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:22px;margin-bottom:28px">
      <h3 style="color:#166534;margin:0 0 16px;font-size:15px;font-weight:700">📬 איך לשלוח משימות ופגישות?</h3>

      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
        <span style="font-size:22px;flex-shrink:0">💬</span>
        <div>
          <div style="font-weight:700;color:#15803d;font-size:14px">ווצאפ לבוט:</div>
          <div><a href="${waLink}" style="color:#2563eb;text-decoration:none;font-size:15px;font-weight:700">${botPhoneFormatted}</a></div>
          <div style="color:#4ade80;font-size:12px;margin-top:2px">שלחו "היי" לבוט ועקבו אחרי ההוראות</div>
        </div>
      </div>

      <div style="display:flex;align-items:flex-start;gap:12px">
        <span style="font-size:22px;flex-shrink:0">📧</span>
        <div>
          <div style="font-weight:700;color:#15803d;font-size:14px">מייל לבוט:</div>
          <div><a href="mailto:${taskEmail}" style="color:#2563eb;text-decoration:none;font-size:15px;font-weight:700">${taskEmail}</a></div>
          <div style="color:#4ade80;font-size:12px;margin-top:2px">כותרת המייל = שם המשימה</div>
        </div>
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center">
      <a href="${siteUrl}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:15px 40px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.2px">
        🚀 כניסה למערכת ←
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f1f5f9;padding:18px 24px;text-align:center;border-top:1px solid #e2e8f0">
    <p style="color:#94a3b8;font-size:12px;margin:0">
      Dabelu — מנהל המשימות החכם
      &nbsp;|&nbsp;
      <a href="${siteUrl}" style="color:#2563eb;text-decoration:none">${siteUrl}</a>
    </p>
  </div>
</div>`;

    await transporter.sendMail({
      from: `"${siteName}" <${taskEmail}>`,
      to: email,
      subject: `🎉 ברוכים הבאים ל-${siteName}! החשבון שלך מוכן`,
      html
    });
    emailResult.ok = true;
  } catch(err) {
    emailResult.error = err.message;
    console.error('send-onboarding email error:', err);
  }

  // ══════════════════════════════════════
  //  WHATSAPP
  // ══════════════════════════════════════
  const waResult = { ok: false };
  if (phone) {
    try {
      const instance = process.env.GREENAPI_INSTANCE;
      const token    = process.env.GREENAPI_TOKEN;
      const phoneClean = phone.toString().replace(/[-\s+()]/g, '');
      const normalized = phoneClean.startsWith('972')
        ? phoneClean
        : '972' + phoneClean.replace(/^0/, '');
      const chatId = normalized + '@c.us';

      const message =
`🎉 *ברוכים הבאים ל-Dabelu!*

שלום ${name || ''} 👋
החשבון שלך *מוכן ופעיל* עם תכנית *${planLabel}*!

━━━━━━━━━━━━━━━━━━━
🚀 *מה אפשר לעשות?*
✅ ניהול משימות ולקוחות
📅 קביעת פגישות ויומן
💬 שליחת משימות דרך ווצאפ
━━━━━━━━━━━━━━━━━━━

📬 *איך לשלוח משימה / פגישה?*

💬 ווצאפ לבוט:
${botPhoneFormatted}
_(שלחו "היי" להתחיל)_

📧 מייל לבוט:
${taskEmail}
_(כותרת המייל = שם המשימה)_

━━━━━━━━━━━━━━━━━━━
🔗 *כניסה למערכת:*
${siteUrl}

נשמח לשמוע אם יש שאלות! 💙`;

      await fetch(
        `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, message }) }
      );
      waResult.ok = true;
    } catch(err) {
      waResult.error = err.message;
      console.error('send-onboarding WA error:', err);
    }
  }

  return res.status(200).json({ ok: true, email: emailResult, whatsapp: waResult });
};
