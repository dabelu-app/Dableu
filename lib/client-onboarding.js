// טופס פרטי לקוח (public/onboarding.html) — צד שרת.
//
// למה זה כאן ולא בדפדפן: הטופס ממולא ע"י לקוח המשרד, שאינו משתמש רשום
// במערכת. אם הדפדפן שלו היה כותב ישירות ל-Firestore, היינו נאלצים
// להשאיר את המאגר פתוח לכתיבה לכל העולם. במקום זה הטופס פונה לכאן,
// הטוקן מאומת בשרת, והכתיבה נעשית עם חשבון שירות — כך שהמאגר
// יכול להיות סגור לחלוטין.
//
// נקרא דרך api/send-onboarding.js?action=check|submit
// (לא קובץ api נפרד — Vercel Hobby מוגבל ל-12 serverless functions.)

const nodemailer = require('nodemailer');
const { fsFetch } = require('./firestore');

const MAX_PHOTO_BYTES = 1_200_000;   // ~1.2MB — מעל זה Firestore דוחה את המסמך

// ── המרה לפורמט השדות של Firestore REST ──
function toValue(v) {
  if (v === null || v === undefined)  return { nullValue: null };
  if (typeof v === 'boolean')         return { booleanValue: v };
  if (typeof v === 'number')          return Number.isInteger(v)
                                        ? { integerValue: String(v) }
                                        : { doubleValue: v };
  if (typeof v === 'string')          return { stringValue: v };
  if (Array.isArray(v))               return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object')          return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(obj) {
  const f = {};
  for (const k of Object.keys(obj)) f[k] = toValue(obj[k]);
  return f;
}

// ── שליפת מסמך לקוח + אימות הטוקן ──
// מחזיר { ok:false } בכל מקרה של כישלון, בלי לחשוף למה — כדי לא לאפשר
// למתשאל להבחין בין "לקוח לא קיים" ל"טוקן שגוי".
async function loadAndVerify(clientId, token) {
  if (!clientId || !token) return { ok: false };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clientId)) return { ok: false };

  const r = await fsFetch(`/clients/${encodeURIComponent(clientId)}`);
  if (!r.ok) return { ok: false };
  const doc = await r.json();
  const f = doc.fields || {};

  const stored = f.onboardingToken?.stringValue || '';
  if (!stored || stored !== token)            return { ok: false };
  if (f.profileCompletedAt?.stringValue)      return { ok: false };   // כבר מולא

  return {
    ok: true,
    name:   f.name?.stringValue   || '',
    userId: f.userId?.stringValue || ''
  };
}

// ── פרטי המשרד עבור הודעת היידוע והמייל ──
async function loadOffice(userId) {
  const fallback = { name: 'המשרד', email: '', phone: '' };
  if (!userId) return fallback;
  try {
    const r = await fsFetch(`/users/${encodeURIComponent(userId)}`);
    if (!r.ok) return fallback;
    const f = (await r.json()).fields || {};
    return {
      name:  f.officeName?.stringValue || f.name?.stringValue || 'המשרד',
      email: f.email?.stringValue || '',
      phone: f.phone?.stringValue || f.chatId?.stringValue || ''
    };
  } catch { return fallback; }
}

