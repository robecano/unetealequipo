const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tx, logEvent } = require('./db');
const { requireAuth, requireAdmin } = require('./auth');
const config = require('./config');
const { TEAM_LABEL } = require('./teams');
const courses = require('./courses');
const et = require('./email-templates');
const jobs = require('./jobs');
const { getSetting, setSetting } = require('./db');
const { fullApp, inDays, now, FOLLOWUP_DAYS } = require('./flow');

const STATUSES = ['recibida', 'no_apto_aun', 'listo', 'contactado', 'visito', 'confirmado', 'no_continua'];
// Imágenes permitidas: se comprueba la firma real del archivo, no solo lo que declara el navegador. SVG queda fuera a propósito.
const IMAGE_TYPES = {
  'image/png': { ext: 'png', ok: (b) => b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  'image/jpeg': { ext: 'jpg', ok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', ok: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};
const validImageUrl = (u) => u === '' || /^https:\/\//.test(u) || /^\/(uploads|img\/areas)\/[\w.-]+$/.test(u);
const firstChars = (v, n) => [...str(v, 60)].slice(0, n).join('');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const flag = (v) => (v === false || v === 0 || v === '0' ? 0 : 1);
const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter(Number.isInteger))];

/** Lo que puede ver cada rol: administración, todo; líder, las solicitudes de sus equipos y sus ciudades. */
function scopeOf(user) {
  if (user.role === 'leader') {
    return { where: ['a.team_id IN (SELECT team_id FROM leader_teams WHERE user_id = ?)', 'a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)'], params: [user.id, user.id] };
  }
  return { where: [], params: [] };
}

let leadersStmt;
/** Líderes de equipo activos de un equipo en una ciudad. */
function leadersOf(teamId, cityId) {
  leadersStmt ||= db.prepare(`SELECT u.name, u.email, u.phone FROM users u
    JOIN leader_teams lt ON lt.user_id = u.id AND lt.team_id = ? JOIN user_cities uc ON uc.user_id = u.id AND uc.city_id = ?
    WHERE u.role = 'leader' AND u.active = 1 ORDER BY u.name, u.email`);
  return leadersStmt.all(teamId, cityId);
}

function visibleApplications(user, { status, q } = {}, limit = 500) {
  const { where, params } = scopeOf(user);
  if (status && STATUSES.includes(status)) (where.push('a.status = ?'), params.push(status));
  if (q) (where.push('(a.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)'), params.push(...Array(3).fill(`%${q}%`)));
  const rows = db.prepare(`SELECT a.id, a.created_at, a.updated_at, a.name, a.email, a.phone, a.status, a.followup_at, a.tenure_months,
                       a.pco_person_id, a.pco_bases1, a.pco_bases2, a.pco_gc, a.self_bases1, a.self_bases2, a.self_gc, a.error, a.team_id, a.city_id,
                       ${TEAM_LABEL} AS team, c.name AS city
                     FROM applications a JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id JOIN cities c ON c.id = a.city_id
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${Number(limit)}`).all(...params);
  for (const r of rows) {
    r.contrastado = courses.contrastadoInfo(r);
    // Solo la administración ve qué líder(es) de equipo tiene asignada cada persona (los del equipo y la ciudad de su solicitud)
    if (user.role === 'admin') r.leaders = leadersOf(r.team_id, r.city_id);
  }
  return rows;
}

/** ¿Puede este usuario ver/tocar esta solicitud? Consulta directa por id (no depende del límite de la lista). */
function canTouch(user, id) {
  const { where, params } = scopeOf(user);
  return !!db.prepare(`SELECT 1 FROM applications a WHERE a.id = ? ${where.map((w) => `AND ${w}`).join(' ')}`).get(id, ...params);
}

const STATUS_LABEL = { recibida: 'Recibida', no_apto_aun: 'Aún sin antigüedad', listo: 'Para contactar', contactado: 'Contactado', visito: 'Visitó el equipo', confirmado: 'Confirmado', no_continua: 'No continúa' };
const TENURE_LABEL = { 0: 'Menos de 6 meses', 6: '6-12 meses', 12: '1-2 años', 24: 'Más de 2 años' };
/** Fecha en hora local (APP_TZ) y formato dd/mm/aaaa hh:mm. SQLite guarda «aaaa-mm-dd hh:mm:ss» en UTC; el resto, ISO. */
function localDate(v, withTime = true) {
  if (!v) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${String(v).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(v);
  const o = { timeZone: config.tz, day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) };
  return new Intl.DateTimeFormat('es-ES', o).format(d).replace(',', '');
}
const yn = (v) => (v === null || v === undefined ? '' : v ? 'Sí' : 'No');

/** Una celda de CSV: se entrecomilla si hace falta y se neutralizan las fórmulas (=, +, -, @) que Excel ejecutaría. Los teléfonos se dejan tal cual. */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+\d][\d\s().-]*$/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function applicationsCsv(rows, { withLeaders = false } = {}) {
  const head = ['ID', 'Fecha', 'Nombre', 'Email', 'Teléfono', 'Ciudad', 'Equipo', 'Estado', 'Tiempo en la iglesia',
    'Bases 1 (PCO)', 'GC (PCO)', 'Bases 2 (PCO)', 'Bases 1 (dijo)', 'GC (dijo)', 'Bases 2 (dijo)', 'Ficha Planning Center',
    ...(withLeaders ? ['Líder de equipo'] : []), 'Contrastado con PCO', 'Motivo si no', 'Recordatorio', 'Próximo seguimiento', 'Última actualización'];
  const lines = rows.map((a) => [a.id, localDate(a.created_at), a.name, a.email, a.phone, a.city, a.team, STATUS_LABEL[a.status] || a.status, TENURE_LABEL[a.tenure_months] ?? '',
    yn(a.pco_bases1), yn(a.pco_gc), yn(a.pco_bases2), yn(a.self_bases1), yn(a.self_gc), yn(a.self_bases2),
    a.pco_person_id ? `https://people.planningcenteronline.com/people/${a.pco_person_id}` : '',
    ...(withLeaders ? [(a.leaders || []).map((l) => [l.name || l.email, l.phone].filter(Boolean).join(' · ')).join(' / ') || 'Sin líder asignado'] : []),
    a.contrastado.label, a.contrastado.guidance || '', a.contrastado.reminder || '', localDate(a.followup_at, false), localDate(a.updated_at)]);
  // Separador «;» y BOM UTF-8: es lo que espera Excel en español para abrirlo directamente con los acentos bien
  return '﻿' + [head, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Teléfono opcional: si se escribe, debe parecer un teléfono. */
function phoneOf(v) {
  const t = str(v, 30);
  if (!t) return '';
  if (!/^[+\d][\d\s().-]*$/.test(t) || t.replace(/\D/g, '').length < 8) throw bad('El teléfono no es válido');
  return t;
}

module.exports = function panelRoutes({ flow, pco, mail }) {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/applications.csv', (req, res) => {
    const rows = visibleApplications(req.user, { status: req.query.status, q: str(req.query.q, 60) }, 20000);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="solicitudes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(applicationsCsv(rows, { withLeaders: req.user.role === 'admin' }));
  });

  r.get('/applications', (req, res) => res.json(visibleApplications(req.user, { status: req.query.status, q: str(req.query.q, 60) })));

  r.get('/applications/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    res.json({ application: fullApp(id), events: db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY id DESC').all(id) });
  });

  /** Borra una solicitud y su historial (administración, o el líder dentro de lo suyo). */
  r.delete('/applications/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    db.prepare('DELETE FROM applications WHERE id = ?').run(id); // el historial se borra en cascada
    console.log(`Solicitud ${id} borrada por ${req.user.email}`);
    res.json({ ok: true });
  });

  r.patch('/applications/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    const a = fullApp(id);
    const { status, comment } = req.body || {};
    if (status !== undefined) {
      if (!['contactado', 'visito', 'confirmado', 'no_continua'].includes(status)) throw bad('Estado no válido');
      const followup = status === 'contactado' || status === 'visito' ? inDays(FOLLOWUP_DAYS) : null;
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

  /** Subida de imagen de equipo: el cuerpo es el archivo tal cual. Devuelve la URL para guardarla con el equipo. */
  admin.post('/images', express.raw({ type: Object.keys(IMAGE_TYPES), limit: '3mb' }), (req, res) => {
    const spec = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0]];
    if (!spec || !Buffer.isBuffer(req.body) || !req.body.length) throw bad('Usa una imagen PNG, JPG o WebP');
    if (!spec.ok(req.body)) throw bad('El archivo no es una imagen válida');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const name = `team-${crypto.randomBytes(8).toString('hex')}.${spec.ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), req.body);
    res.json({ url: `/uploads/${name}` });
  });

  admin.get('/teams', (_req, res) =>
    res.json(db.prepare('SELECT t.*, p.name AS parent_name FROM teams t LEFT JOIN teams p ON p.id = t.parent_id ORDER BY COALESCE(p.sort, t.sort), COALESCE(p.name, t.name), t.parent_id IS NOT NULL, t.sort, t.name').all()));

  const clamp100 = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 30; };
  const teamFields = (b) => [str(b.name, 80), str(b.description, 1200), firstChars(b.icon, 6), str(b.image_url, 500), Math.max(0, parseInt(b.min_months, 10) || 0), str(b.notice, 600), flag(b.active ?? 1), parseInt(b.sort, 10) || 0, clamp100(b.image_pos)];
  /** parent_id: vacío = es un área (tarjeta). Solo puede colgar de un área, nunca de un subequipo ni de sí mismo. */
  function parentOf(b, selfId) {
    if (b.parent_id === undefined || b.parent_id === null || b.parent_id === '') return null;
    const pid = Number(b.parent_id);
    const area = db.prepare('SELECT id FROM teams WHERE id = ? AND parent_id IS NULL').get(pid);
    if (!area || pid === selfId) throw bad('El área elegida no es válida');
    if (selfId && db.prepare('SELECT 1 FROM teams WHERE parent_id = ?').get(selfId)) throw bad('Un área con subequipos no puede colgar de otra');
    return pid;
  }
  admin.post('/teams', (req, res) => {
    const b = req.body || {};
    const f = teamFields(b);
    if (!f[0]) throw bad('Falta el nombre');
    if (!validImageUrl(f[3])) throw bad('La imagen debe ser una URL https o una imagen subida');
    const parent = parentOf(b, null);
    try { res.json({ id: Number(db.prepare('INSERT INTO teams (name,description,icon,image_url,min_months,notice,active,sort,image_pos,parent_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...f, parent).lastInsertRowid) }); }
    catch { throw bad('Ya existe un equipo con ese nombre en esa área'); }
  });
  admin.put('/teams/:id', (req, res) => {
    const b = req.body || {};
    const id = Number(req.params.id);
    const f = teamFields(b);
    if (!f[0]) throw bad('Falta el nombre');
    if (!validImageUrl(f[3])) throw bad('La imagen debe ser una URL https o una imagen subida');
    const parent = parentOf(b, id);
    try { db.prepare('UPDATE teams SET name=?,description=?,icon=?,image_url=?,min_months=?,notice=?,active=?,sort=?,image_pos=?,parent_id=? WHERE id=?').run(...f, parent, id); }
    catch { throw bad('Ya existe un equipo con ese nombre en esa área'); }
    res.json({ ok: true });
  });
  /** Borra un equipo (y, si es un área, sus subequipos en cascada). No deja borrar uno con solicitudes: hay que ocultarlo o borrarlas antes. */
  admin.delete('/teams/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id)) throw bad('No encontrado', 404);
    try { db.prepare('DELETE FROM teams WHERE id = ?').run(id); }
    catch { throw bad('No se puede borrar: tiene solicitudes registradas (o las tiene algún subequipo suyo). Oculta el equipo en vez de borrarlo, o borra antes esas solicitudes.'); }
    res.json({ ok: true });
  });

  // ---------- Emails: textos editables y horario del resumen ----------
  const tplView = (key) => {
    const t = et.getTemplate(key);
    const def = et.TEMPLATES[key];
    return {
      key, group: def.group, title: def.title, to: def.to, when: def.when, enabled: t.enabled, customized: t.customized, updated_at: t.updated_at || null, updated_by: t.updated_by || '',
      subject: t.subject, heading: t.heading, body: t.body, original: { subject: def.subject, heading: def.heading, body: def.body },
      vars: def.vars.map((n) => ({ name: n, desc: et.VARS[n].desc, block: !!et.VARS[n].block })),
      flags: def.flags.map((n) => ({ name: n, desc: et.FLAGS[n] })), required: def.required,
    };
  };
  const tplOr404 = (key) => { if (!et.TEMPLATES[key]) throw bad('Email no encontrado', 404); return key; };
  const fields = (b) => ({ subject: str(b.subject, 400), heading: str(b.heading, 300), body: typeof b.body === 'string' ? b.body.replace(/\r\n/g, '\n').slice(0, 9000).trim() : '' });

  const scheduleView = () => ({ slots: jobs.digestSchedule(), tz: config.tz });
  admin.get('/emails', (_req, res) => res.json({ groups: et.GROUPS, templates: Object.keys(et.TEMPLATES).map(tplView), schedule: scheduleView() }));

  admin.put('/emails/:key', (req, res) => {
    const key = tplOr404(req.params.key);
    const f = fields(req.body || {});
    const errors = et.validate(key, f);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    const enabled = req.body?.enabled === false ? 0 : 1;
    db.prepare(`INSERT INTO email_templates (key, subject, heading, body, enabled, updated_at, updated_by) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,?)
                ON CONFLICT(key) DO UPDATE SET subject=excluded.subject, heading=excluded.heading, body=excluded.body, enabled=excluded.enabled, updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
      .run(key, f.subject, f.heading, f.body, enabled, req.user.email);
    console.log(`Email "${key}" editado por ${req.user.email}`);
    res.json(tplView(key));
  });

  admin.delete('/emails/:key', (req, res) => {
    db.prepare('DELETE FROM email_templates WHERE key = ?').run(tplOr404(req.params.key));
    res.json(tplView(req.params.key));
  });

  /** Vista previa con datos de ejemplo. Se abre en un iframe: se responde como documento propio con su CSP (los emails llevan estilos en línea). */
  admin.post('/emails/:key/preview', express.urlencoded({ extended: false, limit: '60kb' }), (req, res) => {
    const key = tplOr404(req.params.key);
    const f = fields(req.body || {});
    const errors = et.validate(key, f);
    const page = (inner) => `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:system-ui,sans-serif;background:#e5e7eb">${inner}</body>`;
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store');
    if (errors.length) return res.type('html').send(page(`<div style="padding:16px;color:#991b1b;background:#fee2e2"><b>No se puede previsualizar:</b><ul>${errors.map((e) => `<li>${et.esc(e)}</li>`).join('')}</ul></div>`));
    const m = et.render(key, et.sampleContext(key), f);
    res.type('html').send(page(`<div style="padding:10px 16px;background:#111;color:#fff;font-size:13px"><b>Asunto:</b> ${et.esc(m.subject)}</div>${m.html}`));
  });

  /** Envía la plantilla (con datos de ejemplo) al email del propio administrador. */
  admin.post('/emails/:key/test', wrap(async (req, res) => {
    const key = tplOr404(req.params.key);
    const f = fields(req.body || {});
    const errors = et.validate(key, f);
    if (errors.length) throw bad(errors.join(' '));
    const m = et.render(key, et.sampleContext(key), f);
    const out = await mail.sendMail({ to: req.user.email, subject: `[PRUEBA] ${m.subject}`, html: m.html, text: m.text });
    res.json({ ok: true, to: req.user.email, sent: !!out.sent });
  }));

  admin.put('/email-schedule', (req, res) => {
    const raw = Array.isArray(req.body?.slots) ? req.body.slots : [];
    const slots = raw.map((s) => ({ day: Number(s.day), hour: Number(s.hour) }));
    if (!slots.length) throw bad('Añade al menos un envío');
    if (slots.length > 7) throw bad('Como mucho, 7 envíos');
    for (const s of slots) {
      if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) throw bad('Día no válido');
      if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) throw bad('Hora no válida');
    }
    const dupe = new Set(slots.map((s) => `${s.day}-${s.hour}`));
    if (dupe.size !== slots.length) throw bad('Hay envíos repetidos (mismo día y hora)');
    jobs.setDigestSchedule(slots);
    res.json(scheduleView());
  });

  const userRow = (u) => ({
    ...u,
    city_ids: db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(u.id).map((x) => x.city_id),
    team_ids: db.prepare('SELECT team_id FROM leader_teams WHERE user_id = ?').all(u.id).map((x) => x.team_id),
  });
  admin.get('/users', (_req, res) => res.json(db.prepare("SELECT id,email,name,role,phone,active FROM users ORDER BY name, email").all().map(userRow)));
  function saveUser(id, b) {
    tx(() => {
      db.exec(`DELETE FROM user_cities WHERE user_id = ${id}; DELETE FROM leader_teams WHERE user_id = ${id}`);
      for (const c of ids(b.city_ids)) db.prepare('INSERT OR IGNORE INTO user_cities VALUES (?,?)').run(id, c);
      for (const t of ids(b.team_ids)) db.prepare('INSERT OR IGNORE INTO leader_teams VALUES (?,?)').run(id, t);
    });
  }
  admin.post('/users', (req, res) => {
    const b = req.body || {};
    const email = str(b.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email no válido');
    let id;
    const phone = phoneOf(b.phone);
    try { id = Number(db.prepare("INSERT INTO users (email,name,role,phone) VALUES (?,?,'leader',?)").run(email, str(b.name, 100), phone).lastInsertRowid); }
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
    const email = b.email === undefined ? u.email : str(b.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email no válido');
    try { db.prepare('UPDATE users SET email=?, name=?, phone=?, active=? WHERE id=?').run(email, str(b.name, 100), phoneOf(b.phone), flag(b.active ?? 1), id); }
    catch { throw bad('Ese email ya existe'); }
    saveUser(id, b);
    res.json({ ok: true });
  });
  admin.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw bad('No puedes eliminarte a ti mismo');
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!u) throw bad('No encontrado', 404);
    if (u.role === 'admin') throw bad('No se puede borrar a un administrador desde aquí');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  r.use('/admin', admin);
  return r;
};
