const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tx, logEvent } = require('./db');
const { requireAuth, requireAdminLike, requireSuperAdmin } = require('./auth');
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

// «Aceptado» en SQL, misma regla que courses.accepted: lo que dice Planning Center o, si no, lo que declaró la persona.
const SQL_ACCEPTED = (k) => `(a.pco_${k} = 1 OR a.self_${k} = 1)`;
// «Falta según PCO» en SQL, misma regla que courses.pcoOk negada: IFNULL trata sin ficha (NULL) también como que falta.
const SQL_PCO_MISSING = (k) => `IFNULL(a.pco_${k}, 0) != 1`;
// Mismas reglas que courses.needsBases/needsGc: incluye a quien lo autodeclaró pero Planning Center no lo confirma.
const SQL_NEEDS_BASES = `(${SQL_PCO_MISSING('bases1')} OR ${SQL_PCO_MISSING('bases2')})`;
const SQL_NEEDS_GC = `(${SQL_ACCEPTED('bases1')} AND ${SQL_PCO_MISSING('gc')})`;
// Categorías del filtro de administración: en qué falta (según PCO, como Bases/GC) o si está completo (regla laxa, como el resto del sistema).
const CATEGORY_SQL = {
  falta_bases1: SQL_PCO_MISSING('bases1'),
  falta_bases2: SQL_PCO_MISSING('bases2'),
  falta_gc: SQL_NEEDS_GC,
  completo: `(${SQL_ACCEPTED('bases1')} AND ${SQL_ACCEPTED('bases2')} AND ${SQL_ACCEPTED('gc')})`,
};

/**
 * Lo que puede ver cada rol: administración (total o de ciudad), todo lo de su ámbito; seguimiento de Equipos,
 * de Bases o de GC, las solicitudes de sus ciudades — Equipos ve a todos, Bases y GC solo a quienes de verdad
 * les toca (courses.needsBases/needsGc).
 */
function scopeOf(user) {
  if (user.role === 'city_admin' || user.role === 'leader') {
    return { where: ['a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)'], params: [user.id] };
  }
  if (user.role === 'bases' || user.role === 'gc') {
    return { where: ['a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)', user.role === 'bases' ? SQL_NEEDS_BASES : SQL_NEEDS_GC], params: [user.id] };
  }
  return { where: [], params: [] };
}

let roleLeadersStmt;
/** Quien hace seguimiento de Equipos, de Bases o de GC en una ciudad (por ciudad, no por equipo). */
function roleLeadersOf(role, cityId) {
  roleLeadersStmt ||= db.prepare(`SELECT u.name, u.email, u.phone FROM users u
    JOIN user_cities uc ON uc.user_id = u.id AND uc.city_id = ?
    WHERE u.role = ? AND u.active = 1 ORDER BY u.name, u.email`);
  return roleLeadersStmt.all(cityId, role);
}

// Cuántas veces y cuándo se ha contactado (Equipos: cada vez que se pone «contactado»; Bases/GC: cada «Contactar»).
const SQL_CONTACT_COUNT = (event) => `(SELECT COUNT(*) FROM application_events e WHERE e.application_id = a.id AND e.event = '${event}')`;
const SQL_CONTACT_LAST = (event) => `(SELECT MAX(e.created_at) FROM application_events e WHERE e.application_id = a.id AND e.event = '${event}')`;

