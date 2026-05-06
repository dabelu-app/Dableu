const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { name, phone, email, message } = req.body || {};

  if (!name || !phone) {
    return res.status(200).json({ ok: false, error: 'Missing fields' });
  }
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (email && !emailRegex.test(email)) {
    return res.status(200).json({ ok: false, error: `כתובת המייל "${email}" אינה תקינה` });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
    });

    await transporter.sendMail({
      from: '"Dabelu אתר" <tasks@dabelu.pro>',
      to: 'shanitaxes11@gmail.com',
      subject: `פנייה חדשה מהאתר – ${name}`,
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e0e0e0;border-radius:12px;overflow:hidden">
          <div style="background:#1a1a2e;padding:20px;text-align:center">
            <h2 style="color:#fff;margin:0;font-size:22px">פנייה חדשה מהאתר 📬</h2>
          </div>
          <div style="padding:28px;background:#fff">
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#666;width:90px">שם</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:700;color:#1a1a2e">${name}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#666">טלפון</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:700;color:#1a1a2e">${phone}</td></tr>
              ${email ? `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#666">מייל</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:700;color:#1a1a2e">${email}</td></tr>` : ''}
              ${message ? `<tr><td style="padding:10px 0;color:#666;vertical-align:top">הודעה</td><td style="padding:10px 0;color:#1a1a2e">${message}</td></tr>` : ''}
            </table>
            <a href="https://wa.me/972${phone.replace(/^0/, '').replace(/\D/g, '')}" style="display:inline-block;margin-top:20px;background:#25D366;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">📲 פתח WhatsApp</a>
          </div>
          <div style="background:#f5f5f5;padding:12px;text-align:center;color:#999;font-size:12px">Dabelu · tasks@dabelu.pro</div>
        </div>
      `
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
