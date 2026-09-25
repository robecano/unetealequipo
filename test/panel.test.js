const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-pn-')), 'test.db');
process.env.SESSION_SECRET = 'w'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';

const { db } = require('../src/db');
const jobs = require('../src/jobs');
const { app } = require('../server');

let server, base;
const cookies = {};
const J = { 'Content-Type': 'application/json' };
const req = (who, method, url, body) => fetch(base + url, { method, headers: { ...J, ...(cookies[who] ? { Cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (who, email, password) => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `login ${email}`);
  cookies[who] = r.headers.get('set-cookie').split(';')[0];
};

let city, other, teamA, teamB, leaderId;
const apply = (name, teamId, extra = {}) => {
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc,self_bases2) VALUES (?,?,?,?,?,24,?,?,?,?,?,?)`)
    .run(name, `${name.toLowerCase().replace(/\W/g, '')}@x.es`, extra.phone ?? '+34 600 111 222', extra.city ?? city, teamId, extra.status ?? 'listo',
      extra.pco === undefined ? '55' : extra.pco, extra.pcoBases1 ?? 1, extra.pcoBases2 ?? 1, extra.pcoGc ?? 1, extra.selfBases2 ?? 0).lastInsertRowid);
  db.prepare("INSERT INTO application_events (application_id, event) VALUES (?, 'recibida')").run(id);
  return id;
};

test.before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await login('admin', 'admin@test.es', 'admin-pass');
  city = Number(db.prepare("INSERT INTO cities (name) VALUES ('Madrid')").run().lastInsertRowid);
  other = Number(db.prepare("INSERT INTO cities (name) VALUES ('Valencia')").run().lastInsertRowid);
  teamA = Number(db.prepare("INSERT INTO teams (name) VALUES ('Alabanza')").run().lastInsertRowid);
  teamB = Number(db.prepare("INSERT INTO teams (name) VALUES ('Cafetería')").run().lastInsertRowid);
  const r = await req('admin', 'POST', '/api/panel/admin/users', { email: 'lider@test.es', name: 'Lía Líder', phone: '+34 611 222 333', city_ids: [city], team_ids: [teamA] });
  leaderId = (await r.json()).id;
  await login('leader', 'lider@test.es', 'HillsongEspana');
});
test.after(() => server.close());

test('el admin da de alta a un líder (rol forzado a «leader»); el teléfono se guarda, se edita y se lista', async () => {
  const list = await (await req('admin', 'GET', '/api/panel/admin/users')).json();
  const lia = list.find((u) => u.email === 'lider@test.es');
  assert.equal(lia.phone, '+34 611 222 333');
  assert.equal(lia.role, 'leader');
  const r = await req('admin', 'PUT', `/api/panel/admin/users/${leaderId}`, { name: 'Lía Líder', phone: '699 000 111', active: true, city_ids: [city], team_ids: [teamA] });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT phone FROM users WHERE id = ?').get(leaderId).phone, '699 000 111');
  // se pase o no un role en el body, siempre se crea como «leader»
  const r2 = await req('admin', 'POST', '/api/panel/admin/users', { email: 'otro-lider@test.es', name: 'Otro', role: 'admin', phone: '', city_ids: [city] });
  assert.equal(r2.status, 200);
  assert.equal(db.prepare("SELECT role FROM users WHERE email = 'otro-lider@test.es'").get().role, 'leader');
});

test('un teléfono inválido se rechaza y uno vacío es válido', async () => {
  assert.equal((await req('admin', 'POST', '/api/panel/admin/users', { email: 'x1@test.es', phone: 'hola' })).status, 400);
  assert.equal((await req('admin', 'POST', '/api/panel/admin/users', { email: 'x2@test.es', phone: '123' })).status, 400);
  assert.equal((await req('admin', 'POST', '/api/panel/admin/users', { email: 'x3@test.es', phone: '' })).status, 200);
});

test('el admin puede editar y borrar líderes; nadie puede borrar a un administrador ni desactivarse/eliminarse a sí mismo', async () => {
  const r = await req('admin', 'POST', '/api/panel/admin/users', { email: 'borrar-me@test.es', name: 'Para Borrar', phone: '', city_ids: [city] });
  const id = (await r.json()).id;
  assert.equal((await req('admin', 'DELETE', `/api/panel/admin/users/${id}`)).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(id), undefined);
  const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@test.es'").get();
  assert.equal((await req('admin', 'DELETE', `/api/panel/admin/users/${admin.id}`)).status, 400);
  assert.equal((await req('admin', 'PUT', `/api/panel/admin/users/${admin.id}`, { active: false })).status, 400);
  assert.equal((await req('leader', 'GET', '/api/panel/admin/users')).status, 403, 'un líder no accede a la gestión de usuarios');
});

test('el admin puede cambiar el email de un líder; se valida el formato y que no choque con otro', async () => {
  const r = await req('admin', 'POST', '/api/panel/admin/users', { email: 'cambia-email@test.es', name: 'Cambia Email', phone: '', city_ids: [city] });
  const id = (await r.json()).id;
  assert.equal((await req('admin', 'PUT', `/api/panel/admin/users/${id}`, { name: 'Cambia Email', email: 'no-es-un-email', phone: '', active: true })).status, 400);
  assert.equal((await req('admin', 'PUT', `/api/panel/admin/users/${id}`, { name: 'Cambia Email', email: 'lider@test.es', phone: '', active: true })).status, 400, 'ya lo usa otro usuario');
  const ok = await req('admin', 'PUT', `/api/panel/admin/users/${id}`, { name: 'Cambia Email', email: 'email-nuevo@test.es', phone: '', active: true });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get(id).email, 'email-nuevo@test.es');
  // puede entrar con el email nuevo
  const login = await fetch(base + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ email: 'email-nuevo@test.es', password: 'HillsongEspana' }) });
  assert.equal(login.status, 200);
});

test('cada solicitud lleva «Contrastado con PCO»: sin ficha, con mezcla y todo bien', async () => {
  const sinFicha = apply('Sin Ficha', teamA, { pco: null, pcoBases1: null, pcoBases2: null, pcoGc: null });
  const mezcla = apply('Con Mezcla', teamA, { selfBases2: 1, pcoBases2: 0 });
  const todoBien = apply('Todo Bien', teamA);
  const rows = await (await req('admin', 'GET', '/api/panel/applications')).json();
  const byName = (n) => rows.find((r) => r.name === n);
  assert.equal(byName('Sin Ficha').contrastado.ok, false);
  assert.equal(byName('Sin Ficha').contrastado.reason, 'sin_ficha');
  assert.equal(byName('Con Mezcla').contrastado.ok, false);
  assert.equal(byName('Con Mezcla').contrastado.reason, 'mismatch');
  assert.equal(byName('Todo Bien').contrastado.ok, true);
});

test('borrar: el admin puede, y seguimiento de Equipos dentro de su ciudad (de cualquier equipo); se puede deshacer', async () => {
  const mine = apply('Mia Propia', teamA);
  const mismaCiudadOtroEquipo = apply('Misma Ciudad Otro Equipo', teamB);
  const otraCiudad = apply('Otra Ciudad', teamA, { city: other });
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${otraCiudad}`)).status, 404, 'otra ciudad: no se ve');
  assert.ok(db.prepare('SELECT 1 FROM applications WHERE id = ?').get(otraCiudad));
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${mismaCiudadOtroEquipo}`)).status, 200, 'misma ciudad, otro equipo: sí se ve');
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${mine}`)).status, 200);
  // Borrado blando: la fila sigue ahí (con su historial intacto) pero deja de verse en el panel.
  assert.ok(db.prepare('SELECT deleted_at FROM applications WHERE id = ?').get(mine).deleted_at, 'queda marcada, no se borra de verdad');
  assert.ok(!(await (await req('leader', 'GET', '/api/panel/applications')).json()).some((a) => a.id === mine), 'ya no se ve en el panel');
  assert.ok(db.prepare('SELECT COUNT(*) n FROM application_events WHERE application_id = ?').get(mine).n > 0, 'el historial NO se borra: hace falta para poder deshacer');
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${mine}`)).status, 404, 'ya está borrada, no se puede borrar otra vez');
  // Deshacer: la recupera.
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${mine}/restore`)).status, 200);
  assert.equal(db.prepare('SELECT deleted_at FROM applications WHERE id = ?').get(mine).deleted_at, null);
  assert.ok((await (await req('leader', 'GET', '/api/panel/applications')).json()).some((a) => a.id === mine), 'restaurada, vuelve a verse');
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${mine}/restore`)).status, 404, 'ya no está borrada, no hay nada que restaurar');

  assert.equal((await req('admin', 'DELETE', `/api/panel/applications/${otraCiudad}`)).status, 200);
  assert.equal((await req('admin', 'DELETE', `/api/panel/applications/${otraCiudad}`)).status, 404, 'ya no existe');
  const sinSesion = await fetch(base + `/api/panel/applications/${otraCiudad}`, { method: 'DELETE' });
  assert.equal(sinSesion.status, 401);
});

test('«Actualizar Planning Center»: respeta el mismo ámbito que ver la solicitud (canTouch); sin PCO configurado en las pruebas, no rompe el servidor', async () => {
  const mine = apply('Para Actualizar', teamA);
  const otraCiudad = apply('Otra Ciudad Actualizar', teamA, { city: other });
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${otraCiudad}/refresh-pco`)).status, 404, 'otra ciudad: no se ve');
  // Sin PCO_APP_ID/PCO_SECRET en las pruebas, la llamada real a Planning Center falla, pero refreshOne se lo traga
  // y lo deja anotado en `error`: el servidor responde 200 en vez de caerse (la comprobación de permisos ya pasó).
  const r = await req('leader', 'POST', `/api/panel/applications/${mine}/refresh-pco`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.application.error, 'el fallo de PCO queda anotado en la solicitud, no se pierde en silencio');
  const sinSesion = await fetch(base + `/api/panel/applications/${mine}/refresh-pco`, { method: 'POST' });
  assert.equal(sinSesion.status, 401);
});

