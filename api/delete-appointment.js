// נשאר מחוץ לפריסה (.vercelignore) כדי לא לחצות את מגבלת 12 הפונקציות של Vercel Hobby.
// הלוגיקה נמצאת ב-lib/calendar-api.js ומוגשת דרך api/cron.js?type=calendar (ראו את הכלל ב-vercel.json).
module.exports = require('../lib/calendar-api');
