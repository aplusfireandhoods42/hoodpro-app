const crypto = require('crypto');

// Simple in-memory session store (fine for a small single-server business app).
const sessions = new Map();
const SESSION_COOKIE = 'hp_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function createSession(res, data) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { data, expires: Date.now() + MAX_AGE_MS });
  setCookie(res, SESSION_COOKIE, id, MAX_AGE_MS);
  return id;
}

function destroySession(req, res) {
  const cookies = parseCookies(req);
  const id = cookies[SESSION_COOKIE];
  if (id) sessions.delete(id);
  setCookie(res, SESSION_COOKIE, '', 0);
}

function getSession(req) {
  const cookies = parseCookies(req);
  const id = cookies[SESSION_COOKIE];
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return s.data;
}

function setCookie(res, name, value, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs === 0) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else {
    parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  }
  const existing = res.getHeader('Set-Cookie');
  const cookieStr = parts.join('; ');
  if (existing) {
    res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', cookieStr);
  }
}

module.exports = { parseCookies, createSession, destroySession, getSession, SESSION_COOKIE };