test('deshacer un «Contactar» de Bases/GC, y deshacer un cambio de estado', async () => {
  const cUndo = Number(db.prepare("INSERT INTO cities (name) VALUES ('Deshacer')").run().lastInsertRowid);
  const tUndo = Number(db.prepare("INSERT INTO teams (name) VALUES ('Deshacer equipo')").run().lastInsertRowid);
  const lUndo = Number(db.prepare("INSERT INTO users (email, role) VALUES ('leader-undo@test.es', 'leader')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(lUndo, cUndo);
  const rb = await req('admin', 'POST', '/api/panel/admin/users', { email: 'bases-undo@test.es', name: 'Bea Undo', role: 'bases', phone: '', city_ids: [cUndo] });
  assert.equal(rb.status, 200);
  const rg = await req('admin', 'POST', '/api/panel/admin/users', { email: 'gc-undo@test.es', name: 'Gabi Undo', role: 'gc', phone: '', city_ids: [cUndo] });
  assert.equal(rg.status, 200);
  await login('basesUndo', 'bases-undo@test.es', 'HillsongEspana');
  await login('gcUndo', 'gc-undo@test.es', 'HillsongEspana');
  await login('leaderUndo', 'leader-undo@test.es', 'HillsongEspana');

  const id = apply('Para Deshacer', tUndo, { city: cUndo, pcoBases1: 1, pcoBases2: 0, pcoGc: 0 });
  assert.equal((await req('basesUndo', 'PATCH', `/api/panel/applications/${id}`, { contact: true })).status, 200);
  assert.equal((await req('basesUndo', 'PATCH', `/api/panel/applications/${id}`, { contact: true })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM application_events WHERE application_id=? AND event='contactado_bases'").get(id).n, 2);
  assert.equal((await req('leaderUndo', 'POST', `/api/panel/applications/${id}/undo-contact`)).status, 400, 'Equipos y admin también pueden, pero deben indicar qué contacto (Bases o GC)');
  assert.equal((await req('gcUndo', 'POST', `/api/panel/applications/${id}/undo-contact`)).status, 400, 'GC no tiene ningún contacto propio que deshacer aquí (esto era de Bases)');
  assert.equal((await req('leaderUndo', 'POST', `/api/panel/applications/${id}/undo-contact`, { type: 'gc' })).status, 400, 'tampoco hay contacto de GC que deshacer');
  assert.equal((await req('leaderUndo', 'POST', `/api/panel/applications/${id}/undo-contact`, { type: 'bases' })).status, 200, 'Equipos deshace un contacto de Bases indicando el tipo');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM application_events WHERE application_id=? AND event='contactado_bases'").get(id).n, 1, 'quita solo el más reciente');
  assert.equal((await req('basesUndo', 'POST', `/api/panel/applications/${id}/undo-contact`)).status, 200);
  assert.equal((await req('basesUndo', 'POST', `/api/panel/applications/${id}/undo-contact`)).status, 400, 'no hay más que deshacer');

  assert.equal((await req('leaderUndo', 'PATCH', `/api/panel/applications/${id}`, { status: 'contactado' })).status, 200);
  assert.equal((await req('leaderUndo', 'PATCH', `/api/panel/applications/${id}`, { status: 'visito' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(id).status, 'visito');
  assert.equal((await req('basesUndo', 'POST', `/api/panel/applications/${id}/undo-status`)).status, 403, 'Bases no puede deshacer el estado');
  assert.equal((await req('leaderUndo', 'POST', `/api/panel/applications/${id}/undo-status`)).status, 200);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(id).status, 'contactado', 'vuelve al estado anterior');
  assert.equal((await req('leaderUndo', 'POST', `/api/panel/applications/${id}/undo-status`)).status, 200);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(id).status, 'listo', 'sin más cambios previos, vuelve a "listo"');
  assert.equal((await req('leaderUndo', 'POST', `/api/panel/applications/${id}/undo-status`)).status, 400, 'no hay más que deshacer');
});

test('cambiar de equipo: administración y seguimiento de Equipos pueden, a otro disponible en la misma ciudad; Bases y GC no pueden', async () => {
  const cTeam = Number(db.prepare("INSERT INTO cities (name) VALUES ('Cambiar Equipo')").run().lastInsertRowid);
  const tOrigen = Number(db.prepare("INSERT INTO teams (name) VALUES ('Origen')").run().lastInsertRowid);
  const tDestino = Number(db.prepare("INSERT INTO teams (name) VALUES ('Destino')").run().lastInsertRowid);
  const lTeam = Number(db.prepare("INSERT INTO users (email, role) VALUES ('leader-team@test.es', 'leader')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(lTeam, cTeam);
  await login('leaderTeam', 'leader-team@test.es', 'HillsongEspana');
  const rBasesTeam = await req('admin', 'POST', '/api/panel/admin/users', { email: 'bases-team@test.es', name: 'Bea Team', role: 'bases', phone: '', city_ids: [cTeam] });
  assert.equal(rBasesTeam.status, 200);
  await login('basesTeam', 'bases-team@test.es', 'HillsongEspana');

  const id = apply('Cambia Equipo', tOrigen, { city: cTeam, pcoBases1: 0, pcoBases2: 0 });
  assert.equal((await req('basesTeam', 'PATCH', `/api/panel/applications/${id}`, { team_id: tDestino })).status, 403, 'Bases no puede cambiar el equipo');
  const r = await req('leaderTeam', 'PATCH', `/api/panel/applications/${id}`, { team_id: tDestino });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT team_id FROM applications WHERE id=?').get(id).team_id, tDestino);
  assert.match(db.prepare("SELECT detail FROM application_events WHERE application_id=? AND event='equipo' ORDER BY id DESC LIMIT 1").get(id).detail, /Origen.*Destino/);

  // Un equipo restringido a otra ciudad no es válido para esta solicitud
  const soloOtraCiudad = Number(db.prepare("INSERT INTO teams (name) VALUES ('Solo Valencia')").run().lastInsertRowid);
  db.prepare('INSERT INTO team_cities VALUES (?,?)').run(soloOtraCiudad, other);
  assert.equal((await req('admin', 'PATCH', `/api/panel/applications/${id}`, { team_id: soloOtraCiudad })).status, 400);
  assert.equal(db.prepare('SELECT team_id FROM applications WHERE id=?').get(id).team_id, tDestino, 'no cambia si el equipo no es válido');

  // admin total también puede
  assert.equal((await req('admin', 'PATCH', `/api/panel/applications/${id}`, { team_id: tOrigen })).status, 200);
  assert.equal(db.prepare('SELECT team_id FROM applications WHERE id=?').get(id).team_id, tOrigen);

  // Deshacer el cambio de equipo: vuelve al que tenía justo antes
  assert.equal((await req('basesTeam', 'POST', `/api/panel/applications/${id}/undo-team`)).status, 403, 'Bases no puede deshacer el equipo');
  const rUndoTeam = await req('leaderTeam', 'POST', `/api/panel/applications/${id}/undo-team`);
  assert.equal(rUndoTeam.status, 200);
  assert.equal(db.prepare('SELECT team_id FROM applications WHERE id=?').get(id).team_id, tDestino, 'vuelve al equipo anterior (Destino, antes del último cambio a Origen)');
  assert.equal((await req('admin', 'POST', `/api/panel/applications/${id}/undo-team`)).status, 200, 'deshace también el cambio anterior');
  assert.equal(db.prepare('SELECT team_id FROM applications WHERE id=?').get(id).team_id, tOrigen);
  assert.equal((await req('admin', 'POST', `/api/panel/applications/${id}/undo-team`)).status, 400, 'no hay más cambios de equipo que deshacer');
});

test('deshacer un comentario: mismo permiso que escribirlo (sin restricción de rol, solo hace falta ver la solicitud); el panel ve el último antes de deshacerlo, no a ciegas', async () => {
  const id = apply('Para Comentar', teamA);
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${id}/undo-comment`)).status, 400, 'aún no hay comentarios');
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${id}`, { comment: 'Primer comentario' })).status, 200);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${id}`, { comment: 'Segundo comentario' })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM application_events WHERE application_id=? AND event='comentario'").get(id).n, 2);
  const rows1 = await (await req('leader', 'GET', '/api/panel/applications')).json();
  const row1 = rows1.find((r) => r.id === id);
  assert.equal(row1.comment_count, 2);
  assert.equal(row1.last_comment.text, 'Segundo comentario', 'la lista trae el último comentario, no solo el botón de deshacer a ciegas');
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${id}/undo-comment`)).status, 200);
  const left = db.prepare("SELECT detail FROM application_events WHERE application_id=? AND event='comentario' ORDER BY id DESC LIMIT 1").get(id);
  assert.equal(left.detail, 'Primer comentario', 'quita solo el más reciente');
  const rows2 = await (await req('leader', 'GET', '/api/panel/applications')).json();
  assert.equal(rows2.find((r) => r.id === id).last_comment.text, 'Primer comentario', 'ahora el último es el que quedó');
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${id}/undo-comment`)).status, 200);
  assert.equal((await req('leader', 'POST', `/api/panel/applications/${id}/undo-comment`)).status, 400, 'no hay más que deshacer');
  const rows3 = await (await req('leader', 'GET', '/api/panel/applications')).json();
  assert.equal(rows3.find((r) => r.id === id).last_comment, null, 'sin comentarios, no hay último');
});

/**
 * Planning Center simulado (mismo patrón que test/pco-forms.test.js): sirve para probar contra un servidor real
 * de verdad las tres cosas que dependen de una respuesta de Planning Center que funcione: la nota que se escribe
 * al confirmar (y que se borra si se deshace), el refresco en bloque de toda la lista, y lo que queda en el
 * historial de sincronización.
 */
test('Planning Center: nota al confirmar (se borra si se deshace el "Resolver"), «Actualizar Planning Center» para toda la lista, e historial de sincronización', async () => {
  const config = require('../src/config');
  const saved = { ...config.pco };
  const noteCreates = [];
  const noteDeletes = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let m;
      if (req.method === 'POST' && /^\/people\/v2\/people\/\d+\/notes$/.test(url.pathname)) {
        const id = String(1000 + noteCreates.length);
        noteCreates.push(id);
        return send(200, { data: { type: 'Note', id, attributes: {} } });
      }
      if (req.method === 'DELETE' && (m = url.pathname.match(/^\/people\/v2\/notes\/(\d+)$/))) {
        noteDeletes.push(m[1]);
        return send(204);
      }
      if (url.pathname === '/people/v2/note_categories') return send(200, { data: [{ type: 'NoteCategory', id: '1', attributes: { name: 'Interesado en servir' } }] });
      if (url.pathname === '/people/v2/field_definitions') return send(200, { data: [
        { type: 'FieldDefinition', id: '1', attributes: { name: 'Bases 1' } },
        { type: 'FieldDefinition', id: '2', attributes: { name: 'Bases 2' } },
      ] });
      if (/^\/people\/v2\/people\/\d+\/field_data$/.test(url.pathname)) return send(200, { data: [] });
      if (url.pathname === '/people/v2/forms') return send(200, { data: [] });
      if (/^\/people\/v2\/people\/\d+\/form_submissions$/.test(url.pathname)) return send(200, { data: [] });
      if (url.pathname === '/groups/v2/group_types') return send(200, { data: [] });
      if (/^\/groups\/v2\/people\/\d+\/memberships$/.test(url.pathname)) return send(200, { data: [] });
      send(404, { errors: [{ detail: `No implementado en la prueba: ${req.method} ${url.pathname}` }] });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  Object.assign(config.pco, { base: `http://127.0.0.1:${server.address().port}`, appId: 'test', secret: 'test' });

  try {
    const cityP = Number(db.prepare("INSERT INTO cities (name) VALUES ('Planning Center Test')").run().lastInsertRowid);
    const tP = Number(db.prepare("INSERT INTO teams (name) VALUES ('Equipo PCO')").run().lastInsertRowid);
    const lP = Number(db.prepare("INSERT INTO users (email, role) VALUES ('leader-pco@test.es', 'leader')").run().lastInsertRowid);
    db.prepare('INSERT INTO user_cities VALUES (?,?)').run(lP, cityP);
    await login('leaderPco', 'leader-pco@test.es', 'HillsongEspana');

    const id = apply('Confirmar PCO', tP, { city: cityP });
    assert.equal((await req('leaderPco', 'PATCH', `/api/panel/applications/${id}`, { status: 'confirmado' })).status, 200);
    assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(id).status, 'confirmado');
    const noteEv = db.prepare("SELECT detail FROM application_events WHERE application_id=? AND event='nota_pco' ORDER BY id DESC LIMIT 1").get(id);
    assert.ok(noteEv, 'queda registrada la nota escrita en Planning Center');
    assert.equal(noteCreates.length, 1);
    assert.equal(noteEv.detail, noteCreates[0]);

    // Deshacer el «Resolver» también borra esa nota en Planning Center (y su registro)
    assert.equal((await req('leaderPco', 'POST', `/api/panel/applications/${id}/undo-status`)).status, 200);
    assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(id).status, 'listo');
    assert.deepEqual(noteDeletes, [noteCreates[0]], 'la nota se ha borrado de Planning Center');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM application_events WHERE application_id=? AND event='nota_pco'").get(id).n, 0);

    // «Actualizar Planning Center» para toda la lista: solo lo que está en el ámbito de quien lo pide. Se crea
    // otra solicitud en otra ciudad para comprobar que total=1 (no la cuenta, aunque exista).
    apply('Otra Ciudad Bulk', teamA, { city: other });
    const rBulk = await req('leaderPco', 'POST', '/api/panel/applications/refresh-pco', {});
    assert.equal(rBulk.status, 200);
    const bulkBody = await rBulk.json();
    assert.equal(bulkBody.total, 1, 'solo ve la solicitud de su ciudad');
    assert.equal(bulkBody.refreshed, 1, 'se ha podido refrescar contra el Planning Center simulado');
    assert.equal(db.prepare('SELECT error FROM applications WHERE id=?').get(id).error, null);

    // Otra solicitud que se confirma y NO se deshace: para comprobar que su nota sí queda en el historial (la
    // de `id`, más arriba, se deshizo a propósito, así que su nota_pco ya no existe).
    const id2 = apply('Confirmar PCO Sin Deshacer', tP, { city: cityP });
    assert.equal((await req('leaderPco', 'PATCH', `/api/panel/applications/${id2}`, { status: 'confirmado' })).status, 200);
    assert.equal(noteCreates.length, 2);

    // Historial de sincronizaciones y errores: solo administración, y de ciudad ve solo la suya
    assert.equal((await req('leaderPco', 'GET', '/api/panel/admin/sync-log')).status, 403, 'seguimiento de Equipos no accede al historial de sincronización');
    const rLog = await req('admin', 'GET', '/api/panel/admin/sync-log');
    assert.equal(rLog.status, 200);
    const logRows = await rLog.json();
    assert.ok(logRows.some((e) => e.application_id === id2 && e.event === 'nota_pco'), 'la nota escrita queda en el historial');
    assert.ok(logRows.some((e) => e.event === 'pco_error'), 'los errores de sincronización (de antes, sin Planning Center configurado) también quedan');
  } finally {
    server.close();
    Object.assign(config.pco, saved);
  }
});

