const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ---------- Planning Center simulado (solo lo necesario para leer formularios) ----------
const SUBMISSIONS = { 900: [] }; // personId -> [{ form, created_at }]
const FORMS = [
  { id: '1', name: 'Registro Bases 1 Madrid - Online' }, { id: '2', name: 'Registro Bases 2 Barcelona' },
  { id: '3', name: 'Asistencia Bloques 1, 2 y 3 (Sesión 1) de Bases 1' }, { id: '4', name: 'Registro Bases 3 Madrid' },
  { id: '5', name: 'Registro a Grupos de Conexión MAD' }, { id: '6', name: 'Registro Bases 1 Valencia', archived: true },
];
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data })); };
  if (url.pathname === '/people/v2/forms') return send(FORMS.map((f) => ({ type: 'Form', id: f.id, attributes: { name: f.name, archived_at: f.archived ? '2025-01-01T00:00:00Z' : null } })));
  const m = url.pathname.match(/^\/people\/v2\/people\/(\d+)\/form_submissions$/);
  if (m) return send((SUBMISSIONS[m[1]] || []).map((s, i) => ({ type: 'FormSubmission', id: String(i), attributes: { created_at: s.created_at }, relationships: { form: { data: { type: 'Form', id: s.form } } } })));
  res.statusCode = 404; res.end('{}');
});

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-ls-')), 'test.db');
process.env.SESSION_SECRET = 'l'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@test.es';
process.env.PCO_APP_ID = 'x'; process.env.PCO_SECRET = 'y';

let base, server, api;
const cookies = {};
const J = { 'Content-Type': 'application/json' };
const req = (who, method, url, body) => fetch(api + url, { method, headers: { ...J, ...(cookies[who] ? { Cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (who, email, pw) => { const r = await fetch(api + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ email, password: pw }) }); assert.equal(r.status, 200, email); cookies[who] = r.headers.get('set-cookie').split(';')[0]; };

let db, createFlow, pco, appMod;
let city, teamA, teamB, leader, bases, gc;
const sent = [];
const to = (a) => sent.filter((m) => [].concat(m.to).includes(a));
let course = { bases1: false, bases2: false, gc: false };
let forms = [];

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.PCO_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  ({ db } = require('../src/db'));
  ({ createFlow } = require('../src/flow'));
  pco = require('../src/pco');
  appMod = require('../server');
  server = appMod.app.listen(0);
  api = `http://127.0.0.1:${server.address().port}`;
  await login('admin', 'admin@test.es', 'admin-pass');
  city = Number(db.prepare("INSERT INTO cities (name) VALUES ('Madrid')").run().lastInsertRowid);
  teamA = Number(db.prepare("INSERT INTO teams (name) VALUES ('Cafetería')").run().lastInsertRowid);
  teamB = Number(db.prepare("INSERT INTO teams (name) VALUES ('Sonido')").run().lastInsertRowid);
  const mk = (email, role, teams = []) => { const id = Number(db.prepare('INSERT INTO users (email, role) VALUES (?,?)').run(email, role).lastInsertRowid); db.prepare('INSERT INTO user_cities VALUES (?,?)').run(id, city); for (const t of teams) db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(id, t); return id; };
  leader = mk('lider@test.es', 'leader', [teamA]); bases = mk('bases@test.es', 'bases'); gc = mk('gc@test.es', 'gc');
  for (const [w, e] of [['leader', 'lider@test.es'], ['bases', 'bases@test.es'], ['gc', 'gc@test.es']]) await login(w, e, 'HillsongEspana');
});
test.after(() => { server.close(); fake.close(); });

