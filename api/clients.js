const { fsFetch } = require('../lib/firestore');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function setCors(res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

const COL = 'officeClients';

function fsStr(v) { return { stringValue: String(v) }; }

function docToClient(doc) {
  const f = doc.fields || {};
  return {
    id:       doc.name.split('/').pop(),
    name:     f.name?.stringValue     || '',
    email:    f.email?.stringValue    || '',
    phone:    f.phone?.stringValue    || '',
    whatsapp: f.whatsapp?.stringValue || '',
    notes:    f.notes?.stringValue    || '',
    taxId:    f.taxId?.stringValue    || '',
  };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET ?userId=xxx
    if (req.method === 'GET') {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: 'userId required' });

      const resp = await fsFetch(':runQuery', {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: COL }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'userId' },
                op: 'EQUAL',
                value: { stringValue: userId },
              },
            },
            limit: 500,
          },
        }),
      });
      const rows = await resp.json();
      const clients = rows
        .filter(r => r.document)
        .map(r => docToClient(r.document));
      return res.status(200).json({ clients });
    }

    // POST { userId, name, email?, phone?, whatsapp?, notes? }
    if (req.method === 'POST') {
      const { userId, name, email, phone, whatsapp, notes, taxId } = req.body || {};
      if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });

      const fields = {
        userId:    fsStr(userId),
        name:      fsStr(name),
        createdAt: fsStr(new Date().toISOString()),
      };
      if (email    !== undefined) fields.email    = fsStr(email);
      if (phone    !== undefined) fields.phone    = fsStr(phone);
      if (whatsapp !== undefined) fields.whatsapp = fsStr(whatsapp);
      if (notes    !== undefined) fields.notes    = fsStr(notes);
      if (taxId    !== undefined) fields.taxId    = fsStr(taxId);

      const resp = await fsFetch('/' + COL, {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
      const doc = await resp.json();
      if (!resp.ok) return res.status(502).json({ error: doc.error?.message || 'firestore error' });
      const id = doc.name.split('/').pop();
      return res.status(200).json({ ok: true, id });
    }

    // PATCH { userId, id, name?, email?, phone?, whatsapp?, notes? }
    if (req.method === 'PATCH') {
      const { userId, id, name, email, phone, whatsapp, notes, taxId } = req.body || {};
      if (!userId || !id) return res.status(400).json({ error: 'userId and id required' });

      const getResp = await fsFetch('/' + COL + '/' + id);
      const existing = await getResp.json();
      if (!getResp.ok) return res.status(404).json({ error: 'not found' });
      if (existing.fields?.userId?.stringValue !== userId) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const updates = {};
      const mask = [];
      const add = (key, val) => {
        if (val !== undefined) { updates[key] = fsStr(val); mask.push(key); }
      };
      add('name',     name);
      add('email',    email);
      add('phone',    phone);
      add('whatsapp', whatsapp);
      add('notes',    notes);
      add('taxId',    taxId);

      if (mask.length === 0) return res.status(200).json({ ok: true });

      const qs = mask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
      const patchResp = await fsFetch(`/${COL}/${id}?${qs}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: updates }),
      });
      if (!patchResp.ok) {
        const err = await patchResp.json();
        return res.status(502).json({ error: err.error?.message || 'firestore error' });
      }
      return res.status(200).json({ ok: true });
    }

    // DELETE ?userId=xxx&id=yyy
    if (req.method === 'DELETE') {
      const { userId, id } = req.query;
      if (!userId || !id) return res.status(400).json({ error: 'userId and id required' });

      const getResp = await fsFetch('/' + COL + '/' + id);
      const existing = await getResp.json();
      if (!getResp.ok) return res.status(404).json({ error: 'not found' });
      if (existing.fields?.userId?.stringValue !== userId) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const delResp = await fsFetch('/' + COL + '/' + id, { method: 'DELETE' });
      if (!delResp.ok) {
        const err = await delResp.json();
        return res.status(502).json({ error: err.error?.message || 'firestore error' });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[clients]', e);
    return res.status(500).json({ error: e.message });
  }
};