test('seguimiento de Equipos puede marcar el estado de cualquier solicitud de su ciudad (de cualquier equipo), pero no la de otra ciudad', async () => {
  const mine = apply('Para Contactar', teamA);
  const otraCiudad = apply('Otra Ciudad Estado', teamA, { city: other });
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${mine}`, { status: 'contactado' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(mine).status, 'contactado');
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${mine}`, { status: 'inventado' })).status, 400);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${otraCiudad}`, { status: 'contactado' })).status, 404);
});

test('CSV: cabeceras de descarga, BOM UTF-8, separador ; y columnas en español', async () => {
  apply('CSV Cabeceras', teamA);
  const r = await req('admin', 'GET', '/api/panel/applications.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv; charset=utf-8/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="solicitudes-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para que Excel lea bien los acentos');
  const [head, ...rows] = bytes.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
  assert.ok(head.startsWith('ID;Fecha;Nombre;Email;Teléfono;Ciudad;Equipo;Estado;'));
  assert.ok(rows.length >= 2);
});

test('CSV: respeta el estado y la búsqueda, y cada rol solo exporta lo suyo', async () => {
  const q = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=CSV%20Cabeceras')).text()).trim().split('\r\n');
  assert.equal(q.length, 2);
  const leader = await (await req('leader', 'GET', '/api/panel/applications.csv')).text();
  assert.ok(!leader.includes('Otra Ciudad'), 'el líder no ve otras ciudades');
  assert.equal((await fetch(base + '/api/panel/applications.csv')).status, 401);
});

test('CSV: comillas, saltos de línea y fórmulas de Excel quedan neutralizados; el teléfono con + se conserva', async () => {
  const id = apply('=HYPERLINK("http://malo.es")', teamA, { phone: '+34 600 999 888' });
  db.prepare("UPDATE applications SET email = 'a;b@x.es' WHERE id = ?").run(id);
  const text = await (await req('admin', 'GET', '/api/panel/applications.csv?q=HYPERLINK')).text();
  const line = text.trim().split('\r\n')[1];
  assert.ok(line.includes(`"'=HYPERLINK(""http://malo.es"")"`), 'la fórmula lleva apóstrofo y las comillas se duplican');
  assert.ok(line.includes('"a;b@x.es"'), 'el separador dentro de un dato se entrecomilla');
  assert.ok(line.includes(';+34 600 999 888;'), 'el teléfono con + no se altera');
});

test('CSV: las fechas salen en hora de España y formato dd/mm/aaaa hh:mm', async () => {
  const id = apply('Fecha Local', teamA);
  db.prepare("UPDATE applications SET created_at = '2026-07-01 22:30:00', updated_at = '2026-01-15T09:05:00.000Z', followup_at = '2026-07-08T09:00:00.000Z' WHERE id = ?").run(id);
  const line = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Fecha')).text()).trim().split('\r\n')[1].split(';');
  assert.equal(line[1], '02/07/2026 00:30', 'verano: UTC+2, cambia de día');
  assert.equal(line[line.length - 2], '08/07/2026');
  assert.equal(line[line.length - 1], '15/01/2026 10:05', 'invierno: UTC+1');
});

test('el orden de las columnas de cursos es B1, GC, B2 en el CSV (como en el panel), y llevan «Verificado en PCO»', async () => {
  const id = apply('Orden Cursos', teamA, { pcoBases1: 1, pcoGc: 0, pcoBases2: 1, selfBases2: 0 });
  db.prepare('UPDATE applications SET self_bases1 = 1, self_gc = 0 WHERE id = ?').run(id);
  const [head, row] = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Orden')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const h = head.split(';'); const v = row.split(';');
  assert.deepEqual(h.slice(9, 21), ['Bases 1 (PCO)', 'GC (PCO)', 'Bases 2 (PCO)', 'Bases 1 (dijo)', 'GC (dijo)', 'Bases 2 (dijo)', 'Ficha Planning Center', 'Grupo de Conexión', 'Formulario Bases 1', 'Formulario Bases 2', 'Formulario GC', 'Seguimiento de Equipos']);
  assert.deepEqual(v.slice(9, 15), ['Sí', 'No', 'Sí', 'Sí', 'No', 'No']);
  const i = h.indexOf('Verificado en PCO');
  assert.ok(i > 0);
  assert.equal(v[i], 'Sí');
  const j = h.indexOf('Recordatorio');
  assert.ok(j > i, 'va después de Verificado en PCO y su motivo');
  assert.match(v[j], /el paso que le falta/, 'le falta GC, aunque esté contrastado');
});

test('el Grupo de Conexión real y los formularios de registro se ven en el JSON y en el CSV', async () => {
  const id = apply('Con Grupo Y Formularios', teamA, { pcoBases1: 1, pcoBases2: 0, pcoGc: 0 });
  db.prepare("UPDATE applications SET gc_group_name = 'Pablo y Carolina', form_bases1 = 1, form_bases2 = 0, form_gc = 1 WHERE id = ?").run(id);
  const rows = await (await req('admin', 'GET', '/api/panel/applications?q=Con%20Grupo')).json();
  const a = rows.find((r) => r.id === id);
  assert.equal(a.gc_group_name, 'Pablo y Carolina');
  assert.equal(a.form_bases1, 1);
  assert.equal(a.form_bases2, 0);
  assert.equal(a.form_gc, 1);
  const [head, row] = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Con%20Grupo')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const h = head.split(';'); const v = row.split(';');
  assert.equal(v[h.indexOf('Grupo de Conexión')], 'Pablo y Carolina');
  assert.equal(v[h.indexOf('Formulario Bases 1')], 'Sí');
  assert.equal(v[h.indexOf('Formulario Bases 2')], 'No');
  assert.equal(v[h.indexOf('Formulario GC')], 'Sí');
});

test('el administrador ve quién hace seguimiento de Equipos de cada persona (y si no hay nadie en su ciudad, se le avisa); seguimiento de Equipos no ve ese dato', async () => {
  const conLider = apply('Con Seguimiento', teamA); // ciudad Madrid: tiene a «Lía Líder»
  const cSinLider = Number(db.prepare("INSERT INTO cities (name) VALUES ('Sin Seguimiento CSV')").run().lastInsertRowid);
  const sinLider = apply('Sin Seguimiento', teamA, { city: cSinLider }); // ciudad nueva, sin nadie asignado
  const rows = await (await req('admin', 'GET', '/api/panel/applications')).json();
  const a = rows.find((r) => r.id === conLider), b = rows.find((r) => r.id === sinLider);
  // Dos personas hacen seguimiento de Equipos en Madrid (Lía y «Otro», de un test anterior): ambas ven esta solicitud, sin importar el equipo
  assert.deepEqual(a.leaders.map((l) => [l.name, l.email]), [['Lía Líder', 'lider@test.es'], ['Otro', 'otro-lider@test.es']]);
  assert.deepEqual(b.leaders, []);
  // un líder desactivado no cuenta
  const otroId = db.prepare("SELECT id FROM users WHERE email = 'otro-lider@test.es'").get().id;
  db.prepare('UPDATE users SET active = 0 WHERE id IN (?, ?)').run(leaderId, otroId);
  assert.deepEqual((await (await req('admin', 'GET', '/api/panel/applications')).json()).find((r) => r.id === conLider).leaders, []);
  db.prepare('UPDATE users SET active = 1 WHERE id IN (?, ?)').run(leaderId, otroId);
  // seguimiento de Equipos no recibe ese dato para sus propias solicitudes
  const propios = await (await req('leader', 'GET', '/api/panel/applications')).json();
  assert.ok(propios.every((r) => r.leaders === undefined));
  // CSV: columna «Seguimiento de Equipos» solo para administración
  const csvAdmin = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Seguimiento')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const head = csvAdmin[0].split(';');
  const i = head.indexOf('Seguimiento de Equipos');
  assert.ok(i > 0);
  const fila = (n) => csvAdmin.slice(1).find((l) => l.includes(n)).split(';');
  assert.equal(fila('Con Seguimiento')[i], 'Lía Líder · 699 000 111 / Otro');
  assert.equal(fila('Sin Seguimiento')[i], 'Sin seguimiento asignado');
  const csvLider = await (await req('leader', 'GET', '/api/panel/applications.csv')).text();
  assert.doesNotMatch(csvLider.split('\r\n')[0], /Seguimiento de Equipos/);
});

let basesId, gcId;
test('el admin da de alta a un líder de Bases y a uno de GC', async () => {
  const rb = await req('admin', 'POST', '/api/panel/admin/users', { email: 'bases@test.es', name: 'Bea Bases', role: 'bases', phone: '', city_ids: [city] });
  assert.equal(rb.status, 200);
  basesId = (await rb.json()).id;
  const rg = await req('admin', 'POST', '/api/panel/admin/users', { email: 'gc@test.es', name: 'Gabi GC', role: 'gc', phone: '', city_ids: [city] });
  assert.equal(rg.status, 200);
  gcId = (await rg.json()).id;
  const list = await (await req('admin', 'GET', '/api/panel/admin/users')).json();
  assert.equal(list.find((u) => u.email === 'bases@test.es').role, 'bases');
  assert.equal(list.find((u) => u.email === 'gc@test.es').role, 'gc');
  await login('bases', 'bases@test.es', 'HillsongEspana');
  await login('gc', 'gc@test.es', 'HillsongEspana');
});

test('el líder de Bases ve solo a quien le falta Bases 1 o Bases 2 en su ciudad (de cualquier equipo); el de GC, a quien ya tiene Bases 1 y le falta GC', async () => {
  const faltaB1 = apply('Falta B1', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0, selfBases2: 0 });
  const faltaB2 = apply('Falta B2', teamB, { pcoBases1: 1, pcoBases2: 0, pcoGc: 1, selfBases2: 0 });
  const faltaGc = apply('Falta GC', teamA, { pcoBases1: 1, pcoBases2: 1, pcoGc: 0, selfBases2: 0 });
  const todoHecho = apply('Todo Hecho Roles', teamB, { pcoBases1: 1, pcoBases2: 1, pcoGc: 1, selfBases2: 0 });

  const basesRows = await (await req('bases', 'GET', '/api/panel/applications')).json();
  const basesNames = basesRows.map((r) => r.name);
  assert.ok(basesNames.includes('Falta B1'));
  assert.ok(basesNames.includes('Falta B2'));
  assert.ok(!basesNames.includes('Falta GC') && !basesNames.includes('Todo Hecho Roles'));

  const gcRows = await (await req('gc', 'GET', '/api/panel/applications')).json();
  const gcNames = gcRows.map((r) => r.name);
  assert.ok(gcNames.includes('Falta GC'));
  assert.ok(!gcNames.includes('Falta B1'), 'sin Bases 1 todavía no le toca a GC');
  assert.ok(!gcNames.includes('Falta B2') && !gcNames.includes('Todo Hecho Roles'));

  // ninguno de los dos ve solicitudes de otras ciudades
  const otraCiudadBases = apply('Otra Ciudad Bases', teamA, { city: other, pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  assert.ok(!(await (await req('bases', 'GET', '/api/panel/applications')).json()).some((r) => r.id === otraCiudadBases));
});

test('Bases y GC también ven a quien lo autodeclaró pero Planning Center no lo confirma, con el aviso de actualizar PCO', async () => {
  // Dice tener Bases 1, pero Planning Center no lo confirma: le sigue tocando a Bases (mismatch, no «pendiente de verdad»)
  const mismatchB1 = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,self_bases1,pco_bases2,pco_gc)
    VALUES ('Dice B1','diceb1@x.es','+34 600 111 222',?,?,24,'listo','55',0,1,1,1)`).run(city, teamA).lastInsertRowid);
  const basesRows = await (await req('bases', 'GET', '/api/panel/applications')).json();
  const row = basesRows.find((r) => r.id === mismatchB1);
  assert.ok(row, 'le toca a Bases aunque lo haya autodeclarado, porque PCO no lo confirma');
  assert.deepEqual(row.basesGaps, [{ key: 'bases1', label: 'Bases 1', mismatch: true }]);

  // Dice estar en un GC, pero Planning Center no lo confirma: le sigue tocando a GC
  const mismatchGc = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc,self_gc)
    VALUES ('Dice GC','dicegc@x.es','+34 600 111 222',?,?,24,'listo','55',1,1,0,1)`).run(city, teamA).lastInsertRowid);
  const gcRows = await (await req('gc', 'GET', '/api/panel/applications')).json();
  const rowGc = gcRows.find((r) => r.id === mismatchGc);
  assert.ok(rowGc, 'le toca a GC aunque lo haya autodeclarado, porque PCO no lo confirma');
  assert.deepEqual(rowGc.gcGaps, [{ key: 'gc', label: 'GC', mismatch: true }]);

  // El líder de equipo (que ve a todos) recibe la misma información estructurada
  const leaderRows = await (await req('leader', 'GET', '/api/panel/applications')).json();
  assert.deepEqual(leaderRows.find((r) => r.id === mismatchB1).basesGaps, [{ key: 'bases1', label: 'Bases 1', mismatch: true }]);
});

test('filtro de categoría (falta Bases 1/2/GC, completo): filtra el panel y el CSV, para cualquier rol', async () => {
  const c5 = Number(db.prepare("INSERT INTO cities (name) VALUES ('Categorías')").run().lastInsertRowid);
  const faltaB1 = apply('Cat Falta B1', teamA, { city: c5, pcoBases1: 0, pcoBases2: 1, pcoGc: 1 });
  const faltaB2 = apply('Cat Falta B2', teamA, { city: c5, pcoBases1: 1, pcoBases2: 0, pcoGc: 1 });
  const faltaGc = apply('Cat Falta GC', teamA, { city: c5, pcoBases1: 1, pcoBases2: 1, pcoGc: 0 });
  const completo = apply('Cat Completo', teamA, { city: c5, pcoBases1: 1, pcoBases2: 1, pcoGc: 1 });

  const byCategory = async (category) => (await (await req('admin', 'GET', `/api/panel/applications?category=${category}&q=Cat`)).json()).map((r) => r.name);
  assert.deepEqual(await byCategory('falta_bases1'), ['Cat Falta B1']);
  assert.deepEqual(await byCategory('falta_bases2'), ['Cat Falta B2']);
  assert.deepEqual(await byCategory('falta_gc'), ['Cat Falta GC']);
  assert.deepEqual(await byCategory('completo'), ['Cat Completo']);
  assert.equal((await byCategory('')).length, 4, 'sin categoría: los cuatro');

  const csv = await (await req('admin', 'GET', '/api/panel/applications.csv?category=completo&q=Cat')).text();
  assert.match(csv, /Cat Completo/);
  assert.doesNotMatch(csv, /Cat Falta/);
});

test('Bases y GC no pueden cambiar el estado ni borrar (solo el líder de equipo y admin); comentar sí les deja', async () => {
  const id = apply('Toca Bases', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${id}`, { status: 'contactado' })).status, 403);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'listo', 'no cambió');
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${id}`, { comment: 'La llamé, dice que ya se apuntó' })).status, 200);
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'comentario'").get(id));
  assert.equal((await req('bases', 'DELETE', `/api/panel/applications/${id}`)).status, 403);
  assert.ok(db.prepare('SELECT 1 FROM applications WHERE id = ?').get(id), 'sigue existiendo');
});

test('Bases y GC marcan que han contactado (cada pulsación añade un contacto); admin y seguimiento de Equipos también pueden, indicando de cuál se trata', async () => {
  const id = apply('Marcar Contacto', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  const before = (await (await req('leader', 'GET', '/api/panel/applications')).json()).find((x) => x.id === id);
  assert.equal(before.bases_contact_count, 0);
  assert.equal(before.bases_last_contact, null);
  const r = await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contact: true });
  assert.equal(r.status, 200);
  // seguimiento de Equipos (y admin) lo ven en su lista, sin haber hecho nada
  const after1 = (await (await req('leader', 'GET', '/api/panel/applications')).json()).find((x) => x.id === id);
  assert.equal(after1.bases_contact_count, 1);
  assert.ok(after1.bases_last_contact);
  // admin y seguimiento de Equipos ahora también pueden marcarlo por Bases o GC, pero deben indicar cuál (no basta con `true`)
  assert.equal((await req('admin', 'PATCH', `/api/panel/applications/${id}`, { contact: true })).status, 400);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${id}`, { contact: true })).status, 400);
  assert.equal((await req('admin', 'PATCH', `/api/panel/applications/${id}`, { contact: 'gc' })).status, 200);
  const afterAdmin = (await (await req('leader', 'GET', '/api/panel/applications')).json()).find((x) => x.id === id);
  assert.equal(afterAdmin.gc_contact_count, 1, 'el contacto de GC marcado por admin también cuenta');
  // cada pulsación añade un contacto nuevo: no hay «deshacer» sin más (hace falta el botón de deshacer)
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contact: true });
  const after2 = (await (await req('leader', 'GET', '/api/panel/applications')).json()).find((x) => x.id === id);
  assert.equal(after2.bases_contact_count, 2);
});

