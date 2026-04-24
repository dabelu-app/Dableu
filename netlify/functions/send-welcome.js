const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email, password, siteUrl } = JSON.parse(event.body);

    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 587,
      secure: false,
      auth: {
        user: 'tasks@dabelu.pro',
        pass: process.env.ZOHO_PASS
      }
    });

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Arial',sans-serif;direction:rtl">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#2563eb 100%);padding:40px 32px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">📋</div>
      <div style="color:#ffffff;font-size:26px;font-weight:900;letter-spacing:1px">Dabelu</div>
      <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px">מנהל משימות מס דיגיטלי</div>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px">
      <h2 style="color:#0f172a;font-size:20px;margin:0 0 8px">שלום ${name}! 👋</h2>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 24px">
        ברוכים הבאים לצוות Dabelu! 🎉<br/>
        הצטרפת למערכת ניהול המשימות הדיגיטלית שלנו.
      </p>

      <!-- Credentials Box -->
      <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin-bottom:28px">
        <div style="font-size:13px;font-weight:700;color:#64748b;margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px">פרטי כניסה שלך</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:18px">📧</span>
          <div>
            <div style="font-size:11px;color:#94a3b8">מייל</div>
            <div style="font-size:14px;font-weight:600;color:#0f172a;direction:ltr">${email}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🔑</span>
          <div>
            <div style="font-size:11px;color:#94a3b8">סיסמה</div>
            <div style="font-size:14px;font-weight:600;color:#0f172a;direction:ltr">${password}</div>
          </div>
        </div>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin-bottom:28px">
        <a href="${siteUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:.3px">
          כניסה למערכת ←
        </a>
      </div>

      <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0">
        אם יש שאלות, ניתן לפנות אלינו בכל עת<br/>
        <a href="mailto:tasks@dabelu.pro" style="color:#2563eb">tasks@dabelu.pro</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center">
      <div style="color:#cbd5e1;font-size:11px">© 2025 Dabelu · מנהל משימות מס</div>
    </div>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from: '"Dabelu 📋" <tasks@dabelu.pro>',
      to: email,
      subject: `ברוכים הבאים ל-Dabelu! 🎉 | פרטי כניסה`,
      html
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('send-welcome error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
