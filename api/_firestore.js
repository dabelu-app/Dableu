/**
 * _firestore.js — Smart fetch wrapper for Firestore REST API.
 * Replaces ?key=API_KEY with a service-account Bearer token so
 * all server-side Firestore calls bypass security rules (admin access).
 * Drop-in replacement for node-fetch: non-Firestore URLs pass through unchanged.
 */
const _nodeFetch = require('node-fetch');
const { google }  = require('googleapis');

let _client = null;

async function _getToken() {
  try {
    if (!_client) {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || 'null');
      if (!creds) return null;
      _client = await new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/datastore']
      }).getClient();
    }
    return (await _client.getAccessToken()).token;
  } catch(e) {
    console.error('[_firestore] getToken error:', e.message);
    return null;
  }
}

module.exports = async function fetch(url, opts = {}) {
  const s = String(url);
  if (s.includes('firestore.googleapis.com')) {
    const token = await _getToken();
    if (token) {
      const clean = s
        .replace(/&key=[^&]*/g, '')
        .replace(/\?key=[^&]*&/, '?')
        .replace(/\?key=[^&]*/g, '');
      return _nodeFetch(clean, {
        ...opts,
        headers: { ...(opts.headers || {}), 'Authorization': `Bearer ${token}` }
      });
    }
  }
  return _nodeFetch(url, opts);
};