test('CSV: columnas «Seguimiento de Bases» y «Seguimiento de GC», solo para admin, con «Sin seguimiento asignado» si no hay', async () => {
  const id = apply('Con Ambos Roles', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  const csvAdmin = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Con%20Ambos%20Roles')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const head = csvAdmin[0].split(';');
  const iBases = head.indexOf('Seguimiento de Bases'), iGc = head.indexOf('Seguimiento de GC');
  assert.ok(iBases > 0 && iGc > 0);
  const fila = csvAdmin[1].split(';');
  assert.equal(fila[iBases], 'Bea Bases');
  assert.equal(fila[iGc], '', 'no le toca a GC (sin Bases 1), así que va vacío');
  const csvLider = await (await req('leader', 'GET', '/api/panel/applications.csv')).text();
  assert.doesNotMatch(csvLider.split('\r\n')[0], /Seguimiento de Bases|Seguimiento de GC/);

  // Veces contactada / fechas de contacto: visibles para todos (también seguimiento de Equipos)
  const iVecesBases = head.indexOf('Bases: veces contactada'), iUltimoBases = head.indexOf('Bases: fechas de contacto');
  assert.ok(iVecesBases > 0 && iUltimoBases > 0);
  assert.equal(fila[iVecesBases], '0');
  assert.equal(fila[iUltimoBases], '');
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contact: true });
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contact: true });
  const filaLuego = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Con%20Ambos%20Roles')).text()).replace(/^﻿/, '').trim().split('\r\n')[1].split(';');
  assert.equal(filaLuego[iVecesBases], '2');
  assert.match(filaLuego[iUltimoBases], /^\d{2}\/\d{2}\/\d{4}.* \/ \d{2}\/\d{2}\/\d{4}/, 'lleva TODAS las fechas, separadas, no solo la última');
  const csvLiderLuego = (await (await req('leader', 'GET', '/api/panel/applications.csv?q=Con%20Ambos%20Roles')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const headLider = csvLiderLuego[0].split(';');
  assert.equal(csvLiderLuego[1].split(';')[headLider.indexOf('Bases: veces contactada')], '2', 'seguimiento de Equipos también lo ve, sin la columna de seguimiento asignado');
});

