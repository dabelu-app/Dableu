const { google } = require('googleapis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { googleEventId, calendarId } = req.body || {};

  if (googleEventId && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar']
      });
      const calendar = google.calendar({ version: 'v3', auth });

      // מחק מהיומן הראשי
      const calId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
      await calendar.events.delete({ calendarId: calId, eventId: googleEventId })
        .catch(e => console.warn('Delete from main calendar:', e.message));

    } catch(e) {
      console.error('delete-appointment calendar error:', e);
    }
  }

  return res.status(200).json({ ok: true });
};