// ── דוח המייל למשרד ──
function reportHtml(clientName, office, p, consentAt) {
  const yn = v => v ? '<b style="color:#16a34a">כן</b>' : '<span style="color:#9ca3af">לא</span>';
  const row = (k, v) => `<tr>
    <td style="padding:7px 10px;border-bottom:1px solid #eee;color:#6b7280;font-size:13px;white-space:nowrap">${k}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:14px;font-weight:600">${v}</td></tr>`;
  const head = t => `<tr><td colspan="2" style="padding:14px 10px 5px;font-size:12px;font-weight:800;color:#6B5AFF">${t}</td></tr>`;

  let rows = head('פרטים אישיים')
    + row('שם מלא', p.fullName || '—')
    + row('תעודת זהות', p.idNumber || '—')
    + row('טלפון', p.phone || '—')
    + row('אימייל', p.email || '—')
    + row('מצב משפחתי', p.maritalStatus || '—');

  if (p.spouse) rows += head('בן/בת זוג')
    + row('שם מלא', p.spouse.fullName || '—')
    + row('תעודת זהות', p.spouse.idNumber || '—')
    + (p.spouse.phone ? row('טלפון', p.spouse.phone) : '')
    + row('שכיר/ה', yn(p.spouse.isEmployee))
    + row('עצמאי/ת', yn(p.spouse.isSelfEmployed));

  rows += head('ילדים') + row('יש ילדים', yn(p.hasChildren));
  (p.children || []).forEach((c, i) => { rows += row(`ילד/ה ${i + 1}`, `${c.name} · ${c.birthYear}`); });

  rows += head('תעסוקה')
    + row('שכיר/ה', yn(p.isEmployee))
    + row('עצמאי/ת', yn(p.isSelfEmployed));

  rows += head('חברות') + row('חברות בבעלות', yn(p.hasCompanies));
  (p.companies || []).forEach((c, i) => { rows += row(`חברה ${i + 1}`, `${c.name} · ח.פ ${c.companyId}`); });

  rows += head('נכסים והשקעות')
    + row('הכנסות שכר דירה', yn(p.hasRentalIncome))
    + (p.hasRentalIncome ? row('מספר דירות', p.rentalCount) : '')
    + row('מטבעות וירטואליים', yn(p.hasCrypto))
    + row('בנקים בחו״ל', yn(p.hasForeignBank))
    + row('השקעות בחו״ל', yn(p.hasForeignInvestments));

  const when = consentAt ? new Date(consentAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '';
  rows += head('הסכמות')
    + row('הסכמה לאיסוף מידע', `<b style="color:#16a34a">✓ אושרה</b>${when ? ' · ' + when : ''}`)
    + row('צילום ת.ז.', '<b style="color:#16a34a">✓ צורף</b> (בכרטיס הלקוח במערכת)');

  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:640px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#6B5AFF,#8b7cff);padding:22px 26px">
      <h1 style="color:#fff;font-size:19px;margin:0">📋 טופס פרטים חדש התקבל</h1>
      <p style="color:#fff;opacity:.9;font-size:14px;margin:6px 0 0">${clientName || p.fullName}</p>
    </div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <div style="background:#f8fafc;padding:14px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e5e7eb">
      הפרטים נשמרו בכרטיס הלקוח ב-Dabelu · <a href="https://dabelu.web.app" style="color:#94a3b8">dabelu.web.app</a>
    </div>
  </div>`;
}

async function emailReport(office, clientName, profile, consentAt) {
  if (!office.email || !process.env.ZOHO_PASS) return false;
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 587, secure: false,
    auth: { user: 'tasks@dabelu.pro', pass: process.env.ZOHO_PASS }
  });
  await transporter.sendMail({
    from: '"Dabelu" <tasks@dabelu.pro>',
    to: office.email,
    subject: `📋 טופס פרטים חדש — ${clientName || profile.fullName}`,
    html: reportHtml(clientName, office, profile, consentAt)
  });
  return true;
}

// ══════════════════════════════════════
//  handlers
// ══════════════════════════════════════

// GET ?action=check&c=<clientId>&t=<token>
// מחזיר רק את שם הלקוח ופרטי המשרד — לא את שאר נתוני הלקוח.
async function check(req, res) {
  const q = req.query || {};
  const v = await loadAndVerify((q.c || '').trim(), (q.t || '').trim());
  if (!v.ok) return res.status(403).json({ ok: false });
  const office = await loadOffice(v.userId);
  return res.status(200).json({ ok: true, name: v.name, office });
}

// POST ?action=submit  body: { c, t, profile, idPhoto, consentAt }
async function submit(req, res) {
  const b = req.body || {};
  const clientId = (b.c || '').trim();
  const token    = (b.t || '').trim();
  const profile  = b.profile;
  const idPhoto  = b.idPhoto || '';

  if (!profile || typeof profile !== 'object')
    return res.status(400).json({ ok: false, error: 'missing profile' });
  if (!b.consent)
    return res.status(400).json({ ok: false, error: 'consent required' });
  if (idPhoto && (typeof idPhoto !== 'string' || !idPhoto.startsWith('data:image/')))
    return res.status(400).json({ ok: false, error: 'bad photo' });
  if (idPhoto.length > MAX_PHOTO_BYTES)
    return res.status(413).json({ ok: false, error: 'photo too large' });

  const v = await loadAndVerify(clientId, token);
  if (!v.ok) return res.status(403).json({ ok: false });

  const office = await loadOffice(v.userId);
  const now = new Date().toISOString();
  const cid = encodeURIComponent(clientId);

  // צילום ת.ז. במסמך נפרד — לא מנפח את מסמך הלקוח
  let photoSaved = false;
  if (idPhoto) {
    const body = JSON.stringify({ fields: toFields({ type: 'idCard', dataUrl: idPhoto, uploadedAt: now }) });
    let r = await fsFetch(`/clients/${cid}/documents?documentId=idCard`, { method: 'POST', body });
    if (!r.ok && r.status === 409) {
      r = await fsFetch(`/clients/${cid}/documents/idCard`, { method: 'PATCH', body });
    }
    photoSaved = r.ok;
    if (!photoSaved) {
      // אסור לבלוע: בלי זה הלקוח מקבל "נשלח בהצלחה" בזמן שהצילום אבד
      const detail = await r.text().catch(() => '');
      console.error('onboarding: ID photo NOT saved:', r.status, detail.slice(0, 300));
      return res.status(500).json({
        ok: false,
        error: 'photo save failed',
        hint: r.status === 403
          ? 'Firestore rules deny writes to clients/{id}/documents, and the service account has no Firestore access.'
          : undefined
      });
    }
  }

  // הפרופיל + תיעוד ההסכמה. שריפת הטוקן באותה קריאה — כך שהקישור
  // חד-פעמי גם אם מישהו ינסה לשלוח שוב.
  // פרטי הקשר שהלקוח מילא מתעדכנים גם על הכרטיס עצמו, כדי שהמשרד
  // יראה אותם ברשימה ובשליחות בלי לפתוח את הפרופיל.
  const payload = {
    profile,
    profileCompletedAt: now,
    privacyConsent: { given: true, at: now, version: '2026-07', noticeBy: office.name },
    onboardingToken: null
  };
  if (profile.email) payload.email = profile.email;
  if (profile.phone) payload.phone = profile.phone;

  const mask = Object.keys(payload).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const upd = await fsFetch(`/clients/${cid}?${mask}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFields(payload) })
  });
  if (!upd.ok) {
    const detail = await upd.text().catch(() => '');
    console.error('onboarding save failed:', upd.status, detail.slice(0, 300));
    return res.status(500).json({ ok: false, error: 'save failed' });
  }

  let emailed = false;
  try { emailed = await emailReport(office, v.name, profile, now); }
  catch (e) { console.warn('onboarding report email failed:', e.message); }

  return res.status(200).json({ ok: true, emailed });
}

module.exports = { check, submit, toFields, toValue };