let cityAdminId;
test('admin de ciudad: ve y gestiona solo su ciudad (usuarios), y no puede tocar ciudades ni el horario global', async () => {
  const r = await req('admin', 'POST', '/api/panel/admin/users', { email: 'cityadmin@test.es', name: 'Ana Admin', role: 'city_admin', phone: '', city_ids: [city] });
  assert.equal(r.status, 200);
  cityAdminId = (await r.json()).id;
  await login('cityadmin', 'cityadmin@test.es', 'HillsongEspana');

  // Ciudades: puede ver, no puede crear ni editar
  assert.equal((await req('cityadmin', 'GET', '/api/panel/admin/cities')).status, 200);
  assert.equal((await req('cityadmin', 'POST', '/api/panel/admin/cities', { name: 'Nueva' })).status, 403);
  assert.equal((await req('cityadmin', 'PATCH', `/api/panel/admin/cities/${other}`, { active: false })).status, 403);

  // Usuarios: solo ve los de su ciudad (nunca admin total ni otros admin de ciudad)
  const users = await (await req('cityadmin', 'GET', '/api/panel/admin/users')).json();
  assert.ok(users.every((u) => !['admin', 'city_admin'].includes(u.role)));
  assert.ok(users.some((u) => u.email === 'lider@test.es'), 've a los de su ciudad');

  // No puede darse (ni dar) el rol de admin de ciudad o admin total: se degrada a leader
  const rEscalada = await req('cityadmin', 'POST', '/api/panel/admin/users', { email: 'intenta-admin@test.es', name: 'Intenta', role: 'city_admin', phone: '', city_ids: [city] });
  assert.equal(rEscalada.status, 200);
  assert.equal(db.prepare("SELECT role FROM users WHERE email = 'intenta-admin@test.es'").get().role, 'leader');

  // Puede dar de alta a Bases/GC/Equipos, pero solo en su propia ciudad aunque mande otras
  const rNuevoBases = await req('cityadmin', 'POST', '/api/panel/admin/users', { email: 'bases-cityadmin@test.es', name: 'Basi', role: 'bases', phone: '', city_ids: [city, other] });
  assert.equal(rNuevoBases.status, 200);
  const nuevoBasesId = (await rNuevoBases.json()).id;
  assert.deepEqual(db.prepare('SELECT city_id FROM user_cities WHERE user_id = ?').all(nuevoBasesId).map((x) => x.city_id), [city], 'Valencia se descarta: no es su ciudad');

  // Puede editar a alguien de su ciudad, pero no gestionar a otro admin de ciudad
  assert.equal((await req('cityadmin', 'PUT', `/api/panel/admin/users/${leaderId}`, { name: 'Lía Líder', email: 'lider@test.es', phone: '699 000 111', active: true, city_ids: [city] })).status, 200);
});

