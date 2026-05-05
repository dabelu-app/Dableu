const fs = require('fs');
let content = fs.readFileSync('C:/Users/user1/dabelu/tax_manager_app.html', 'utf8');

// Remove the extra closing brace after doEnter
// Current structure: "  }\n  }\n  \n  btn.addEventListener" - should be "  }\n  \n  btn.addEventListener"
const broken_CRLF = "    if (typeof enterApp === 'function') enterApp();\r\n  }\r\n  }\r\n  \r\n  btn.addEventListener";
const broken_LF   = "    if (typeof enterApp === 'function') enterApp();\n  }\n  }\n  \n  btn.addEventListener";
const fixed_CRLF  = "    if (typeof enterApp === 'function') enterApp();\r\n  }\r\n  \r\n  btn.addEventListener";
const fixed_LF    = "    if (typeof enterApp === 'function') enterApp();\n  }\n  \n  btn.addEventListener";

if(content.includes(broken_CRLF)) {
  content = content.replace(broken_CRLF, fixed_CRLF);
  console.log('Extra brace removed (CRLF): OK');
} else if(content.includes(broken_LF)) {
  content = content.replace(broken_LF, fixed_LF);
  console.log('Extra brace removed (LF): OK');
} else {
  console.log('Pattern not found, searching...');
  const idx = content.indexOf('btn.addEventListener');
  console.log(JSON.stringify(content.substring(idx-100, idx+50)));
}

fs.writeFileSync('C:/Users/user1/dabelu/tax_manager_app.html', content, 'utf8');

// Syntax check
const startTag = '<script>\r\n// ══════════════════════════════════════\r\n//  STATE';
let s = content.indexOf(startTag);
const e = content.indexOf('</script>', s);
const script = content.substring(s + 8, e);
fs.writeFileSync('C:/Users/user1/dabelu/check_script.js', script, 'utf8');