const flow = () => createFlow({
  pco: { findPerson: async () => ({ id: '900', url: 'https://pco/900' }), getCourseStatus: async () => course, addNote: async () => {}, getBasesFormSubmissions: async () => forms },
  mail: { sendMail: async (m) => sent.push(m) },
});
const apply = (name, teamId = teamA, created) => {
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES (?,?,?,?,?,24)`).run(name, `${name.toLowerCase().replace(/\W/g, '')}@x.es`, '600111222', city, teamId).lastInsertRowid);
  if (created) db.prepare('UPDATE applications SET created_at = ? WHERE id = ?').run(created, id);
  return id;
};
const row = (id) => db.prepare('SELECT * FROM applications WHERE id = ?').get(id);

test('detección real contra Planning Center: solo cuentan los formularios «Registro Bases 1» y «Registro Bases 2» (ni asistencia, ni Bases 3, ni GC, ni archivados)', async () => {
  SUBMISSIONS[900] = [
    { form: '2', created_at: '2026-03-01T10:00:00Z' }, { form: '3', created_at: '2026-03-05T10:00:00Z' }, { form: '4', created_at: '2026-03-06T10:00:00Z' },
    { form: '5', created_at: '2026-03-07T10:00:00Z' }, { form: '1', created_at: '2026-04-01T10:00:00Z' }, { form: '6', created_at: '2026-04-02T10:00:00Z' },
  ];
  const subs = await pco.getBasesFormSubmissions('900');
  assert.deepEqual(subs.map((s) => s.form_id), ['1', '2'], 'solo los formularios 1 y 2, del más reciente al más antiguo');
  assert.equal(subs[0].created_at, '2026-04-01T10:00:00Z');
  assert.deepEqual(await pco.getBasesFormSubmissions('12345'), [], 'sin envíos');
});

test('si ya rellenó el formulario ANTES de apuntarse: se avisa al voluntario de Bases y se queda en su lista hasta quitarla a mano', async () => {
  sent.length = 0; course = { bases1: false, bases2: false, gc: false };
  forms = [{ form_id: '1', created_at: '2020-01-01T00:00:00Z' }];
  const id = apply('Antes Ana');
  await flow().process(id);
  assert.equal(row(id).bases_form_before, 1);
  assert.match(to('bases@test.es')[0].html, /Ya rellenó el formulario de Bases anteriormente pero no fue contactado/);
  const lista = await (await req('bases', 'GET', '/api/panel/applications')).json();
  const a = lista.find((x) => x.id === id);
  assert.ok(a && a.bases_form_before === 1, 'aparece en su lista con la marca');
  // el resumen semanal lo vuelve a indicar
  sent.length = 0; await flow().sendDigests();
  assert.match(to('bases@test.es')[0].html, /Ya rellenó el formulario de Bases anteriormente pero no fue contactado/);
  // y no sale por sí sola aunque pase el tiempo
  await flow().recheckPending();
  assert.equal(row(id).bases_removed, 0);
  assert.equal((await (await req('bases', 'GET', '/api/panel/applications')).json()).some((x) => x.id === id), true);
});

test('si rellena el formulario DESPUÉS de apuntarse: sale sola de la lista del voluntario de Bases', async () => {
  sent.length = 0; course = { bases1: false, bases2: false, gc: false };
  forms = [];
  const id = apply('Despues Dani');
  await flow().process(id);
  assert.equal(row(id).bases_form_before, 0);
  assert.doesNotMatch(to('bases@test.es')[0].html, /anteriormente/);
  forms = [{ form_id: '2', created_at: new Date(Date.now() + 3600 * 1000).toISOString() }]; // lo rellena más tarde
  await flow().recheckPending();
  const r = row(id);
  assert.equal(r.bases_removed, 1);
  assert.ok(r.bases_form_at);
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'bases_formulario'").get(id));
  assert.equal((await (await req('bases', 'GET', '/api/panel/applications')).json()).some((x) => x.id === id), false, 'ya no está en su lista');
  assert.equal((await (await req('bases', 'GET', '/api/panel/applications?removed=1')).json()).some((x) => x.id === id), true, 'pero se puede ver en «Quitadas»');
  sent.length = 0; await flow().sendDigests();
  assert.ok(!to('bases@test.es').some((m) => /Despues Dani/.test(m.html)), 'tampoco va en su resumen semanal');
});

test('si Planning Center falla al leer los formularios, la solicitud sigue adelante', async () => {
  sent.length = 0; course = { bases1: false, bases2: false, gc: false };
  const f = createFlow({ pco: { findPerson: async () => ({ id: '900' }), getCourseStatus: async () => course, addNote: async () => {}, getBasesFormSubmissions: async () => { throw new Error('PCO caído'); } }, mail: { sendMail: async (m) => sent.push(m) } });
  const id = apply('Sin Formularios');
  assert.equal(await f.process(id), 'pendiente_bases');
  assert.equal(row(id).bases_form_before, 0);
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'pco_error'").get(id));
  assert.equal(to('bases@test.es').length, 1, 'el voluntario recibe su aviso igualmente');
});

test('voluntario de Bases: quitar a mano, restaurar, y «Ya está apuntado en Bases» la saca de la lista', async () => {
  course = { bases1: false, bases2: false, gc: false }; forms = [];
  const a = apply('Manual Bea'), b = apply('Apuntada Ana');
  await flow().process(a); await flow().process(b);
  const en = async (q = '') => (await (await req('bases', 'GET', `/api/panel/applications${q}`)).json()).map((x) => x.name);
  assert.ok((await en()).includes('Manual Bea'));
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${a}`, { removed: true })).status, 200);
  assert.ok(!(await en()).includes('Manual Bea'));
  assert.ok((await en('?removed=1')).includes('Manual Bea'));
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${a}`, { removed: false })).status, 200);
  assert.ok((await en()).includes('Manual Bea'), 'restaurada');
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${b}`, { bases_status: 'registrado' })).status, 200);
  assert.equal(row(b).bases_removed, 1);
  assert.ok(!(await en()).includes('Apuntada Ana'));
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'quitada_de_lista'").get(a));
  sent.length = 0; await flow().sendDigests();
  const dig = to('bases@test.es').map((m) => m.html).join('');
  assert.match(dig, /Manual Bea/);
  assert.doesNotMatch(dig, /Apuntada Ana/);
});