test('admin de ciudad: en equipos solo puede cambiar su ciudad (las demás quedan igual); en emails y horario solo ve/edita la suya', async () => {
  const rCreate = await req('admin', 'POST', '/api/panel/admin/teams', { name: 'Equipo Multi Ciudad', city_ids: [city, other] });
  assert.equal(rCreate.status, 200);
  const teamId = (await rCreate.json()).id;

  // El admin de ciudad cambia el nombre y manda city_ids vacío: solo se le quita SU ciudad, Valencia queda intacta
  const rEdit = await req('cityadmin', 'PUT', `/api/panel/admin/teams/${teamId}`, { name: 'Equipo Multi Ciudad Editado', city_ids: [] });
  assert.equal(rEdit.status, 200);
  const teams = await (await req('admin', 'GET', '/api/panel/admin/teams')).json();
  const t = teams.find((x) => x.id === teamId);
  assert.equal(t.name, 'Equipo Multi Ciudad Editado', 'puede cambiar cualquier campo del equipo');
  assert.deepEqual(t.city_ids, [other], 'solo se ha quitado su ciudad; Valencia sigue');

  // No puede borrar un equipo que no es exclusivo de su ciudad
  assert.equal((await req('cityadmin', 'DELETE', `/api/panel/admin/teams/${teamId}`)).status, 403, 'restringido a Valencia: no es la suya');
  await req('admin', 'PUT', `/api/panel/admin/teams/${teamId}`, { name: 'Equipo Multi Ciudad Editado', city_ids: [city] });
  assert.equal((await req('cityadmin', 'DELETE', `/api/panel/admin/teams/${teamId}`)).status, 200, 'ahora es exclusivo de su ciudad: sí puede');

  // Emails: solo ve y edita el texto de su ciudad
  const data = await (await req('cityadmin', 'GET', '/api/panel/admin/emails')).json();
  assert.deepEqual(data.cities.map((c) => c.id), [city]);
  assert.equal(data.city_id, city);
  const goodBody = { subject: 'X {{ciudad}}', heading: 'H', body: '{{seccion_nuevas}}\n\n{{seccion_seguimiento}}\n\n{{seccion_resto}}', enabled: true };
  assert.equal((await req('cityadmin', 'PUT', `/api/panel/admin/emails/leader_digest?city_id=${city}`, goodBody)).status, 200);
  assert.equal((await req('cityadmin', 'PUT', `/api/panel/admin/emails/leader_digest?city_id=${other}`, goodBody)).status, 403, 'no puede editar el email de otra ciudad');
  await req('admin', 'DELETE', `/api/panel/admin/emails/leader_digest?city_id=${city}`); // limpieza

  // El horario de los resúmenes también es por ciudad: el admin de ciudad edita el suyo, no el de otra
  assert.equal((await req('cityadmin', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 1, hour: 9 }] })).status, 400, 'falta indicar la ciudad');
  assert.equal((await req('cityadmin', 'PUT', `/api/panel/admin/email-schedule?city_id=${other}`, { slots: [{ day: 1, hour: 9 }] })).status, 403, 'no es su ciudad');
  const rSched = await req('cityadmin', 'PUT', `/api/panel/admin/email-schedule?city_id=${city}`, { slots: [{ day: 1, hour: 9 }] });
  assert.equal(rSched.status, 200);
  assert.deepEqual((await rSched.json()).slots, [{ day: 1, hour: 9 }]);
  // La otra ciudad no se ve afectada: sigue con el horario por defecto
  const otherSchedule = await (await req('admin', 'GET', `/api/panel/admin/emails?city_id=${other}`)).json();
  assert.deepEqual(otherSchedule.schedule.slots, jobs.DEFAULT_SLOTS);
});
