const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { name, email, password, siteUrl } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#1e40af;padding:24px;text-align:center">
        <img src="https://dabelu.web.app/logo.png" alt="Dabelu" style="height:54px;max-width:180px;display:block;margin:0 auto">
      </div>
      <div style="padding:28px">
        <h1 style="color:#1e40af;text-align:center;font-size:22px;margin:0 0 18px">ברוכים הבאים ל-Dabelu! 🎉</h1>
        <p style="font-size:16px">שלום <strong>${name}</strong>,</p>
        <p>נוצר לך חשבון במערכת ניהול המשימות של Dabelu.</p>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;margin:20px 0;border-right:4px solid #2563eb">
          <p style="margin:4px 0"><strong>📧 מייל:</strong> ${email}</p>
          <p style="margin:4px 0"><strong>🔑 סיסמה:</strong> ${password}</p>
          <p style="margin:4px 0"><strong>🌐 קישור:</strong> <a href="${siteUrl}" style="color:#2563eb">${siteUrl}</a></p>
        </div>
      </div>
      <div style="background:#f1f5f9;padding:14px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0">
        Dabelu · <a href="https://dabelu.web.app" style="color:#94a3b8">dabelu.web.app</a>
      </div>
    </div>`;

  try {
    await transporter.sendMail({
      from: '"Dabelu" <tasks@dabelu.pro>',
      to: email,
      subject: `ברוכים הבאים ל-Dabelu, ${name}! 🎉`,
      html
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
