const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');

const SESSION_DAYS = 14;
const COOKIE = 'sid';

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
/** Comparación en tiempo constante. Una contraseña vacía en la configuración nunca coincide. */
function safeEqual(a, b) {
  if (!a || !b) return false;
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** Los administradores usan ADMIN_PASSWORD; líderes y voluntarios de Bases, la contraseña común PANEL_PASSWORD. */
function checkPassword(role, password) {
  return safeEqual(role === 'admin' ? config.adminPassword : config.panelPassword, password);
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url')}`;
}
function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, userId) {
  const token = sign({ uid: userId, exp: Date.now() + SESSION_DAYS * 86400000 });
  const flags = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_DAYS * 86400}`];
  if (config.production) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function loadUser(req, _res, next) {
  const payload = unsign(parseCookies(req.headers.cookie)[COOKIE]);
  if (payload) {
    const user = db.prepare('SELECT id, email, name, role, active FROM users WHERE id = ?').get(payload.uid);
    if (user && user.active) req.user = user;
  }
  next();
}
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Sesión no iniciada' }));
const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Sesión no iniciada' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo para administradores' });
  next();
};

// ---------- Límite de intentos (login y formulario) ----------
function limiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked(key) {
      const a = hits.get(key);
      if (!a) return false;
      if (a.resetAt < Date.now()) return hits.delete(key), false;
      return a.count >= max;
    },
    hit(key) {
      const a = hits.get(key);
      if (!a || a.resetAt < Date.now()) hits.set(key, { count: 1, resetAt: Date.now() + windowMs });
      else a.count++;
    },
    clear: (key) => hits.delete(key),
  };
}

module.exports = { checkPassword, setSessionCookie, clearSessionCookie, loadUser, requireAuth, requireAdmin, limiter };
