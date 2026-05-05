const fs = require('fs');
const content = fs.readFileSync('C:/Users/user1/dabelu/tax_manager_app.html', 'utf8');
const lines = content.split('\n');

const start = 673;
let end = -1;
for(let i=start+1;i<lines.length;i++){
  const t = lines[i].replace('\r','').trim();
  if(t==='</script>'){end=i;break;}
}

const block = lines.slice(start+1, end).join('\n');
console.log('Block: lines '+(start+2)+' to '+(end+1));

let depth = 0;
let inStr = null;
let escape = false;
let lineNum = 1;

for(let i=0;i<block.length;i++){
  const c = block[i];
  if(c==='\n'){lineNum++;continue;}

  if(escape){escape=false;continue;}

  if(inStr==='line'){
    continue;
  }
  if(inStr==='block'){
    if(c==='*' && block[i+1]==='/'){inStr=null;i++;}
    continue;
  }
  if(inStr){
    const bs = '\\';
    if(c===bs){escape=true;}
    else if(c===inStr){inStr=null;}
    continue;
  }

  if(c==='/' && block[i+1]==='/'){inStr='line';i++;continue;}
  if(c==='/' && block[i+1]==='*'){inStr='block';i++;continue;}
  if(c==='"'){inStr='"';continue;}
  const sq = "'";
  if(c===sq){inStr=sq;continue;}
  const bt = '`';
  if(c===bt){inStr=bt;continue;}

  if(c==='{'){depth++;}
  if(c==='}'){
    depth--;
    if(depth<0){
      console.log('NEGATIVE depth at block line '+lineNum+' (file line '+(start+1+lineNum-1)+')');
      depth=0;
    }
  }
}

console.log('Final brace depth:', depth, '(should be 0)');
if(depth!==0) console.log('UNBALANCED BRACES!');
else console.log('Braces balanced OK');