test('voluntario de GC: se va sola al detectar que ya está en un GC, o se quita a mano', async () => {
  sent.length = 0; course = { bases1: true, bases2: true, gc: false }; forms = [];
  const a = apply('Gece Gala'), b = apply('Gece Manual');
  await flow().process(a); await flow().process(b);
  const en = async (q = '') => (await (await req('gc', 'GET', `/api/panel/applications${q}`)).json()).map((x) => x.name);
  assert.deepEqual((await en()).filter((n) => n.startsWith('Gece')).sort(), ['Gece Gala', 'Gece Manual']);
  assert.equal((await req('gc', 'PATCH', `/api/panel/applications/${b}`, { removed: true })).status, 200);
  assert.deepEqual((await en()).filter((n) => n.startsWith('Gece')), ['Gece Gala'], 'la quitada a mano ya no está en su lista');
  assert.deepEqual((await en('?removed=1')).filter((n) => n.startsWith('Gece')), ['Gece Manual'], 'pero se ve en «Quitadas»');
  course = { bases1: true, bases2: true, gc: true }; // el sistema detecta que Gala ya está en un GC
  await flow().recheckPending();
  assert.equal((await en()).filter((n) => n.startsWith('Gece')).length, 0, 'se va sola');
  assert.equal(row(a).needs_gc, 0);
  const c = apply('Gece Apuntada'); course = { bases1: true, bases2: true, gc: false }; await flow().process(c);
  assert.equal((await req('gc', 'PATCH', `/api/panel/applications/${c}`, { gc_status: 'registrado' })).status, 200);
  assert.equal(row(c).gc_removed, 1, '«Ya está en un GC» también la saca de la lista');
});

