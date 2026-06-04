const https = require('https');
const KEY  = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const BASE = 'https://firestore.googleapis.com/v1/projects/dabelu/databases/(default)/documents/appointments';

function get(url){return new Promise((res,rej)=>{https.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
function del(name){return new Promise((res,rej)=>{const u=new URL('https://firestore.googleapis.com/v1/'+name+'?key='+KEY);const rq=https.request({method:'DELETE',hostname:u.hostname,path:u.pathname+u.search},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(r.statusCode));});rq.on('error',rej);rq.end();});}
const sv = (f,k)=> (f[k] && f[k].stringValue) || '';

(async()=>{
  let all=[], token=null;
  do{
    const j = await get(BASE+'?key='+KEY+'&pageSize=300'+(token?'&pageToken='+token:''));
    (j.documents||[]).forEach(d=>all.push(d));
    token = j.nextPageToken;
  } while(token);
  console.log('TOTAL appointments:', all.length);

  const groups = {};
  for(const d of all){
    const f = d.fields||{};
    const key = [sv(f,'userId'), sv(f,'date'), sv(f,'time'), sv(f,'title'), sv(f,'clientName'), sv(f,'type')].join('|');
    (groups[key] = groups[key] || []).push(d.name);
  }

  const toDelete = [];
  let dupGroups = 0;
  for(const key of Object.keys(groups)){
    const names = groups[key];
    if(names.length > 1){
      dupGroups++;
      console.log('DUP x'+names.length+' :: '+key.replace(/\|/g,' | '));
      toDelete.push(...names.slice(1)); // keep first, delete rest
    }
  }
  console.log('\nduplicate groups:', dupGroups, '| records to delete:', toDelete.length);

  let done=0;
  for(const name of toDelete){ const st=await del(name); if(st===200) done++; }
  console.log('DELETED:', done, '/', toDelete.length, '| remaining:', all.length - done);
})().catch(e=>console.log('ERR', e.message));
