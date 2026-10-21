// התאמת טקסט משימה ללקוח מהרשימה הקבועה (officeClients).
// מחזיר { client } כשזוהה לקוח אחד, { ambiguous: [שמות] } כשיש כמה אפשרויות, או {} כשאין התאמה.

const SUFFIX = new Set(['בעמ', 'בע"מ']);
const GENERIC = new Set([
  'בעמ', 'ניהול', 'פרוייקטים', 'פרויקטים', 'יועצי', 'מס', 'תעשיה', 'ומסחר', 'מסחר',
  'מגורים', 'נכסים', 'והשקעות', 'השקעות', 'חברה', 'חברת', 'ו', 'ה'
]);

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["'׳״`]/g, '')
    .replace(/[.,:;()\-–—_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}

function clientTokens(name) {
  return tokens(name).filter(t => !SUFFIX.has(t));
}

function textTokenSet(text) {
  const set = new Set();
  for (const t of tokens(text)) {
    set.add(t);
    if (t.length >= 4 && /^[לבמשוהכ]/.test(t)) set.add(t.slice(1));
  }
  return set;
}

function matchOfficeClient(clients, text) {
  const list = (clients || []).filter(c => c && c.name).map(c => ({ c, toks: clientTokens(c.name) })).filter(x => x.toks.length);
  if (!list.length) return {};
  const tset = textTokenSet(text);

  // שם מלא מדויק (כולל "בע"מ") מופיע בטקסט — ההתאמה הוודאית ביותר
  const ntext = ' ' + normalize(text) + ' ';
  const exact = list.filter(x => ntext.includes(' ' + normalize(x.c.name) + ' '));
  if (exact.length) {
    exact.sort((a, b) => normalize(b.c.name).length - normalize(a.c.name).length);
    return { client: exact[0].c };
  }

  const scored = [];
  for (const x of list) {
    let k = 0;
    while (k < x.toks.length && tset.has(x.toks[k])) k++;
    if (!k) continue;
    const full = k === x.toks.length;
    if (!full && !(k >= 3 && k / x.toks.length >= 0.6)) continue;
    scored.push({ x, score: k * 10 + (full ? 5 : 0), k, full });
  }

  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tied = scored.filter(s => s.score === best.score);
    if (tied.length > 1) return { ambiguous: tied.map(s => s.x.c.name) };
    // שם הלקוח שנמצא הוא תחילית של לקוחות אחרים והטקסט לא מבחין ביניהם
    if (best.full) {
      const siblings = list.filter(y => y !== best.x && y.toks.length > best.x.toks.length &&
        best.x.toks.every((t, i) => y.toks[i] === t));
      if (siblings.length) return { ambiguous: [best.x.c.name, ...siblings.map(s => s.c.name)] };
    }
    return { client: best.x.c };
  }

  // גיבוי: מילה ייחודית של לקוח אחד בלבד (למשל שם משפחה)
  const owners = new Map();
  for (const x of list) {
    for (const t of new Set(x.toks)) {
      if (t.length < 3 || GENERIC.has(t)) continue;
      owners.set(t, (owners.get(t) || new Set()).add(x));
    }
  }
  const hits = new Set();
  for (const [t, xs] of owners) {
    if (xs.size === 1 && tset.has(t)) hits.add([...xs][0]);
  }
  if (hits.size === 1) return { client: [...hits][0].c };
  if (hits.size > 1) return { ambiguous: [...hits].map(h => h.c.name) };
  return {};
}

module.exports = { matchOfficeClient };
