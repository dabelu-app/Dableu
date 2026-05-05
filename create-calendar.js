// הרץ פעם אחת: node create-calendar.js
const { google } = require('googleapis');
const fs = require('fs');

async function createDabeluCalendar() {
  const credentials = JSON.parse(fs.readFileSync('C:/Users/user1/Downloads/dabelu-0323aa95003d.json', 'utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // צור יומן חדש בשם "דבליו - פגישות"
  const newCal = await calendar.calendars.insert({
    resource: {
      summary: 'דבליו — פגישות',
      description: 'יומן פגישות מרכזי של מערכת דבליו',
      timeZone: 'Asia/Jerusalem'
    }
  });

  console.log('✅ יומן נוצר!');
  console.log('Calendar ID:', newCal.data.id);
  console.log('\nהוסף ל-Vercel:');
  console.log(`npx vercel env add GOOGLE_CALENDAR_ID production`);
  console.log('Value:', newCal.data.id);
}

createDabeluCalendar().catch(console.error);
