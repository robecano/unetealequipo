const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-')), 'test.db');
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@test.es';

const { db } = require('../src/db');
const { createFlow } = require('../src/flow');
const { fieldDone, phoneKey } = require('../src/pco');

const sent = [];
const notes = [];
let person = null;
let course = { bases1: true, bases2: true, gc: true };
const flow = createFlow({
  pco: {
    findPerson: async () => person,
    getCourseStatus: async () => course,
    addNote: async (id, text) => notes.push([id, text]),
  },
  mail: { sendMail: async (m) => sent.push(m) },
});

const city = Number(db.prepare("INSERT INTO cities (name) VALUES ('Madrid')").run().lastInsertRowid);
const kids = Number(db.prepare("INSERT INTO teams (name, min_months, notice) VALUES ('Kids', 12, 'Entrevista previa')").run().lastInsertRowid);
const av = Number(db.prepare("INSERT INTO teams (name) VALUES ('AV')").run().lastInsertRowid);
const user = (email, role) => Number(db.prepare('INSERT INTO users (email, role) VALUES (?,?)').run(email, role).lastInsertRowid);
const leader = user('lider@test.es', 'leader');
db.prepare('INSERT INTO user_cities VALUES (?,?)').run(leader, city);
db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(leader, av);
const bases = user('bases@test.es', 'bases');
db.prepare('INSERT INTO user_cities VALUES (?,?)').run(bases, city);

