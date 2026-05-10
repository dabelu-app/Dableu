const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

// ── Green API — שליחת הודעת WhatsApp ──
async function sendWhatsApp(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  if (!instance || !token) throw new Error('GREENAPI credentials missing');
  const r = await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    }
  );
  if (!r.ok) throw new Error(`Green API error: ${r.status}`);
  return r.json();
}

// ── נרמול מספר טלפון לפורמט 972XXXXXXXXX ──
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/[^\d]/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { employeeName, employeeEmail, employeePhone, officeName, inviterName, tempCode } = req.body || {};

  if (!employeeEmail || !employeeName) {
    return res.status(200).json({ ok: false, error: 'Missing fields' });
  }

  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(employeeEmail)) {
    return res.status(400).json({ ok: false, error: `כתובת המייל "${employeeEmail}" אינה תקינה` });
  }

  const loginUrl = tempCode
    ? `https://dabelu.web.app/tax_manager_app.html?firstLogin=1&email=${encodeURIComponent(employeeEmail)}&code=${tempCode}`
    : `https://dabelu.web.app/tax_manager_app.html`;

  // הזמנה ראשונית — תמיד נשלחת גם במייל וגם בוואטסאפ (אם יש טלפון).
  // העדפת הערוץ של העובד (notify) משפיעה רק על תזכורות עתידיות, לא על ההזמנה הראשונית.
  const wantEmail = true;
  const wantWA    = !!employeePhone;

  let emailSent = false;
  let waSent    = false;
  let emailError = null;
  let waError    = null;

  // ── שליחת מייל ──
  if (wantEmail) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.zoho.com', port: 587, secure: false,
        auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
      });

      await transporter.sendMail({
        from: '"Dabelu מערכת משימות" <tasks@dabelu.pro>',
        to: employeeEmail,
        subject: `ברוך הבא ל${officeName || 'המשרד'} – הצטרפות למערכת ניהול המשימות`,
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e0e0e0;border-radius:14px;overflow:hidden">
            <div style="background:#f0eeff;padding:24px 32px;text-align:center;border-bottom:1px solid #ddd6fe">
              <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:90px;max-width:280px;display:block;margin:0 auto">
            </div>
            <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:28px 28px;text-align:center">
              <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">ברוכים הבאים למשרד! 🎉</h1>
              <p style="color:#bfdbfe;margin:8px 0 0;font-size:13px">${officeName || 'המשרד'} מצרפת אותך למערכת ניהול המשימות</p>
            </div>
            <div style="padding:32px 28px;background:#fff">
              <p style="font-size:15px;color:#1a1a2e;margin:0 0 16px">שלום ${employeeName} 👋</p>
              <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px">
                ${inviterName ? inviterName : 'המנהל/ת'} הצטרף/ה אותך למערכת <strong>Dabelu</strong> – מערכת ניהול המשימות של ${officeName || 'המשרד'}.
                <br/>המערכת מאפשרת לך לצפות במשימות שהוקצו לך, לעדכן סטטוס, ולתקשר עם הצוות בצורה נוחה.
              </p>
              <div style="background:#f8fafc;border-radius:10px;padding:18px 20px;margin-bottom:24px;border-right:4px solid #2563eb">
                <div style="font-size:12px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">שלבים להתחלה</div>
                <div style="font-size:13px;color:#1a1a2e;line-height:2">
                  1️⃣ &nbsp;לחצי על כפתור הכניסה למטה<br/>
                  2️⃣ &nbsp;צרי סיסמה אישית חדשה 🔒<br/>
                  3️⃣ &nbsp;התחילי לעבוד! 🚀
                </div>
              </div>
              <div style="text-align:center;margin-bottom:24px">
                <a href="${loginUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;box-shadow:0 4px 12px rgba(37,99,235,0.3)">
                  כניסה ראשונה למערכת ←
                </a>
              </div>
              <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">
                שאלות? פנה/י ל${inviterName || 'המנהל/ת'} או ענה/י למייל זה
              </p>
            </div>
            <div style="background:#f5f5f5;padding:14px;text-align:center;color:#999;font-size:11px">
              Dabelu · tasks@dabelu.pro · <a href="https://dabelu.web.app" style="color:#999">dabelu.web.app</a>
            </div>
          </div>
        `
      });
      emailSent = true;
    } catch (err) {
      console.error('Invite email error:', err);
      emailError = err.message;
    }
  }

  // ── שליחת WhatsApp ──
  if (wantWA) {
    const normalized = normalizePhone(employeePhone);
    if (normalized) {
      try {
        const waMsg =
`*ברוך/ה הבא/ה ל${officeName || 'המשרד'}!* 🎉

${inviterName || 'המנהל/ת'} הצטרפ/ה אותך למערכת *Dabelu* — ניהול משימות, פגישות ולקוחות.

🔗 *כניסה ראשונה למערכת:*
${loginUrl}

בלחיצה על הקישור — תוגדר סיסמה אישית והמערכת מוכנה לשימוש.

שאלות? פנ/י ל${inviterName || 'המנהל/ת'}.`;

        await sendWhatsApp(normalized + '@c.us', waMsg);
        waSent = true;
      } catch (err) {
        console.error('Invite WhatsApp error:', err);
        waError = err.message;
      }
    } else {
      waError = 'phone normalization failed';
    }
  }

  return res.status(200).json({
    ok: emailSent || waSent,
    emailSent, waSent,
    emailError, waError,
    skippedWA: !employeePhone
  });
};
