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
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px">
      <h1 style="color:#4CAF50;text-align:center">ברוכים הבאים ל-Dabelu! 🎉</h1>
      <p style="font-size:18px">שלום <strong>${name}</strong>,</p>
      <p>נוצר לך חשבון במערכת ניהול המשימות של Dabelu.</p>
      <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
        <p><strong>📧 מייל:</strong> ${email}</p>
        <p><strong>🔑 סיסמה:</strong> ${password}</p>
        <p><strong>🌐 קישור:</strong> <a href="${siteUrl}">${siteUrl}</a></p>
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