function apply(team, tenure = 24) {
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES ('Ana Ruiz','ana@x.es','600111222',?,?,?)`).run(city, team, tenure).lastInsertRowid);
  return id;
}
const reset = () => { sent.length = 0; notes.length = 0; };
const to = (addr) => sent.filter((m) => [].concat(m.to).includes(addr));

test('fieldDone: sin requisitos basta cualquier valor; con requisitos, todos', () => {
  assert.equal(fieldDone([], []), false);
  assert.equal(fieldDone(['x'], []), true);
  assert.equal(fieldDone(['Asistencia Sesión 1'], ['Asistencia Sesión 1', 'Asistencia Sesión 2']), false);
  assert.equal(fieldDone(['asistencia sesión 2', 'Asistencia Sesión 1'], ['Asistencia Sesión 1', 'Asistencia Sesión 2']), true);
  assert.equal(phoneKey('+34 600 11 22 33'), phoneKey('0034600112233'));
});

test('antigüedad insuficiente para Kids: avisa a la persona, no al líder ni a PCO', async () => {
  reset();
  const id = apply(kids, 6);
  assert.equal(await flow.process(id), 'no_apto_aun');
  assert.equal(to('ana@x.es').length, 1);
  assert.equal(sent.length, 1);
  assert.equal(notes.length, 0);
});

test('no existe en PCO: se trata como si no tuviera nada (voluntario de Bases y email con lo que le falta)', async () => {
  reset(); person = null;
  const id = apply(av);
  assert.equal(await flow.process(id), 'pendiente_bases');
  const html = to('ana@x.es')[0].html;
  assert.match(html, /No hemos encontrado tu ficha/);
  assert.match(html, /Bases 1 y Bases 2<\/b> — <a href="https:\/\/hillsong\.es\/bases"/);
  assert.match(html, /Grupo de Conexión/);
  assert.match(html, /Un voluntario de Bases de tu ciudad te llamará/);
  assert.equal(to('bases@test.es').length, 1);
  assert.equal(to('lider@test.es').length, 0);
  const row = db.prepare('SELECT status, pco_person_id, pco_bases1, needs_bases, needs_gc, bases_user_id FROM applications WHERE id=?').get(id);
  assert.deepEqual([row.status, row.pco_person_id, row.pco_bases1, row.needs_bases, row.needs_gc, row.bases_user_id], ['pendiente_bases', null, null, 1, 0, bases]);
  assert.equal(notes.length, 0, 'sin ficha no hay dónde escribir la nota');
});

test('tiene Bases 1 y 2: nota en PCO, avisa al líder y programa seguimiento', async () => {
  reset(); person = { id: '55', url: 'https://pco/55' }; course = { bases1: true, bases2: true, gc: true };
  const id = apply(av);
  assert.equal(await flow.process(id), 'listo');
  assert.equal(notes.length, 1);
  assert.match(notes[0][1], /Interesado en servir en AV/);
  assert.equal(to('lider@test.es').length, 1);
  assert.match(to('lider@test.es')[0].html, /esta semana/);
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  assert.ok(row.followup_at);
  assert.equal(row.pco_person_id, '55');
});

test('falta Bases 2: se asigna voluntario de Bases y el líder no recibe aviso inmediato', async () => {
  reset(); course = { bases1: true, bases2: false, gc: false };
  const id = apply(av);
  assert.equal(await flow.process(id), 'pendiente_bases');
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  assert.equal(row.bases_user_id, bases);
  assert.match(to('ana@x.es')[0].html, /hillsong\.es\/bases\b/);
  assert.match(to('ana@x.es')[0].html, /Grupo de Conexión/);
  assert.equal(to('bases@test.es').length, 1);
  assert.equal(to('lider@test.es').length, 0);
});

test('resumen semanal: el líder ve listos y pendientes; al hacer Bases 2 pasan a listo', async () => {
  reset();
  await flow.sendDigests();
  const digest = to('lider@test.es')[0];
  assert.ok(digest);
  assert.match(digest.html, /aún no tienen Bases 1, Bases 2 o GC \(seguimiento opcional\)/);
  assert.match(digest.html, /Le falta: Bases 2/);
  assert.match(digest.html, /Llamar esta semana/);
  assert.equal(to('bases@test.es').length, 1);
  reset(); course = { bases1: true, bases2: true, gc: true };
  assert.ok((await flow.recheckPending()) >= 1);
  assert.ok(to('lider@test.es').length >= 1);
});

test('sin líder asignado: se avisa al administrador', async () => {
  reset(); person = { id: '56' }; course = { bases1: true, bases2: true, gc: true };
  const other = Number(db.prepare("INSERT INTO teams (name) VALUES ('Sin líder')").run().lastInsertRowid);
  const id = apply(other);
  await flow.process(id);
  assert.equal(to('admin@test.es').length, 1);
});

test('error de PCO: la solicitud queda "recibida" para reintentar', async () => {
  reset();
  const broken = createFlow({ pco: { findPerson: async () => { throw new Error('PCO caído'); } }, mail: { sendMail: async (m) => sent.push(m) } });
  const id = apply(av);
  assert.equal(await broken.process(id), 'recibida');
  assert.match(db.prepare('SELECT error FROM applications WHERE id=?').get(id).error, /PCO caído/);
  assert.equal(sent.length, 0);
});

test('si dijo Sí y en PCO no consta: se cree el formulario, se avisa al líder y se marca sin verificar', async () => {
  reset(); person = { id: '57', url: 'https://pco/57' }; course = { bases1: true, bases2: false, gc: true };
  const id = apply(av);
  db.prepare('UPDATE applications SET self_bases2 = 1 WHERE id = ?').run(id);
  assert.equal(await flow.process(id), 'listo');
  const html = to('lider@test.es')[0].html;
  assert.match(html, /Dato sin verificar/);
  assert.match(html, /Bases 2/);
  assert.equal(notes.length, 2);
  assert.match(notes[0][1], /^Interesado en servir en AV/);
  assert.match(notes[1][1], /^La persona dice haber hecho Bases 2, pero no consta en Planning Center/);
  const row = db.prepare('SELECT bases_user_id, pco_bases2, self_bases2 FROM applications WHERE id=?').get(id);
  assert.equal(row.bases_user_id, null);
  assert.equal(row.pco_bases2, 0);
});

test('si dijo No y en PCO no consta: sigue el camino de Bases (sin cambios)', async () => {
  reset(); person = { id: '58' }; course = { bases1: true, bases2: false, gc: true };
  const id = apply(av);
  assert.equal(await flow.process(id), 'pendiente_bases');
  assert.equal(to('lider@test.es').length, 0);
});

test('varias cosas declaradas sin constar: una sola nota con todo, redactada en español', async () => {
  reset(); person = { id: '59' }; course = { bases1: false, bases2: false, gc: false };
  const id = apply(av);
  db.prepare('UPDATE applications SET self_bases1=1, self_bases2=1, self_gc=1 WHERE id=?').run(id);
  await flow.process(id);
  assert.match(notes[1][1], /La persona dice haber hecho Bases 1, haber hecho Bases 2 y tener un GC, pero no consta/);
});

test('si falla la segunda nota, el reintento escribe solo la que faltaba', async () => {
  const written = []; let fail = true;
  const f = createFlow({
    pco: { findPerson: async () => ({ id: '60' }), getCourseStatus: async () => ({ bases1: true, bases2: false, gc: true }),
      addNote: async (id, t) => { if (t.startsWith('La persona dice') && fail) throw new Error('PCO 500'); written.push(t); } },
    mail: { sendMail: async () => {} },
  });
  const id = apply(av);
  db.prepare('UPDATE applications SET self_bases2=1 WHERE id=?').run(id);
  await f.process(id);
  assert.equal(written.length, 1);
  assert.equal(db.prepare('SELECT note_synced n FROM applications WHERE id=?').get(id).n, 0);
  fail = false;
  await f.retryNotes();
  assert.equal(written.length, 2);
  assert.match(written[1], /^La persona dice/);
  assert.equal(db.prepare('SELECT note_synced n FROM applications WHERE id=?').get(id).n, 1);
});
