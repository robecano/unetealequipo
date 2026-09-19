const express = require('express');
const { db, tx, logEvent } = require('./db');
const { requireAuth, requireAdmin } = require('./auth');
const { fullApp, inDays, now, FOLLOWUP_DAYS } = require('./flow');

const STATUSES = ['recibida', 'no_apto_aun', 'sin_pco', 'pendiente_bases', 'listo', 'contactado', 'visito', 'confirmado', 'no_continua'];
const BASES_STATUSES = ['sin_contactar', 'contactado', 'registrado'];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const flag = (v) => (v === false || v === 0 || v === '0' ? 0 : 1);
const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter(Number.isInteger))];

/** Solicitudes visibles: admin todas; líder las de sus equipos y ciudades; Bases las de sus ciudades pendientes de Bases 2. */
function visibleApplications(user, { status, q } = {}) {
  const where = [];
  const params = [];
  if (user.role === 'leader') {
    where.push('a.team_id IN (SELECT team_id FROM leader_teams WHERE user_id = ?)', 'a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)');
    params.push(user.id, user.id);
  } else if (user.role === 'bases') {
    where.push('a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)', "a.status IN ('pendiente_bases')");
    params.push(user.id);
  }
  if (status && STATUSES.includes(status)) (where.push('a.status = ?'), params.push(status));
  if (q) (where.push('(a.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)'), params.push(...Array(3).fill(`%${q}%`)));
  return db.prepare(`SELECT a.id, a.created_at, a.name, a.email, a.phone, a.status, a.bases_status, a.followup_at, a.tenure_months,
                       a.pco_person_id, a.pco_bases1, a.pco_bases2, a.pco_gc, a.error, a.bases_user_id,
                       t.name AS team, c.name AS city, bu.name AS bases_name, bu.email AS bases_email
                     FROM applications a JOIN teams t ON t.id = a.team_id JOIN cities c ON c.id = a.city_id
                     LEFT JOIN users bu ON bu.id = a.bases_user_id
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 500`).all(...params);
}

function canTouch(user, id) {
  return visibleApplications(user).some((a) => a.id === id);
}

