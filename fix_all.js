const fs = require('fs');
const path = 'C:/Users/user1/dabelu/tax_manager_app.html';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: literal newline inside alert string → use \n
// The broken alert has a real newline between the two lines of text
const brokenAlert = "alert('המייל הזה הוזמן למערכת עם קוד זמני.\nיש להתחבר עם הקוד שנשלח אליך במייל ולא להירשם מחדש.');";
const brokenAlertCRLF = "alert('המייל הזה הוזמן למערכת עם קוד זמני.\r\nיש להתחבר עם הקוד שנשלח אליך במייל ולא להירשם מחדש.');";
const fixedAlert = "alert('המייל הזה הוזמן למערכת עם קוד זמני.\nיש להתחבר עם הקוד שנשלח אליך במייל ולא להירשם מחדש.');";

if(content.includes(brokenAlertCRLF)) {
  content = content.replace(brokenAlertCRLF, fixedAlert);
  console.log('Fix 1 (CRLF alert): OK');
} else if(content.includes(brokenAlert)) {
  content = content.replace(brokenAlert, fixedAlert);
  console.log('Fix 1 (LF alert): OK');
} else {
  console.log('Fix 1: NOT FOUND - searching...');
  const idx = content.indexOf('קוד זמני');
  if(idx !== -1) console.log(JSON.stringify(content.substring(idx-50, idx+150)));
}

fs.writeFileSync(path, content, 'utf8');

// Now validate with Node
const startTagCRLF = '<script>\r\n// ══════════════════════════════════════\r\n//  STATE';
let start = content.indexOf(startTagCRLF);
if(start === -1) {
  const startTagLF = '<script>\n// ══════════════════════════════════════\n//  STATE';
  start = content.indexOf(startTagLF);
}
const end = content.indexOf('</script>', start);
const script = content.substring(start + 8, end);

try {
  new Function(script);
  console.log('✅ Script syntax OK!');
} catch(e) {
  console.log('❌ Still has error:', e.message);
  const lines = script.split(/\r?\n/);
  const match = e.stack.match(/<anonymous>:(\d+):(\d+)/);
  if(match) {
    const ln = parseInt(match[1]);
    const col = parseInt(match[2]);
    console.log('At script line', ln, 'col', col);
    for(let i=Math.max(0,ln-4); i<Math.min(lines.length,ln+3); i++) {
      console.log(i+1,':', lines[i]);
    }
  }
}