function visibleApplications(user, { status, q, category } = {}, limit = 500) {
  const { where, params } = scopeOf(user);
  if (status && STATUSES.includes(status)) (where.push('a.status = ?'), params.push(status));
  if (category && CATEGORY_SQL[category]) where.push(CATEGORY_SQL[category]);
  if (q) (where.push('(a.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)'), params.push(...Array(3).fill(`%${q}%`)));
  const rows = db.prepare(`SELECT a.id, a.created_at, a.updated_at, a.name, a.email, a.phone, a.status, a.followup_at, a.tenure_months,
                       a.pco_person_id, a.pco_bases1, a.pco_bases2, a.pco_gc, a.self_bases1, a.self_bases2, a.self_gc, a.error, a.team_id, a.city_id,
                       ${SQL_CONTACT_COUNT('contactado_bases')} AS bases_contact_count, ${SQL_CONTACT_LAST('contactado_bases')} AS bases_last_contact,
                       ${SQL_CONTACT_COUNT('contactado_gc')} AS gc_contact_count, ${SQL_CONTACT_LAST('contactado_gc')} AS gc_last_contact,
                       ${TEAM_LABEL} AS team, c.name AS city
                     FROM applications a JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id JOIN cities c ON c.id = a.city_id
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${Number(limit)}`).all(...params);
  for (const r of rows) {
    r.contrastado = courses.contrastadoInfo(r);
    // Lo que le falta curso a curso según Planning Center (para la vista propia de seguimiento de Bases/GC)
    r.basesGaps = courses.basesGaps(r);
    r.gcGaps = courses.gcGaps(r);
    r.pco_url = r.pco_person_id ? `https://people.planningcenteronline.com/people/${r.pco_person_id}` : null;
    // Solo administración (total o de ciudad) ve quién hace seguimiento de cada persona (Equipos siempre; Bases o GC si le toca)
    if (user.role === 'admin' || user.role === 'city_admin') {
      r.leaders = roleLeadersOf('leader', r.city_id);
      if (courses.needsBases(r)) r.basesLeaders = roleLeadersOf('bases', r.city_id);
      if (courses.needsGc(r)) r.gcLeaders = roleLeadersOf('gc', r.city_id);
    }
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

const leadersCell = (list) => (list || []).map((l) => [l.name || l.email, l.phone].filter(Boolean).join(' · ')).join(' / ') || 'Sin seguimiento asignado';

function applicationsCsv(rows, { withLeaders = false } = {}) {
  const head = ['ID', 'Fecha', 'Nombre', 'Email', 'Teléfono', 'Ciudad', 'Equipo', 'Estado', 'Tiempo en la iglesia',
    'Bases 1 (PCO)', 'GC (PCO)', 'Bases 2 (PCO)', 'Bases 1 (dijo)', 'GC (dijo)', 'Bases 2 (dijo)', 'Ficha Planning Center',
    ...(withLeaders ? ['Seguimiento de Equipos', 'Seguimiento de Bases', 'Seguimiento de GC'] : []),
    'Bases: veces contactada', 'Bases: último contacto', 'GC: veces contactada', 'GC: último contacto',
    'OK con PCO', 'Motivo si no', 'Recordatorio', 'Próximo seguimiento', 'Última actualización'];
  const lines = rows.map((a) => [a.id, localDate(a.created_at), a.name, a.email, a.phone, a.city, a.team, STATUS_LABEL[a.status] || a.status, TENURE_LABEL[a.tenure_months] ?? '',
    yn(a.pco_bases1), yn(a.pco_gc), yn(a.pco_bases2), yn(a.self_bases1), yn(a.self_gc), yn(a.self_bases2),
    a.pco_url || '',
    ...(withLeaders ? [leadersCell(a.leaders), a.basesLeaders ? leadersCell(a.basesLeaders) : '', a.gcLeaders ? leadersCell(a.gcLeaders) : ''] : []),
    a.bases_contact_count, a.bases_last_contact ? localDate(a.bases_last_contact) : '', a.gc_contact_count, a.gc_last_contact ? localDate(a.gc_last_contact) : '',
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
    const rows = visibleApplications(req.user, { status: req.query.status, q: str(req.query.q, 60), category: str(req.query.category, 20) }, 20000);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="solicitudes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(applicationsCsv(rows, { withLeaders: ['admin', 'city_admin'].includes(req.user.role) }));
  });

  r.get('/applications', (req, res) => res.json(visibleApplications(req.user, { status: req.query.status, q: str(req.query.q, 60), category: str(req.query.category, 20) })));

  r.get('/applications/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    res.json({ application: fullApp(id), events: db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY id DESC').all(id) });
  });

  /** Borra una solicitud y su historial (administración, o seguimiento de Equipos dentro de su ciudad). */
  r.delete('/applications/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    if (!['admin', 'city_admin', 'leader'].includes(req.user.role)) throw bad('No tienes permiso para borrar', 403);
    db.prepare('DELETE FROM applications WHERE id = ?').run(id); // el historial se borra en cascada
    console.log(`Solicitud ${id} borrada por ${req.user.email}`);
    res.json({ ok: true });
  });

  r.patch('/applications/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    const a = fullApp(id);
    const { status, comment, contact } = req.body || {};
    // El estado de la solicitud lo lleva administración y seguimiento de Equipos; Bases y GC solo ven, comentan y marcan que han contactado.
    if (status !== undefined && !['admin', 'city_admin', 'leader'].includes(req.user.role)) throw bad('No tienes permiso para cambiar el estado', 403);
    if (status !== undefined) {
      if (!['contactado', 'visito', 'confirmado', 'no_continua'].includes(status)) throw bad('Estado no válido');
      const followup = status === 'contactado' || status === 'visito' ? inDays(FOLLOWUP_DAYS) : null;
      db.prepare('UPDATE applications SET status=?, followup_at=?, updated_at=? WHERE id=?').run(status, followup, now(), id);
      logEvent(id, req.user.id, 'status', status);
      if (status === 'confirmado' && a.pco_person_id) {
        pco.addNote(a.pco_person_id, `Confirmado como miembro del equipo ${a.team_name} (${a.city})`, 'Interesado en servir').catch((e) => logEvent(id, null, 'nota_error', e.message));
      }
    }
    // Que Bases o GC marquen que han contactado: cada pulsación añade un contacto nuevo (fecha y contador), sin deshacer.
    if (contact) {
      if (!['bases', 'gc'].includes(req.user.role)) throw bad('Solo seguimiento de Bases o de GC puede marcar esto', 403);
      logEvent(id, req.user.id, `contactado_${req.user.role}`);
    }
    if (str(comment, 500)) logEvent(id, req.user.id, 'comentario', str(comment, 500));
    res.json({ ok: true });
  }));

  // ---------- Solo administración (total o de ciudad) ----------
  const admin = express.Router();
  admin.use(requireAdminLike);

  admin.get('/summary', requireSuperAdmin, (_req, res) => {
    const by = db.prepare('SELECT status, COUNT(*) n FROM applications GROUP BY status').all();
    res.json({ by_status: Object.fromEntries(by.map((x) => [x.status, x.n])) });
  });

  admin.post('/applications/:id/reprocess', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!canTouch(req.user, id)) throw bad('No encontrada', 404);
    db.prepare("UPDATE applications SET status='recibida', error=NULL WHERE id=?").run(id);
    logEvent(id, req.user.id, 'reprocesar');
    res.json({ status: await flow.process(id) });
  }));

  // Las ciudades solo las gestiona el administrador total: el de ciudad ya está limitado a la suya.
  admin.get('/cities', (_req, res) => res.json(db.prepare('SELECT * FROM cities ORDER BY name').all()));
  admin.post('/cities', requireSuperAdmin, (req, res) => {
    const name = str(req.body?.name, 80);
    if (!name) throw bad('Falta el nombre');
    try { res.json({ id: Number(db.prepare('INSERT INTO cities (name) VALUES (?)').run(name).lastInsertRowid) }); }
    catch { throw bad('Esa ciudad ya existe'); }
  });
  admin.patch('/cities/:id', requireSuperAdmin, (req, res) => {
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

  const teamRow = (t) => ({ ...t, city_ids: db.prepare('SELECT city_id FROM team_cities WHERE team_id = ?').all(t.id).map((x) => x.city_id) });
  admin.get('/teams', (_req, res) =>
    res.json(db.prepare('SELECT t.*, p.name AS parent_name FROM teams t LEFT JOIN teams p ON p.id = t.parent_id ORDER BY COALESCE(p.sort, t.sort), COALESCE(p.name, t.name), t.parent_id IS NOT NULL, t.sort, t.name').all().map(teamRow)));

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
  const myCityIds = (userId) => db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(userId).map((x) => x.city_id);
  /**
   * Ciudades donde se puede elegir este equipo. Vacío (sin marcar ninguna) = disponible en todas. El admin
   * total sustituye la lista entera; el de ciudad solo añade o quita SU ciudad, sin tocar las demás.
   */
  function saveTeamCities(id, b, user) {
    const wanted = ids(b.city_ids);
    tx(() => {
      if (user.role === 'city_admin') {
        for (const c of myCityIds(user.id)) {
          if (wanted.includes(c)) db.prepare('INSERT OR IGNORE INTO team_cities VALUES (?,?)').run(id, c);
          else db.prepare('DELETE FROM team_cities WHERE team_id = ? AND city_id = ?').run(id, c);
        }
        return;
      }
      db.exec(`DELETE FROM team_cities WHERE team_id = ${id}`);
      for (const c of wanted) db.prepare('INSERT OR IGNORE INTO team_cities VALUES (?,?)').run(id, c);
    });
  }
  admin.post('/teams', (req, res) => {
    const b = req.body || {};
    const f = teamFields(b);
    if (!f[0]) throw bad('Falta el nombre');
    if (!validImageUrl(f[3])) throw bad('La imagen debe ser una URL https o una imagen subida');
    const parent = parentOf(b, null);
    let id;
    try { id = Number(db.prepare('INSERT INTO teams (name,description,icon,image_url,min_months,notice,active,sort,image_pos,parent_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...f, parent).lastInsertRowid); }
    catch { throw bad('Ya existe un equipo con ese nombre en esa área'); }
    saveTeamCities(id, b, req.user);
    res.json({ id });
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
    saveTeamCities(id, b, req.user);
    res.json({ ok: true });
  });
  /**
   * Borra un equipo (y, si es un área, sus subequipos en cascada). No deja borrar uno con solicitudes: hay que
   * ocultarlo o borrarlas antes. El admin de ciudad solo puede borrar equipos exclusivos de su ciudad (no los
   * disponibles en todas o compartidos con otra ciudad, para no afectar a quien no es de la suya).
   */
  admin.delete('/teams/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id)) throw bad('No encontrado', 404);
    if (req.user.role === 'city_admin') {
      const cityIds = db.prepare('SELECT city_id FROM team_cities WHERE team_id = ?').all(id).map((x) => x.city_id);
      const mine = myCityIds(req.user.id);
      if (!cityIds.length || cityIds.some((c) => !mine.includes(c))) throw bad('Solo puedes borrar equipos exclusivos de tu ciudad', 403);
    }
    try { db.prepare('DELETE FROM teams WHERE id = ?').run(id); }
    catch { throw bad('No se puede borrar: tiene solicitudes registradas (o las tiene algún subequipo suyo). Oculta el equipo en vez de borrarlo, o borra antes esas solicitudes.'); }
    res.json({ ok: true });
  });

  // ---------- Emails: un texto por ciudad, y horario del resumen (global) ----------
  const tplView = (key, cityId) => {
    const t = et.getTemplate(key, cityId);
    const def = et.TEMPLATES[key];
    return {
      key, group: def.group, title: def.title, to: def.to, when: def.when.replace('%HORARIO%', jobs.describeSchedule()), enabled: t.enabled, customized: t.customized, updated_at: t.updated_at || null, updated_by: t.updated_by || '',
      subject: t.subject, heading: t.heading, body: t.body, original: { subject: def.subject, heading: def.heading, body: def.body },
      vars: def.vars.map((n) => ({ name: n, desc: et.VARS[n].desc, block: !!et.VARS[n].block })),
      flags: def.flags.map((n) => ({ name: n, desc: et.FLAGS[n] })), required: def.required,
    };
  };
  const tplOr404 = (key) => { if (!et.TEMPLATES[key]) throw bad('Email no encontrado', 404); return key; };
  const fields = (b) => ({ subject: str(b.subject, 400), heading: str(b.heading, 300), body: typeof b.body === 'string' ? b.body.replace(/\r\n/g, '\n').slice(0, 9000).trim() : '' });
  /** Qué ciudad se está editando: el admin total puede elegir cualquiera; el de ciudad, solo la suya. Viaja en `?city_id=`. */
  function resolveCityId(req) {
    const cityId = Number(req.query.city_id);
    if (!Number.isInteger(cityId) || cityId <= 0) throw bad('Falta la ciudad');
    if (req.user.role !== 'admin' && !myCityIds(req.user.id).includes(cityId)) throw bad('No tienes acceso a esa ciudad', 403);
    if (!db.prepare('SELECT 1 FROM cities WHERE id = ?').get(cityId)) throw bad('Ciudad no encontrada', 404);
    return cityId;
  }

  const scheduleView = () => ({ slots: jobs.digestSchedule(), tz: config.tz });
  admin.get('/emails', (req, res) => {
    const allCities = db.prepare('SELECT * FROM cities ORDER BY name').all();
    const cities = req.user.role === 'admin' ? allCities : allCities.filter((c) => myCityIds(req.user.id).includes(c.id));
    if (!cities.length) throw bad('No tienes ninguna ciudad asignada');
    const reqId = Number(req.query.city_id);
    const cityId = cities.some((c) => c.id === reqId) ? reqId : cities[0].id;
    res.json({ groups: et.GROUPS, templates: Object.keys(et.TEMPLATES).map((k) => tplView(k, cityId)), schedule: scheduleView(), cities, city_id: cityId });
  });

  admin.put('/emails/:key', (req, res) => {
    const key = tplOr404(req.params.key);
    const cityId = resolveCityId(req);
    const f = fields(req.body || {});
    const errors = et.validate(key, f);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    const enabled = req.body?.enabled === false ? 0 : 1;
    db.prepare(`INSERT INTO email_templates (key, city_id, subject, heading, body, enabled, updated_at, updated_by) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
                ON CONFLICT(key, city_id) DO UPDATE SET subject=excluded.subject, heading=excluded.heading, body=excluded.body, enabled=excluded.enabled, updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
      .run(key, cityId, f.subject, f.heading, f.body, enabled, req.user.email);
    console.log(`Email "${key}" (ciudad ${cityId}) editado por ${req.user.email}`);
    res.json(tplView(key, cityId));
  });

  admin.delete('/emails/:key', (req, res) => {
    const key = tplOr404(req.params.key);
    const cityId = resolveCityId(req);
    db.prepare('DELETE FROM email_templates WHERE key = ? AND city_id = ?').run(key, cityId);
    res.json(tplView(key, cityId));
  });

  /** Vista previa con datos de ejemplo. Se abre en un iframe: se responde como documento propio con su CSP (los emails llevan estilos en línea). */
  admin.post('/emails/:key/preview', express.urlencoded({ extended: false, limit: '60kb' }), (req, res) => {
    const key = tplOr404(req.params.key);
    const cityId = resolveCityId(req);
    const f = fields(req.body || {});
    const errors = et.validate(key, f);
    const page = (inner) => `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:system-ui,sans-serif;background:#e5e7eb">${inner}</body>`;
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store');
    if (errors.length) return res.type('html').send(page(`<div style="padding:16px;color:#991b1b;background:#fee2e2"><b>No se puede previsualizar:</b><ul>${errors.map((e) => `<li>${et.esc(e)}</li>`).join('')}</ul></div>`));
    const m = et.render(key, et.sampleContext(key), f, cityId);
    res.type('html').send(page(`<div style="padding:10px 16px;background:#111;color:#fff;font-size:13px"><b>Asunto:</b> ${et.esc(m.subject)}</div>${m.html}`));
  });

  /** Envía la plantilla (con datos de ejemplo) al email del propio administrador. */
  admin.post('/emails/:key/test', wrap(async (req, res) => {
    const key = tplOr404(req.params.key);
    const cityId = resolveCityId(req);
    const f = fields(req.body || {});
    const errors = et.validate(key, f);
    if (errors.length) throw bad(errors.join(' '));
    const m = et.render(key, et.sampleContext(key), f, cityId);
    const out = await mail.sendMail({ to: req.user.email, subject: `[PRUEBA] ${m.subject}`, html: m.html, text: m.text });
    res.json({ ok: true, to: req.user.email, sent: !!out.sent });
  }));

  // El horario de los resúmenes es global (no por ciudad): solo lo cambia el administrador total.
  admin.put('/email-schedule', requireSuperAdmin, (req, res) => {
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

  const userRow = (u) => ({ ...u, city_ids: db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(u.id).map((x) => x.city_id) });
  // Qué roles puede asignar quien gestiona líderes: el admin total también puede dar de alta a otros admin de ciudad.
  const assignableRolesFor = (user) => (user.role === 'admin' ? ['city_admin', 'leader', 'bases', 'gc'] : ['leader', 'bases', 'gc']);
  admin.get('/users', (req, res) => {
    const rows = db.prepare('SELECT id,email,name,role,phone,active FROM users ORDER BY name, email').all().map(userRow);
    if (req.user.role === 'admin') return res.json(rows);
    const mine = myCityIds(req.user.id);
    res.json(rows.filter((u) => !['admin', 'city_admin'].includes(u.role) && u.city_ids.some((c) => mine.includes(c))));
  });
  // Ciudades donde actúa cada uno. El admin de ciudad solo puede asignar las suyas (las demás se descartan).
  function saveUser(id, b, actingUser) {
    let wanted = ids(b.city_ids);
    if (actingUser.role === 'city_admin') wanted = wanted.filter((c) => myCityIds(actingUser.id).includes(c));
    tx(() => {
      db.exec(`DELETE FROM user_cities WHERE user_id = ${id}`);
      for (const c of wanted) db.prepare('INSERT OR IGNORE INTO user_cities VALUES (?,?)').run(id, c);
    });
  }
  admin.post('/users', (req, res) => {
    const b = req.body || {};
    const email = str(b.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email no válido');
    const allowedRoles = assignableRolesFor(req.user);
    const role = allowedRoles.includes(b.role) ? b.role : 'leader';
    let id;
    const phone = phoneOf(b.phone);
    try { id = Number(db.prepare('INSERT INTO users (email,name,role,phone) VALUES (?,?,?,?)').run(email, str(b.name, 100), role, phone).lastInsertRowid); }
    catch { throw bad('Ese email ya existe'); }
    saveUser(id, b, req.user);
    res.json({ id });
  });
  admin.put('/users/:id', (req, res) => {
    const b = req.body || {};
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw bad('No encontrado', 404);
    if (id === req.user.id && b.active === false) throw bad('No puedes desactivarte a ti mismo');
    if (u.role === 'admin') throw bad('Los administradores no se gestionan aquí');
    if (req.user.role === 'city_admin') {
      if (u.role === 'city_admin') throw bad('No puedes gestionar a otros administradores de ciudad', 403);
      const uCities = db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(id).map((x) => x.city_id);
      if (!uCities.some((c) => myCityIds(req.user.id).includes(c))) throw bad('No encontrado', 404);
    }
    const email = b.email === undefined ? u.email : str(b.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email no válido');
    const allowedRoles = assignableRolesFor(req.user);
    const role = allowedRoles.includes(b.role) ? b.role : (allowedRoles.includes(u.role) ? u.role : 'leader');
    try { db.prepare('UPDATE users SET email=?, name=?, role=?, phone=?, active=? WHERE id=?').run(email, str(b.name, 100), role, phoneOf(b.phone), flag(b.active ?? 1), id); }
    catch { throw bad('Ese email ya existe'); }
    saveUser(id, b, req.user);
    res.json({ ok: true });
  });
  admin.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw bad('No puedes eliminarte a ti mismo');
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!u) throw bad('No encontrado', 404);
    if (u.role === 'admin') throw bad('No se puede borrar a un administrador desde aquí');
    if (req.user.role === 'city_admin') {
      if (u.role === 'city_admin') throw bad('No puedes gestionar a otros administradores de ciudad', 403);
      const uCities = db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(id).map((x) => x.city_id);
      if (!uCities.some((c) => myCityIds(req.user.id).includes(c))) throw bad('No encontrado', 404);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  r.use('/admin', admin);
  return r;
};