module.exports = function panelRoutes({ flow, pco }) {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/applications', (req, res) => res.json(visibleApplications(req.user, { status: req.query.status, q: str(req.query.q, 60) })));

  r.get('/applications/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    res.json({ application: fullApp(id), events: db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY id DESC').all(id) });
  });

  /** Líderes (y admin): estado del seguimiento. Voluntarios de Bases: solo su estado de contacto. */
  r.patch('/applications/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    const a = fullApp(id);
    const { status, bases_status: basesStatus, comment } = req.body || {};
    if (basesStatus !== undefined) {
      if (!BASES_STATUSES.includes(basesStatus)) throw bad('Estado de Bases no válido');
      db.prepare('UPDATE applications SET bases_status=?, updated_at=? WHERE id=?').run(basesStatus, now(), id);
      logEvent(id, req.user.id, 'bases_status', basesStatus);
    }
    if (status !== undefined) {
      if (req.user.role === 'bases') throw bad('Solo el líder puede cambiar este estado', 403);
      if (!['contactado', 'visito', 'confirmado', 'no_continua'].includes(status)) throw bad('Estado no válido');
      const followup = status === 'contactado' ? inDays(FOLLOWUP_DAYS) : status === 'visito' ? inDays(FOLLOWUP_DAYS) : null;
      db.prepare('UPDATE applications SET status=?, followup_at=?, updated_at=? WHERE id=?').run(status, followup, now(), id);
      logEvent(id, req.user.id, 'status', status);
      if (status === 'confirmado' && a.pco_person_id) {
        pco.addNote(a.pco_person_id, `Confirmado como miembro del equipo ${a.team_name} (${a.city})`, 'Interesado en servir').catch((e) => logEvent(id, null, 'nota_error', e.message));
      }
    }
    if (str(comment, 500)) logEvent(id, req.user.id, 'comentario', str(comment, 500));
    res.json({ ok: true });
  }));

  // ---------- Solo administración ----------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/summary', (_req, res) => {
    const by = db.prepare('SELECT status, COUNT(*) n FROM applications GROUP BY status').all();
    res.json({ by_status: Object.fromEntries(by.map((x) => [x.status, x.n])) });
  });

  admin.post('/applications/:id/reprocess', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!fullApp(id)) throw bad('No encontrada', 404);
    db.prepare("UPDATE applications SET status='recibida', error=NULL WHERE id=?").run(id);
    logEvent(id, req.user.id, 'reprocesar');
    res.json({ status: await flow.process(id) });
  }));

  admin.get('/cities', (_req, res) => res.json(db.prepare('SELECT * FROM cities ORDER BY name').all()));
  admin.post('/cities', (req, res) => {
    const name = str(req.body?.name, 80);
    if (!name) throw bad('Falta el nombre');
    try { res.json({ id: Number(db.prepare('INSERT INTO cities (name) VALUES (?)').run(name).lastInsertRowid) }); }
    catch { throw bad('Esa ciudad ya existe'); }
  });
  admin.patch('/cities/:id', (req, res) => {
    const c = req.body || {};
    db.prepare('UPDATE cities SET name = COALESCE(?, name), active = COALESCE(?, active) WHERE id = ?').run(c.name ? str(c.name, 80) : null, c.active === undefined ? null : flag(c.active), Number(req.params.id));
    res.json({ ok: true });
  });

  admin.get('/teams', (_req, res) => res.json(db.prepare('SELECT * FROM teams ORDER BY sort, name').all()));
  const teamFields = (b) => [str(b.name, 80), str(b.description, 1200), str(b.icon, 8), str(b.image_url, 500), Math.max(0, parseInt(b.min_months, 10) || 0), str(b.notice, 600), flag(b.active ?? 1), parseInt(b.sort, 10) || 0];
  admin.post('/teams', (req, res) => {
    const f = teamFields(req.body || {});
    if (!f[0]) throw bad('Falta el nombre');
    try { res.json({ id: Number(db.prepare('INSERT INTO teams (name,description,icon,image_url,min_months,notice,active,sort) VALUES (?,?,?,?,?,?,?,?)').run(...f).lastInsertRowid) }); }
    catch { throw bad('Ese equipo ya existe'); }
  });
  admin.put('/teams/:id', (req, res) => {
    const f = teamFields(req.body || {});
    if (!f[0]) throw bad('Falta el nombre');
    db.prepare('UPDATE teams SET name=?,description=?,icon=?,image_url=?,min_months=?,notice=?,active=?,sort=? WHERE id=?').run(...f, Number(req.params.id));
    res.json({ ok: true });
  });

  const userRow = (u) => ({
    ...u,
    city_ids: db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(u.id).map((x) => x.city_id),
    team_ids: db.prepare('SELECT team_id FROM leader_teams WHERE user_id = ?').all(u.id).map((x) => x.team_id),
  });
  admin.get('/users', (_req, res) => res.json(db.prepare("SELECT id,email,name,role,active FROM users ORDER BY role, name, email").all().map(userRow)));
  function saveUser(id, b) {
    tx(() => {
      db.exec(`DELETE FROM user_cities WHERE user_id = ${id}; DELETE FROM leader_teams WHERE user_id = ${id}`);
      for (const c of ids(b.city_ids)) db.prepare('INSERT OR IGNORE INTO user_cities VALUES (?,?)').run(id, c);
      if (b.role === 'leader') for (const t of ids(b.team_ids)) db.prepare('INSERT OR IGNORE INTO leader_teams VALUES (?,?)').run(id, t);
    });
  }
  admin.post('/users', (req, res) => {
    const b = req.body || {};
    const email = str(b.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email no válido');
    if (!['leader', 'bases', 'admin'].includes(b.role)) throw bad('Rol no válido');
    let id;
    try { id = Number(db.prepare('INSERT INTO users (email,name,role) VALUES (?,?,?)').run(email, str(b.name, 100), b.role).lastInsertRowid); }
    catch { throw bad('Ese email ya existe'); }
    saveUser(id, b);
    res.json({ id });
  });
  admin.put('/users/:id', (req, res) => {
    const b = req.body || {};
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw bad('No encontrado', 404);
    if (id === req.user.id && b.active === false) throw bad('No puedes desactivarte a ti mismo');
    db.prepare('UPDATE users SET name=?, active=? WHERE id=?').run(str(b.name, 100), flag(b.active ?? 1), id);
    saveUser(id, { ...b, role: u.role });
    res.json({ ok: true });
  });
  admin.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw bad('No puedes eliminarte a ti mismo');
    db.prepare('UPDATE applications SET bases_user_id = NULL WHERE bases_user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  r.use('/admin', admin);
  return r;
};
