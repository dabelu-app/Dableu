const { fsFetch } = require('../lib/firestore');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function setCors(res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

const HOURS_COL = 'hoursLog';

function fsStr(v) { return { stringValue: String(v) }; }
function fsInt(v) { return { integerValue: String(Number(v)) }; }

function docToHour(doc) {
  const f = doc.fields || {};
  return {
    id:           doc.name.split('/').pop(),
    clientId:     f.clientId?.stringValue     || '',
    clientName:   f.clientName?.stringValue   || '',
    minutes:      Number(f.minutes?.integerValue ?? f.minutes?.doubleValue ?? 0),
    date:         f.date?.stringValue         || '',
    note:         f.note?.stringValue         || '',
    employeeId:   f.employeeId?.stringValue   || '',
    employeeName: f.employeeName?.stringValue || '',
    createdAt:    f.createdAt?.stringValue    || '',
    startedAt:    f.startedAt?.stringValue    || '',
    endedAt:      f.endedAt?.stringValue      || '',
  };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET ?userId=xxx[&from=YYYY-MM-DD][&to=YYYY-MM-DD][&clientId=yyy][&employeeId=zzz]
    if (req.method === 'GET') {
      const { userId, from, to, clientId, employeeId } = req.query;
      if (!userId) return res.status(400).json({ error: 'userId required' });

      // רק סינון תאריכים בשאילתה (אינדקס חד-שדה אוטומטי); שאר הסינון בקוד — בלי אינדקס מורכב
      const filters = [];
      if (from)
        filters.push({ fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: from } } });
      if (to)
        filters.push({ fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL',    value: { stringValue: to }   } });

      const where = filters.length === 0
        ? undefined
        : filters.length === 1
          ? filters[0]
          : { compositeFilter: { op: 'AND', filters } };

      const structuredQuery = { from: [{ collectionId: HOURS_COL }] };
      if (where) structuredQuery.where = where;

      const resp = await fsFetch(`/users/${userId}:runQuery`, {
        method: 'POST',
        body: JSON.stringify({ structuredQuery }),
      });
      const rows = await resp.json();
      if (!Array.isArray(rows) || (rows[0] && rows[0].error)) {
        return res.status(502).json({ error: (rows[0] && rows[0].error && rows[0].error.message) || (rows && rows.error && rows.error.message) || 'firestore error' });
      }
      const hours = rows.filter(r => r.document).map(r => docToHour(r.document))
        .filter(h => (!clientId || h.clientId === clientId) && (!employeeId || h.employeeId === employeeId));

      const summary = { totalMinutes: 0, byClient: {}, byEmployee: {} };
      for (const h of hours) {
        summary.totalMinutes += h.minutes;
        summary.byClient[h.clientName]     = (summary.byClient[h.clientName]     || 0) + h.minutes;
        summary.byEmployee[h.employeeName] = (summary.byEmployee[h.employeeName] || 0) + h.minutes;
      }

      return res.status(200).json({ hours, summary });
    }

    // POST { userId, clientId, clientName, minutes, date, note?, employeeId, employeeName }
    if (req.method === 'POST') {
      const { userId, clientId, clientName, minutes, date, note, employeeId, employeeName, startedAt, endedAt } = req.body || {};
      const minutesNum = Number(minutes);
      if (!userId || !clientId || !date || !employeeId || !minutes || isNaN(minutesNum) || minutesNum <= 0) {
        return res.status(400).json({ error: 'userId, clientId, minutes (positive), date, employeeId required' });
      }

      const fields = {
        clientId:     fsStr(clientId),
        clientName:   fsStr(clientName   || ''),
        minutes:      fsInt(minutesNum),
        date:         fsStr(date),
        employeeId:   fsStr(employeeId),
        employeeName: fsStr(employeeName || ''),
        createdAt:    fsStr(new Date().toISOString()),
      };
      if (note !== undefined) fields.note = fsStr(note);
      if (startedAt) fields.startedAt = fsStr(startedAt);
      if (endedAt)   fields.endedAt   = fsStr(endedAt);

      const resp = await fsFetch(`/users/${userId}/${HOURS_COL}`, {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
      const doc = await resp.json();
      if (!resp.ok) return res.status(502).json({ error: doc.error?.message || 'firestore error' });
      const id = doc.name.split('/').pop();
      return res.status(200).json({ ok: true, id });
    }

    // DELETE ?userId=xxx&id=yyy
    if (req.method === 'DELETE') {
      const { userId, id } = req.query;
      if (!userId || !id) return res.status(400).json({ error: 'userId and id required' });

      const docPath = `/users/${userId}/${HOURS_COL}/${id}`;
      const getResp = await fsFetch(docPath);
      if (!getResp.ok) return res.status(404).json({ error: 'not found' });

      const delResp = await fsFetch(docPath, { method: 'DELETE' });
      if (!delResp.ok) {
        const err = await delResp.json();
        return res.status(502).json({ error: err.error?.message || 'firestore error' });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[hours]', e);
    return res.status(500).json({ error: e.message });
  }
};
