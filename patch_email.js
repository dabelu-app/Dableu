const fs = require('fs');

// ── Update invite.js – קישור התחברות ראשונית עם קוד ב-URL ──
const invitePath = 'C:/Users/user1/dabelu/api/invite.js';
let invite = fs.readFileSync(invitePath, 'utf8');

const oldBlock = `            ${tempCode ? \`
            <div style="background:#eff6ff;border:2px solid #2563eb;border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
              <div style="font-size:12px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🔑 קוד כניסה זמני</div>
              <div style="font-size:32px;font-weight:900;color:#1a1a2e;letter-spacing:6px;font-family:monospace">\${tempCode}</div>
              <div style="font-size:11px;color:#64748b;margin-top:8px">השתמשי בקוד זה בכניסה הראשונה שלך למערכת</div>
            </div>
            \` : ''}

            <div style="background:#f8fafc;border-radius:10px;padding:18px 20px;margin-bottom:24px;border-right:4px solid #2563eb">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">שלבים להתחלה</div>
              <div style="font-size:13px;color:#1a1a2e;line-height:2">
                1️⃣ &nbsp;לחצי על הכפתור למטה<br/>
                2️⃣ &nbsp;הזיני את האימייל שלך<br/>
                3️⃣ &nbsp;הזיני את הקוד הזמני שקיבלת<br/>
                4️⃣ &nbsp;צרי סיסמה אישית חדשה 🔒<br/>
                5️⃣ &nbsp;התחילי לעבוד! 🚀
              </div>
            </div>
            <div style="text-align:center;margin-bottom:24px">
              <a href="https://dabelu.web.app/tax_manager_app.html" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(37,99,235,0.3)">
                כניסה למערכת ←
              </a>
            </div>`;

// Replace the entire email HTML section  
const newEmailSection = `
      const loginUrl = \`https://dabelu.web.app/tax_manager_app.html?firstLogin=1&email=\${encodeURIComponent(employeeEmail)}&code=\${tempCode || ''}\`;

      const stepsHtml = tempCode ? \`
            <div style="background:#f8fafc;border-radius:10px;padding:18px 20px;margin-bottom:24px;border-right:4px solid #2563eb">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">שלבים להתחלה</div>
              <div style="font-size:13px;color:#1a1a2e;line-height:2">
                1️⃣ &nbsp;לחצי על כפתור הכניסה למטה<br/>
                2️⃣ &nbsp;צרי סיסמה אישית חדשה 🔒<br/>
                3️⃣ &nbsp;התחילי לעבוד! 🚀
              </div>
            </div>
      \` : \`
            <div style="background:#f8fafc;border-radius:10px;padding:18px 20px;margin-bottom:24px;border-right:4px solid #2563eb">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">שלבים להתחלה</div>
              <div style="font-size:13px;color:#1a1a2e;line-height:2">
                1️⃣ &nbsp;לחצי על הכפתור למטה<br/>
                2️⃣ &nbsp;הירשמי עם כתובת המייל הזו<br/>
                3️⃣ &nbsp;צרי סיסמה אישית<br/>
                4️⃣ &nbsp;התחילי לעבוד! 🚀
              </div>
            </div>
      \`;`;

// Write a completely new invite.js
const newInviteContent = `const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { employeeName, employeeEmail, officeName, inviterName, tempCode } = req.body || {};

  if (!employeeEmail || !employeeName) {
    return res.status(200).json({ ok: false, error: 'Missing fields' });
  }

  // קישור התחברות ראשונית עם קוד ב-URL
  const loginUrl = tempCode
    ? \`https://dabelu.web.app/tax_manager_app.html?firstLogin=1&email=\${encodeURIComponent(employeeEmail)}&code=\${tempCode}\`
    : \`https://dabelu.web.app/tax_manager_app.html\`;

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 587, secure: false,
      auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
    });

    await transporter.sendMail({
      from: '"Dabelu מערכת משימות" <tasks@dabelu.pro>',
      to: employeeEmail,
      subject: \`ברוך הבא ל\${officeName || 'המשרד'} – הצטרפות למערכת ניהול המשימות\`,
      html: \`
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e0e0e0;border-radius:14px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a1a2e 0%,#2563eb 100%);padding:32px 28px;text-align:center">
            <div style="font-size:38px;margin-bottom:10px">🎉</div>
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">ברוכה הבאה למשרד!</h1>
            <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px">\${officeName || 'המשרד'} מצרפת אותך למערכת ניהול המשימות</p>
          </div>
          <div style="padding:32px 28px;background:#fff">
            <p style="font-size:15px;color:#1a1a2e;margin:0 0 16px">שלום \${employeeName} 👋</p>
            <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px">
              \${inviterName ? inviterName : 'המנהל/ת'} הצטרף/ה אותך למערכת <strong>Dabelu</strong> – מערכת ניהול המשימות של \${officeName || 'המשרד'}.
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
              <a href="\${loginUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;box-shadow:0 4px 12px rgba(37,99,235,0.3)">
                כניסה ראשונה למערכת ←
              </a>
            </div>

            <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">
              שאלות? פנה/י ל\${inviterName || 'המנהל/ת'} או ענה/י למייל זה
            </p>
          </div>
          <div style="background:#f5f5f5;padding:14px;text-align:center;color:#999;font-size:11px">
            Dabelu · tasks@dabelu.pro · <a href="https://dabelu.web.app" style="color:#999">dabelu.web.app</a>
          </div>
        </div>
      \`
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Invite email error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
`;

fs.writeFileSync(invitePath, newInviteContent, 'utf8');
console.log('invite.js updated with login URL');
