const https = require('https');
const KEY  = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const BASE = 'https://firestore.googleapis.com/v1/projects/dabelu/databases/(default)/documents/pushSubscriptions';

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
}
function del(name) {
  return new Promise((res, rej) => {
    const u = new URL('https://firestore.googleapis.com/v1/' + name + '?key=' + KEY);
    const rq = https.request({ method: 'DELETE', hostname: u.hostname, path: u.pathname + u.search }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(r.statusCode));
    });
    rq.on('error', rej); rq.end();
  });
}

(async () => {
  let all = [], token = null;
  do {
    const url = BASE + '?key=' + KEY + '&pageSize=300' + (token ? '&pageToken=' + token : '');
    const j = await get(url);
    (j.documents || []).forEach(d => all.push(d));
    token = j.nextPageToken;
  } while (token);

  console.log('TOTAL docs:', all.length);

  const seen = new Set();
  const toDelete = [];
  for (const d of all) {
    const ep = d.fields && d.fields.endpoint && d.fields.endpoint.stringValue || '';
    const key = ep || d.name;
    if (seen.has(key)) toDelete.push(d.name);
    else seen.add(key);
  }
  console.log('UNIQUE endpoints kept:', seen.size, '| duplicates to delete:', toDelete.length);

  let done = 0;
  for (const name of toDelete) {
    const st = await del(name);
    if (st === 200) done++;
  }
  console.log('DELETED:', done, '/', toDelete.length);
})().catch(e => console.log('ERR', e.message));
