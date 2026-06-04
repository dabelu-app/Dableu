// api/cron.js — מנתב יחיד עבור כל ה-cron jobs.
// מקבל ?type=overdue|appointment|trial|task-due ומנתב להנדלר המתאים.
// נוצר כדי לחסוך בקבצי serverless functions (מגבלת Vercel Hobby = 12).

const handlers = {
  'overdue':         require('../lib/cron/check-overdue'),
  'appointment':     require('../lib/cron/appointment-reminder'),
  'trial':           require('../lib/cron/trial-expiry-reminder'),
  'task-due':        require('../lib/cron/task-due-reminder'),
  'reminder-hourly': require('../lib/cron/reminder-hourly'),
  'reminder-daily':  require('../lib/cron/reminder-daily'),
  'notify-number-change': require('../lib/cron/notify-number-change'),
  'notify-email-change':  require('../lib/cron/notify-email-change'),
};

module.exports = async (req, res) => {
  const type = (req.query && req.query.type) || '';
  const handler = handlers[type];
  if (!handler) {
    return res.status(400).json({
      ok: false,
      error: `unknown cron type: "${type}"`,
      validTypes: Object.keys(handlers)
    });
  }
  try {
    return await handler(req, res);
  } catch (e) {
    console.error(`[cron:${type}]`, e);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
};
