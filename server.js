const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const { db, logEvent } = require('./src/db');
const pco = require('./src/pco');
const mail = require('./src/mail');
const auth = require('./src/auth');
const { createFlow } = require('./src/flow');
const jobs = require('./src/jobs');

if (config.sessionSecret.length < 32) {
  console.error('Falta SESSION_SECRET (mínimo 32 caracteres).');
  process.exit(1);
}

const flow = createFlow({ pco, mail });
const app = express();
if (config.production) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // img-src https: permite las fotos de equipos alojadas fuera (URL que pone el admin)
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' https: data:; frame-ancestors 'none'");
  next();
});
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Origen no permitido' });
    } catch {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
  }
  next();
});
app.use(auth.loadUser);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- Público ----------

app.get('/api/public', (_req, res) => {
  res.json({
    teams: db.prepare('SELECT id,name,description,icon,image_url,min_months,notice FROM teams WHERE active = 1 ORDER BY sort, name').all(),
    cities: db.prepare('SELECT id,name FROM cities WHERE active = 1 ORDER BY name').all(),
    urls: config.urls,
  });
});

const TENURES = [0, 6, 12, 24];
const applyLimit = auth.limiter(6, 60 * 60 * 1000);
const yesNo = (v) => (v === true || v === 'si' || v === 'sí' || v === 1 || v === '1' ? 1 : 0);
const OPEN_STATUSES = ['recibida', 'pendiente_bases', 'listo', 'contactado', 'visito'];

app.post('/api/apply', (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // campo trampa: los bots lo rellenan
  if (applyLimit.blocked(req.ip)) throw bad('Demasiados envíos desde tu conexión. Inténtalo más tarde.', 429);
  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const city = db.prepare('SELECT id FROM cities WHERE id = ? AND active = 1').get(Number(b.city_id));
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND active = 1').get(Number(b.team_id));
  const tenure = Number(b.tenure);
  if (name.length < 2) throw bad('Escribe tu nombre');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('El email no es válido');
  if (phone.replace(/\D/g, '').length < 8) throw bad('El teléfono no es válido');
  if (!city) throw bad('Elige tu ciudad');
  if (!team) throw bad('Elige un equipo');
  if (!TENURES.includes(tenure)) throw bad('Indica cuánto tiempo llevas en la iglesia');
  applyLimit.hit(req.ip);

  // Misma persona, mismo equipo y ciudad y solicitud aún abierta: no se duplica
  const dup = db.prepare(`SELECT id FROM applications WHERE email = ? AND team_id = ? AND city_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).get(email, team.id, city.id, ...OPEN_STATUSES);
  if (dup) return res.json({ ok: true, duplicate: true });

  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,self_bases1,self_bases2,self_gc) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(name, email, phone, city.id, team.id, tenure, yesNo(b.bases1), yesNo(b.bases2), yesNo(b.gc)).lastInsertRowid);
  logEvent(id, null, 'recibida', 'Formulario web');
  res.json({ ok: true });
  setImmediate(() => flow.process(id).catch((e) => console.error('Procesar solicitud', id, e.message)));
});

// ---------- Sesión ----------

const loginLimit = auth.limiter(8, 15 * 60 * 1000);
app.post('/api/login', (req, res) => {
  if (loginLimit.blocked(req.ip)) throw bad('Demasiados intentos. Prueba en unos minutos.', 429);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  // Se ejecuta siempre la comprobación de contraseña para no revelar si el email existe
  const ok = auth.checkPassword(user?.role || 'leader', password);
  if (!user || !user.active || !ok) {
    loginLimit.hit(req.ip);
    throw bad('Email o contraseña incorrectos', 401);
  }
  loginLimit.clear(req.ip);
  auth.setSessionCookie(res, user.id);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});
app.post('/api/logout', (_req, res) => (auth.clearSessionCookie(res), res.json({ ok: true })));
app.get('/api/me', (req, res) => (req.user ? res.json(req.user) : res.status(401).json({ error: 'Sesión no iniciada' })));

app.use('/api/panel', require('./src/panel-routes')({ flow, pco }));

// ---------- Estático ----------

fs.mkdirSync(config.uploadsDir, { recursive: true });
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La imagen es demasiado grande (máximo 3 MB)' });
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Error interno' });
});

// Administrador inicial
if (config.adminEmail) {
  db.prepare("INSERT INTO users (email, name, role) VALUES (?, 'Administrador', 'admin') ON CONFLICT(email) DO UPDATE SET role='admin', active=1").run(config.adminEmail);
}
if (!config.panelPassword) console.warn('PANEL_PASSWORD vacío: líderes y voluntarios de Bases no podrán entrar.');
if (!config.adminPassword) console.warn('ADMIN_PASSWORD vacío: el administrador no podrá entrar.');

if (require.main === module) {
  if (process.env.SEED_DEMO === '1') require('./scripts/seed-demo');
  app.listen(config.port, config.host, () => {
    console.log(`Únete al equipo en http://localhost:${config.port}`);
    jobs.start(flow);
  });
}
module.exports = { app, flow };
