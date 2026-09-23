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
const courses = require('../src/courses');

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
const leader = Number(db.prepare("INSERT INTO users (email, role) VALUES ('lider@test.es', 'leader')").run().lastInsertRowid);
db.prepare('INSERT INTO user_cities VALUES (?,?)').run(leader, city);
db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(leader, av);

function apply(team, tenure = 24, self = {}) {
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,self_bases1,self_bases2,self_gc) VALUES ('Ana Ruiz','ana@x.es','600111222',?,?,?,?,?,?)`)
    .run(city, team, tenure, +!!self.b1, +!!self.b2, +!!self.gc).lastInsertRowid);
  return id;
}
const reset = () => { sent.length = 0; notes.length = 0; };
const to = (addr) => sent.filter((m) => [].concat(m.to).includes(addr));

test('courses.contrastadoInfo: sin ficha, con mezcla y todo bien', () => {
  assert.equal(courses.contrastadoInfo({ pco_person_id: null }).ok, false);
  assert.equal(courses.contrastadoInfo({ pco_person_id: null }).reason, 'sin_ficha');
  const mism = courses.contrastadoInfo({ pco_person_id: '1', pco_bases1: 0, self_bases1: 1, pco_bases2: 1, self_bases2: 1, pco_gc: 1, self_gc: 0 });
  assert.equal(mism.ok, false);
  assert.equal(mism.reason, 'mismatch');
  assert.deepEqual(mism.mismatched, ['Bases 1']);
  assert.match(mism.guidance, /equipo de PCO de tu campus/);
  const ok = courses.contrastadoInfo({ pco_person_id: '1', pco_bases1: 1, self_bases1: 1, pco_bases2: 1, self_bases2: 0, pco_gc: 1, self_gc: 1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.label, 'Sí');
  assert.equal(ok.reminder, null, 'lo tiene todo: sin recordatorio');
});

test('courses.contrastadoInfo: recordatorio si le falta algo de verdad, esté o no contrastado', () => {
  const unoFalta = courses.contrastadoInfo({ pco_person_id: '1', pco_bases1: 1, self_bases1: 0, pco_bases2: 1, self_bases2: 0, pco_gc: 0, self_gc: 0 });
  assert.equal(unoFalta.ok, true, 'contrastado bien, aunque le falte algo');
  assert.match(unoFalta.reminder, /el paso que le falta/);
  const variosFaltan = courses.contrastadoInfo({ pco_person_id: null });
  assert.match(variosFaltan.reminder, /los pasos que le faltan/);
});

test('tiempo mínimo insuficiente: aviso a la persona, sin tocar Planning Center ni avisar al líder', async () => {
  reset();
  const id = apply(kids, 6);
  assert.equal(await flow.process(id), 'no_apto_aun');
  assert.equal(to('ana@x.es').length, 1);
  assert.equal(sent.length, 1);
  assert.equal(notes.length, 0);
});

test('no existe en Planning Center: se trata como si no tuviera nada, y el líder no recibe ningún email por ello', async () => {
  reset(); person = null;
  const id = apply(av);
  assert.equal(await flow.process(id), 'listo');
  const persona = to('ana@x.es')[0];
  assert.match(persona.html, /No hemos encontrado tu ficha/);
  assert.equal(to('lider@test.es').length, 0, 'el líder ya no recibe un aviso por cada solicitud');
  const row = db.prepare('SELECT status, pco_person_id, pco_bases1 FROM applications WHERE id=?').get(id);
  assert.equal(row.status, 'listo');
  assert.equal(row.pco_person_id, null);
  assert.equal(row.pco_bases1, null);
});

test('con ficha y todo completo: se anota su perfil de Planning Center y no se avisa al líder', async () => {
  reset(); person = { id: '55', url: 'https://pco/55' }; course = { bases1: true, bases2: true, gc: true };
  const id = apply(av);
  assert.equal(await flow.process(id), 'listo');
  assert.equal(notes.length, 1);
  assert.match(notes[0][1], /Interesado en servir en AV/);
  assert.equal(to('lider@test.es').length, 0);
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  assert.ok(row.followup_at);
  assert.equal(row.pco_person_id, '55');
});

test('con ficha pero le falta algo: la persona ve lo que falta; sin bloqueo y sin avisar al líder', async () => {
  reset(); person = { id: '56', url: 'https://pco/56' }; course = { bases1: true, bases2: false, gc: false };
  const id = apply(av);
  assert.equal(await flow.process(id), 'listo');
  const persona = to('ana@x.es')[0];
  assert.match(persona.html, /Bases 2/);
  assert.match(persona.html, /hillsong\.es\/gc/);
  assert.match(persona.html, /líder de tu equipo revisará tu solicitud/);
  assert.equal(to('lider@test.es').length, 0, 'ya no hay bloqueo, pero tampoco aviso inmediato: se ve en su lista');
});

test('declara tener algo que Planning Center no confirma: se acepta el formulario y se anota aparte', async () => {
  reset(); person = { id: '57', url: 'https://pco/57' }; course = { bases1: true, bases2: false, gc: true };
  const id = apply(av, 24, { b2: true });
  await flow.process(id);
  assert.equal(notes.length, 2);
  assert.match(notes[0][1], /^Interesado en servir en AV/);
  assert.match(notes[1][1], /^La persona dice haber hecho Bases 2, pero no consta en Planning Center/);
  assert.equal(to('lider@test.es').length, 0);
});

test('sin líder asignado: se avisa a la administración (con la plantilla editable) y no a nadie más', async () => {
  reset(); person = { id: '58' }; course = { bases1: true, bases2: true, gc: true };
  const other = Number(db.prepare("INSERT INTO teams (name) VALUES ('Sin líder')").run().lastInsertRowid);
  const id = apply(other);
  await flow.process(id);
  assert.equal(to('admin@test.es').length, 1);
  const aviso = to('admin@test.es')[0];
  assert.match(aviso.subject, /Sin líder para Sin líder/);
  assert.match(aviso.html, /Ana Ruiz/);
  assert.match(aviso.html, /600111222/);
});

test('error de Planning Center: la solicitud queda «recibida» para reintentar, y no se envía nada', async () => {
  reset();
  const broken = createFlow({ pco: { findPerson: async () => { throw new Error('PCO caído'); } }, mail: { sendMail: async (m) => sent.push(m) } });
  const id = apply(av);
  assert.equal(await broken.process(id), 'recibida');
  assert.match(db.prepare('SELECT error FROM applications WHERE id=?').get(id).error, /PCO caído/);
  assert.equal(sent.length, 0);
});

test('refreshCourses: enlaza la ficha si aparece más tarde, anota las notas y no avisa al líder', async () => {
  reset(); person = null; course = { bases1: false, bases2: false, gc: false };
  const id = apply(av);
  await flow.process(id);
  assert.equal(to('lider@test.es').length, 0);
  reset(); person = { id: '900', url: 'https://pco/900' }; course = { bases1: true, bases2: false, gc: false };
  const n = await flow.refreshCourses();
  assert.ok(n >= 1);
  const row = db.prepare('SELECT pco_person_id, pco_bases1, note_synced FROM applications WHERE id=?').get(id);
  assert.equal(row.pco_person_id, '900');
  assert.equal(row.pco_bases1, 1);
  // refreshCourses() recorre TODAS las solicitudes abiertas, así que también enlaza (y anota) la de la prueba
  // «no existe en Planning Center» de más arriba, que se quedó sin ficha; por eso no forzamos notes.length === 1.
  assert.ok(notes.some(([, t]) => t.startsWith('Interesado en servir en AV')));
  assert.equal(to('lider@test.es').length, 0, 'refreshCourses no avisa a nadie: solo se ve en el panel y en la lista');
});

test('resumen: nuevas, seguimiento y resto se reparten sin solaparse, y todas llevan sus cursos', async () => {
  const c2 = Number(db.prepare("INSERT INTO cities (name) VALUES ('Resumen')").run().lastInsertRowid);
  const t2 = Number(db.prepare("INSERT INTO teams (name) VALUES ('Resumen equipo')").run().lastInsertRowid);
  const l2 = Number(db.prepare("INSERT INTO users (email, role) VALUES ('lider2@test.es', 'leader')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(l2, c2);
  db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(l2, t2);
  const f2 = createFlow({ pco: { findPerson: async () => ({ id: '1' }), getCourseStatus: async () => ({ bases1: true, bases2: true, gc: true }) }, mail: { sendMail: async (m) => sent.push(m) } });
  reset();
  db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc,followup_at,created_at) VALUES ('Vieja Pendiente','v@x.es','600',?,?,24,'listo','1',1,0,0,NULL,'2020-01-01 00:00:00')`).run(c2, t2);
  db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc,followup_at,created_at) VALUES ('Toca Seguimiento','s@x.es','600',?,?,24,'contactado','1',1,1,1,'2020-01-01T00:00:00.000Z','2020-01-01 00:00:00')`).run(c2, t2);
  await f2.sendDigests();
  const first = to('lider2@test.es')[0];
  assert.ok(first);
  assert.doesNotMatch(first.html, /Nuevas desde el último resumen/, 'primer envío: sin marca previa, nada es «nuevo»');
  assert.match(first.html, /Toca hacer seguimiento/);
  assert.match(first.html, /Toca Seguimiento/);
  assert.match(first.html, /Resto de tu lista/);
  assert.match(first.html, /Vieja Pendiente/);

  reset();
  const nueva = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES ('Recien Llegada','r@x.es','600',?,?,24)`).run(c2, t2).lastInsertRowid);
  await f2.process(nueva);
  reset();
  await f2.sendDigests();
  const second = to('lider2@test.es')[0];
  assert.match(second.html, /Nuevas desde el último resumen/);
  assert.match(second.html, /Recien Llegada/);
  const nuevasBlock = second.html.split('Nuevas desde el último resumen')[1].split('</ul>')[0];
  assert.doesNotMatch(nuevasBlock, /Vieja Pendiente|Toca Seguimiento/);
});