test('líder de equipo: quita a alguien de su listado (solo si aún no lo tiene todo), deja de recibirlo y puede restaurarlo', async () => {
  sent.length = 0; course = { bases1: true, bases2: false, gc: false }; forms = [];
  const pend = apply('Pendiente Pepe'), otro = apply('Otro Equipo Olga', teamB);
  await flow().process(pend); await flow().process(otro);
  course = { bases1: true, bases2: true, gc: true };
  const listo = apply('Listo Lola'); await flow().process(listo);
  const nombres = async (q = '') => (await (await req('leader', 'GET', `/api/panel/applications${q}`)).json()).map((x) => x.name);
  assert.ok((await nombres()).includes('Pendiente Pepe'));
  assert.ok(!(await nombres()).includes('Otro Equipo Olga'), 'solo su equipo');
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${listo}`, { removed: true })).status, 400, 'a quien ya lo tiene todo no se le quita (hay que llamarle)');
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${otro}`, { removed: true })).status, 404, 'ni a los de otro equipo');
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${pend}`, { removed: true })).status, 200);
  assert.ok(!(await nombres()).includes('Pendiente Pepe'));
  assert.ok((await nombres('?removed=1')).includes('Pendiente Pepe'));
  sent.length = 0; await flow().sendDigests();
  const digest = to('lider@test.es').map((m) => m.html).join('');
  assert.doesNotMatch(digest, /Pendiente Pepe/, 'ya no le llega en el resumen');
  assert.match(digest, /Listo Lola/);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${pend}`, { removed: false })).status, 200);
  sent.length = 0; await flow().sendDigests();
  assert.match(to('lider@test.es').map((m) => m.html).join(''), /Pendiente Pepe/);
  assert.equal((await req('admin', 'PATCH', `/api/panel/applications/${pend}`, { removed: true })).status, 400, 'el admin no tiene lista propia');
});

test('si el voluntario quita a la persona, al líder ya no se le dice que ese voluntario la contactará', async () => {
  sent.length = 0; course = { bases1: true, bases2: false, gc: true }; forms = [];
  const id = apply('Contacto Carla'); await flow().process(id);
  await flow().sendDigests();
  assert.match(to('lider@test.es').map((m) => m.html).join(''), /Contacto Carla[^]*?También le contactará un voluntario de Bases/);
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { removed: true });
  sent.length = 0; await flow().sendDigests();
  const trozo = to('lider@test.es').map((m) => m.html).join('').split('<li>').find((x) => x.includes('Contacto Carla'));
  assert.ok(trozo);
  assert.doesNotMatch(trozo, /También le contactar/);
});

test('exportar CSV: los voluntarios de Bases y de GC y el líder pueden, cada uno con su lista (y su vista de quitadas)', async () => {
  course = { bases1: false, bases2: false, gc: false }; forms = [{ form_id: '1', created_at: '2020-01-01T00:00:00Z' }];
  const id = apply('Csv Carmen'); await flow().process(id);
  for (const who of ['bases', 'leader']) {
    const r = await req(who, 'GET', '/api/panel/applications.csv?q=Csv');
    assert.equal(r.status, 200, who);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    const txt = await r.text();
    assert.match(txt, /Csv Carmen/);
    assert.match(txt, /Ya rellenó el formulario de Bases antes de apuntarse/);
    assert.match(txt, /;Sí;/);
  }
  const gcCsv = await req('gc', 'GET', '/api/panel/applications.csv');
  assert.equal(gcCsv.status, 200);
  assert.doesNotMatch(await gcCsv.text(), /Csv Carmen/, 'el de GC solo exporta lo suyo (aún sin Bases 1 no le toca)');
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { removed: true });
  assert.doesNotMatch(await (await req('bases', 'GET', '/api/panel/applications.csv?q=Csv')).text(), /Csv Carmen/);
  assert.match(await (await req('bases', 'GET', '/api/panel/applications.csv?q=Csv&removed=1')).text(), /Csv Carmen/);
});
