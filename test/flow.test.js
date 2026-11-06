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
    getGcInfo: async () => ({ inGc: course.gc, groupName: null }),
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

test('declara tener algo que Planning Center no confirma: se acepta el formulario, se anota aparte y se avisa a la persona que pase por el punto de información', async () => {
  reset(); person = { id: '57', url: 'https://pco/57' }; course = { bases1: true, bases2: false, gc: true };
  const id = apply(av, 24, { b2: true });
  await flow.process(id);
  assert.equal(notes.length, 2);
  assert.match(notes[0][1], /^Interesado en servir en AV/);
  assert.match(notes[1][1], /^La persona dice haber hecho Bases 2, pero no consta en Planning Center/);
  const persona = to('ana@x.es')[0];
  assert.match(persona.html, /Contrastando con Planning Center, todavía no consta que hayas hecho Bases 2/);
  assert.match(persona.html, /punto de información este domingo/);
  assert.equal(to('lider@test.es').length, 0);
});

test('sin ficha en Planning Center: aunque declare algo, no se le pide pasar por el punto de información (ya se le dice que no se pudo comprobar nada)', async () => {
  reset(); person = null;
  const id = apply(av, 24, { b1: true });
  await flow.process(id);
  const persona = to('ana@x.es')[0];
  assert.match(persona.html, /No hemos encontrado tu ficha/);
  assert.doesNotMatch(persona.html, /Contrastando con Planning Center/);
});

test('sin seguimiento de Equipos en la ciudad: no se avisa a nadie (ya no hay aviso a administración); solo el email a la propia persona', async () => {
  reset(); person = { id: '58' }; course = { bases1: true, bases2: true, gc: true };
  // Ciudad nueva, sin nadie de seguimiento de Equipos asignado (el líder del módulo está en Madrid, no aquí)
  const cSinSeguimiento = Number(db.prepare("INSERT INTO cities (name) VALUES ('Sin Seguimiento Equipos')").run().lastInsertRowid);
  const otherTeam = Number(db.prepare("INSERT INTO teams (name) VALUES ('Equipo Sin Seguimiento')").run().lastInsertRowid);
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES ('Ana Ruiz','anasinseguimiento@x.es','600111222',?,?,24)`).run(cSinSeguimiento, otherTeam).lastInsertRowid);
  await flow.process(id);
  assert.equal(to('admin@test.es').length, 0);
  assert.equal(sent.length, 1, 'solo el aviso a la propia persona');
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

test('refreshApplication: actualiza una sola solicitud al momento (botón «Actualizar Planning Center»), sin avisar a nadie', async () => {
  reset(); person = { id: '910', url: 'https://pco/910' }; course = { bases1: true, bases2: true, gc: true };
  const id = apply(av);
  await flow.process(id);
  reset(); course = { bases1: true, bases2: false, gc: true }; // ahora falta Bases 2
  const updated = await flow.refreshApplication(id);
  assert.equal(updated.pco_bases2, 0);
  assert.equal(db.prepare('SELECT pco_bases2 FROM applications WHERE id=?').get(id).pco_bases2, 0);
  assert.equal(sent.length, 0, 'no reenvía ningún aviso, solo actualiza el dato');
  assert.equal(await flow.refreshApplication(999999), null, 'solicitud inexistente: no rompe, devuelve null');
});

test('el GC (pco_gc y gc_group_name) viene de pco.getGcInfo (Planning Center Groups), no del checkbox de getCourseStatus, y nunca rompe si no existe esa función', async () => {
  reset(); person = { id: '901' }; course = { bases1: true, bases2: false };
  const flowSinGc = createFlow({ pco: { findPerson: async () => person, getCourseStatus: async () => course }, mail: { sendMail: async (m) => sent.push(m) } });
  const idSinGc = apply(av);
  await flowSinGc.process(idSinGc); // pco.getGcInfo no existe: no debe romper, y pco_gc queda "no se sabe" (null)
  const rowSin = db.prepare('SELECT pco_gc, gc_group_name FROM applications WHERE id=?').get(idSinGc);
  assert.equal(rowSin.pco_gc, null);
  assert.equal(rowSin.gc_group_name, null);

  let gcInfo = { inGc: true, groupName: 'Pablo y Carolina' };
  const flowConGc = createFlow({
    pco: { findPerson: async () => person, getCourseStatus: async () => course, getGcInfo: async () => gcInfo },
    mail: { sendMail: async (m) => sent.push(m) },
  });
  const idConGc = apply(av);
  await flowConGc.process(idConGc);
  let rowCon = db.prepare('SELECT pco_gc, gc_group_name FROM applications WHERE id=?').get(idConGc);
  assert.equal(rowCon.pco_gc, 1);
  assert.equal(rowCon.gc_group_name, 'Pablo y Carolina');

  // Se archiva su grupo (o cambia de uno a otro): refreshCourses lo actualiza, ya no cuenta como "en GC"
  gcInfo = { inGc: false, groupName: 'Diana y Marlin' };
  await flowConGc.refreshCourses();
  rowCon = db.prepare('SELECT pco_gc, gc_group_name FROM applications WHERE id=?').get(idConGc);
  assert.equal(rowCon.pco_gc, 0);
  assert.equal(rowCon.gc_group_name, 'Diana y Marlin');
});

test('form_bases1/form_bases2/form_gc: se guardan al procesar y al refrescar (si pco.getFormStatus existe), y nunca rompen si no existe esa función', async () => {
  reset(); person = { id: '902' }; course = { bases1: false, bases2: false, gc: false };
  const flowSinForms = createFlow({ pco: { findPerson: async () => person, getCourseStatus: async () => course }, mail: { sendMail: async (m) => sent.push(m) } });
  const idSinForms = apply(av);
  await flowSinForms.process(idSinForms); // pco.getFormStatus no existe: no debe romper
  const rowSin = { ...db.prepare('SELECT form_bases1, form_bases2, form_gc FROM applications WHERE id=?').get(idSinForms) };
  assert.deepEqual(rowSin, { form_bases1: null, form_bases2: null, form_gc: null });

  let forms = { bases1: true, bases2: false, gc: false };
  const flowConForms = createFlow({
    pco: { findPerson: async () => person, getCourseStatus: async () => course, getFormStatus: async () => forms },
    mail: { sendMail: async (m) => sent.push(m) },
  });
  const idConForms = apply(av);
  await flowConForms.process(idConForms);
  assert.deepEqual({ ...db.prepare('SELECT form_bases1, form_bases2, form_gc FROM applications WHERE id=?').get(idConForms) }, { form_bases1: 1, form_bases2: 0, form_gc: 0 });

  forms = { bases1: true, bases2: true, gc: true }; // envía los que le faltaban: refreshCourses lo actualiza
  await flowConForms.refreshCourses();
  assert.deepEqual({ ...db.prepare('SELECT form_bases1, form_bases2, form_gc FROM applications WHERE id=?').get(idConForms) }, { form_bases1: 1, form_bases2: 1, form_gc: 1 });
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

test('courses.needsBases / needsGc: reparto entre líder de Bases y de GC (según lo que confirma PCO, no lo autodeclarado)', () => {
  const of = (b1, b2, gc) => ({ pco_bases1: b1, self_bases1: 0, pco_bases2: b2, self_bases2: 0, pco_gc: gc, self_gc: 0 });
  assert.deepEqual([courses.needsBases(of(0, 0, 0)), courses.needsGc(of(0, 0, 0))], [true, false], 'sin nada: solo Bases');
  assert.deepEqual([courses.needsBases(of(1, 0, 0)), courses.needsGc(of(1, 0, 0))], [true, true], 'B1 hecho, faltan B2 y GC: los dos');
  assert.deepEqual([courses.needsBases(of(1, 0, 1)), courses.needsGc(of(1, 0, 1))], [true, false], 'B1 y GC hechos, falta B2: solo Bases');
  assert.deepEqual([courses.needsBases(of(1, 1, 0)), courses.needsGc(of(1, 1, 0))], [false, true], 'Bases hecho, falta GC: solo GC');
  assert.deepEqual([courses.needsBases(of(1, 1, 1)), courses.needsGc(of(1, 1, 1))], [false, false], 'todo hecho: ninguno de los dos');
  // Ahora Bases/GC ven también a quien lo autodeclaró pero Planning Center no lo confirma (mismatch: hay que actualizar PCO)
  const mismatchB1 = { pco_bases1: 0, self_bases1: 1, pco_bases2: 1, self_bases2: 0, pco_gc: 1, self_gc: 0 };
  assert.equal(courses.needsBases(mismatchB1), true, 'B1 autodeclarado sin confirmar en PCO: le toca a Bases igualmente');
  assert.deepEqual(courses.basesGaps(mismatchB1), [{ key: 'bases1', label: 'Bases 1', mismatch: true }]);
  const mismatchGc = { pco_bases1: 1, self_bases1: 0, pco_bases2: 1, self_bases2: 0, pco_gc: 0, self_gc: 1 };
  assert.equal(courses.needsGc(mismatchGc), true, 'GC autodeclarado sin confirmar en PCO: le toca a GC igualmente');
  assert.deepEqual(courses.gcGaps(mismatchGc), [{ key: 'gc', label: 'GC', mismatch: true }]);
  // Sin ficha (pco_* es null): se trata como que falta de verdad, no como mismatch
  const sinFicha = { pco_bases1: null, self_bases1: 0, pco_bases2: null, self_bases2: 0, pco_gc: null, self_gc: 0 };
  assert.deepEqual(courses.basesGaps(sinFicha), [{ key: 'bases1', label: 'Bases 1', mismatch: false }, { key: 'bases2', label: 'Bases 2', mismatch: false }]);
});

test('resumen: el líder de Bases y el de GC reciben su lista por ciudad (de cualquier equipo), en paralelo al líder de equipo', async () => {
  const c3 = Number(db.prepare("INSERT INTO cities (name) VALUES ('Bases y GC')").run().lastInsertRowid);
  const tA = Number(db.prepare("INSERT INTO teams (name) VALUES ('Equipo A')").run().lastInsertRowid);
  const tB = Number(db.prepare("INSERT INTO teams (name) VALUES ('Equipo B')").run().lastInsertRowid);
  const lEquipoA = Number(db.prepare("INSERT INTO users (email, role) VALUES ('equipoa@test.es', 'leader')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(lEquipoA, c3);
  db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(lEquipoA, tA);
  const lBases = Number(db.prepare("INSERT INTO users (email, role) VALUES ('bases3@test.es', 'bases')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(lBases, c3);
  const lGc = Number(db.prepare("INSERT INTO users (email, role) VALUES ('gc3@test.es', 'gc')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(lGc, c3);
  const f3 = createFlow({ pco: { findPerson: async () => ({ id: '1' }) }, mail: { sendMail: async (m) => sent.push(m) } });
  reset();
  // Nada hecho, equipo A → solo Bases (y el líder de equipo A, que ve a todos)
  db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc) VALUES ('Nada Hecho','nada@x.es','600',?,?,24,'listo','1',0,0,0)`).run(c3, tA);
  // B1 hecho, equipo B (líder de equipo B no existe: no debe fallar por eso) → Bases y GC a la vez
  db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc) VALUES ('Solo B1','solob1@x.es','600',?,?,24,'listo','1',1,0,0)`).run(c3, tB);
  // Todo hecho, equipo A → a ninguno de los dos, solo al líder de equipo
  db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,pco_person_id,pco_bases1,pco_bases2,pco_gc) VALUES ('Todo Hecho','todo@x.es','600',?,?,24,'listo','1',1,1,1)`).run(c3, tA);
  await f3.sendDigests();

  const basesMail = to('bases3@test.es')[0];
  assert.ok(basesMail, 'el líder de Bases recibe su lista');
  assert.equal(basesMail.subject, 'Tu lista de Bases · Bases y GC');
  assert.match(basesMail.html, /Nada Hecho/);
  assert.match(basesMail.html, /Solo B1/);
  assert.doesNotMatch(basesMail.html, /Todo Hecho/);

  const gcMail = to('gc3@test.es')[0];
  assert.ok(gcMail, 'el líder de GC recibe su lista');
  assert.equal(gcMail.subject, 'Tu lista de GC · Bases y GC');
  assert.doesNotMatch(gcMail.html, /Nada Hecho/, 'sin Bases 1 no le toca a GC todavía');
  assert.match(gcMail.html, /Solo B1/);
  assert.doesNotMatch(gcMail.html, /Todo Hecho/);

  const equipoAMail = to('equipoa@test.es')[0];
  assert.ok(equipoAMail, 'el líder de equipo sigue viendo a todos los suyos, en paralelo');
  assert.match(equipoAMail.html, /Nada Hecho/);
  assert.match(equipoAMail.html, /Todo Hecho/);
});

test('sin líder de Bases o de GC en la ciudad: no se avisa a administración (ya no existe ese aviso)', async () => {
  const c4 = Number(db.prepare("INSERT INTO cities (name) VALUES ('Sin Bases Ni GC')").run().lastInsertRowid);
  const t4 = Number(db.prepare("INSERT INTO teams (name) VALUES ('Equipo Huérfano')").run().lastInsertRowid);
  const l4 = Number(db.prepare("INSERT INTO users (email, role) VALUES ('equipo4@test.es', 'leader')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(l4, c4);
  db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(l4, t4);
  // apply() está fijado a la ciudad del módulo (Madrid): aquí hace falta otra ciudad, así que se inserta directo.
  const applyIn = (cityId, teamId, email) => Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES ('Ana Ruiz',?,'600111222',?,?,24)`)
    .run(email, cityId, teamId).lastInsertRowid);
  reset(); person = { id: '59' }; course = { bases1: false, bases2: false, gc: false };
  const id = applyIn(c4, t4, 'ana4a@x.es');
  await flow.process(id);
  assert.equal(to('admin@test.es').length, 0, 'le falta Bases, pero eso ya no genera ningún aviso a administración');
});

// ---------- Workflow «Servir En Un Equipo (ciudad)» de Planning Center ----------
function workflowFlow(overrides = {}) {
  const calls = { findPerson: 0, createPerson: [], addToWorkflow: [], notes: [] };
  const people = new Map(); // email → id, para que una segunda búsqueda encuentre lo creado
  const pcoMock = {
    findPerson: async ({ email }) => { calls.findPerson++; return people.has(email) ? { id: people.get(email) } : null; },
    getCourseStatus: async () => ({ bases1: false, bases2: false }),
    getGcInfo: async () => ({ inGc: false, groupName: null }),
    addNote: async (pid, text) => calls.notes.push([pid, text]),
    workflowForCity: async (city) => (city === 'Sin Workflow' ? null : { id: `W-${city}`, name: `Servir En Un Equipo (${city})`, campusId: 'C1' }),
    createPerson: async (p) => { calls.createPerson.push(p); const id = `NEW-${calls.createPerson.length}`; people.set(p.email, id); await new Promise((r) => setTimeout(r, 20)); return { id, warnings: [] }; },
    addToWorkflow: async (pid, wid) => { calls.addToWorkflow.push([pid, wid]); return { cardId: `CARD-${calls.addToWorkflow.length}`, existing: false }; },
    ...overrides,
  };
  return { calls, people, f: createFlow({ pco: pcoMock, mail: { sendMail: async (m) => sent.push(m) } }) };
}
let wfSeq = 0;
// Cada solicitud con un nombre distinto: dos con el mismo nombre y apellidos se toman por la misma persona.
const applyWf = (email, cityName = 'Madrid', name = `Persona Workflow${++wfSeq} Prueba`) => {
  const cityId = db.prepare('SELECT id FROM cities WHERE name = ?').get(cityName)?.id ?? Number(db.prepare('INSERT INTO cities (name) VALUES (?)').run(cityName).lastInsertRowid);
  return Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,self_bases2) VALUES (?,?,'600111222',?,?,24,1)`).run(name, email, cityId, av).lastInsertRowid);
};
const eventsOf = (id, ev) => db.prepare('SELECT detail FROM application_events WHERE application_id=? AND event=?').all(id, ev).map((e) => e.detail);

test('workflow: si ya tiene ficha en Planning Center, no se crea otra y se añade al workflow de su ciudad', async () => {
  reset();
  const { f, calls, people } = workflowFlow();
  people.set('conficha@x.es', '77');
  const id = applyWf('conficha@x.es', 'Madrid');
  await f.process(id);
  assert.equal(calls.createPerson.length, 0);
  assert.deepEqual(calls.addToWorkflow, [['77', 'W-Madrid']]);
  const row = db.prepare('SELECT pco_person_id, pco_card_id, workflow_pending FROM applications WHERE id=?').get(id);
  assert.deepEqual({ ...row }, { pco_person_id: '77', pco_card_id: 'CARD-1', workflow_pending: 0 });
  assert.match(eventsOf(id, 'workflow_ok')[0], /Servir En Un Equipo \(Madrid\)/);
});

test('workflow: sin ficha se crea con sus datos y el campus del workflow, se anotan sus notas, se leen sus cursos y se añade al workflow', async () => {
  reset();
  const { f, calls } = workflowFlow();
  const id = applyWf('nueva@x.es', 'Barcelona', 'Nuria Pons');
  assert.equal(await f.process(id), 'listo');
  assert.deepEqual(calls.createPerson, [{ name: 'Nuria Pons', email: 'nueva@x.es', phone: '600111222', campusId: 'C1' }]);
  assert.deepEqual(calls.addToWorkflow, [['NEW-1', 'W-Barcelona']]);
  const row = db.prepare('SELECT pco_person_id, pco_bases1, pco_gc, note_synced FROM applications WHERE id=?').get(id);
  assert.equal(row.pco_person_id, 'NEW-1');
  assert.equal(row.pco_bases1, 0, 'ficha nueva: sin Bases 1 todavía');
  assert.equal(row.note_synced, 1);
  assert.match(calls.notes[0][1], /^Interesado en servir en AV/);
  assert.match(calls.notes[1][1], /dice haber hecho Bases 2/, 'lo que declaró y no consta también queda anotado en la ficha nueva');
  assert.equal(eventsOf(id, 'pco_creada').length, 1);
  // El email a la persona sigue diciendo que no se encontró su ficha anterior (es lo que pasó al buscarla)
  assert.match(to('nuria').length ? '' : sent.find((m) => m.to === 'nueva@x.es').html, /No hemos encontrado tu ficha/);
});

test('workflow: dos solicitudes casi a la vez de la misma persona (mismo email, o mismo nombre y apellidos) crean una sola ficha', async () => {
  reset();
  const { f, calls } = workflowFlow();
  const a = applyWf('doble@x.es', 'Madrid', 'Tiffany Narro');
  const b = applyWf('doble@x.es', 'Madrid', 'Tiffany Narro');
  const c = applyWf('otro-email@x.es', 'Madrid', 'TIFFANY  narro');
  await Promise.all([f.process(a), f.process(b), f.process(c)]);
  assert.equal(calls.createPerson.length, 1, 'una sola ficha nueva para las tres');
  const ids = [a, b, c].map((i) => db.prepare('SELECT pco_person_id FROM applications WHERE id=?').get(i).pco_person_id);
  assert.deepEqual(new Set(ids), new Set(['NEW-1']));
});

test('workflow: si ya tenía una tarjeta activa (p. ej. del formulario antiguo) se deja constancia y no se crea otra', async () => {
  reset();
  const { f, people } = workflowFlow({ addToWorkflow: async () => ({ cardId: 'VIEJA', existing: true }) });
  people.set('vieja@x.es', '88');
  const id = applyWf('vieja@x.es', 'Valencia');
  await f.process(id);
  assert.equal(db.prepare('SELECT pco_card_id FROM applications WHERE id=?').get(id).pco_card_id, 'VIEJA');
  assert.equal(eventsOf(id, 'workflow_ya').length, 1);
  assert.equal(eventsOf(id, 'workflow_ok').length, 0);
});

test('workflow: ciudad sin workflow → no se crea ficha ni tarjeta, queda anotado y no se reintenta', async () => {
  reset();
  const { f, calls } = workflowFlow();
  const id = applyWf('sinwf@x.es', 'Sin Workflow');
  await f.process(id);
  assert.equal(calls.createPerson.length + calls.addToWorkflow.length, 0);
  assert.match(eventsOf(id, 'workflow_error')[0], /No hay workflow «Servir En Un Equipo \(Sin Workflow\)»/);
  assert.equal(db.prepare('SELECT workflow_pending FROM applications WHERE id=?').get(id).workflow_pending, 0);
});

test('workflow: si Planning Center falla queda pendiente con el error a la vista, y retryWorkflow lo completa sin crear dos fichas', async () => {
  reset();
  let fail = true;
  const { f, calls } = workflowFlow({ addToWorkflow: async (pid, wid) => { if (fail) throw new Error('Planning Center respondió 500'); return { cardId: 'OK', existing: false }; } });
  const id = applyWf('reintento@x.es', 'Madrid');
  assert.equal(await f.process(id), 'listo', 'la solicitud sigue adelante y el email a la persona sale igual');
  let row = db.prepare('SELECT workflow_pending, pco_card_id, pco_person_id, error FROM applications WHERE id=?').get(id);
  assert.equal(row.workflow_pending, 1);
  assert.equal(row.pco_card_id, null);
  assert.equal(row.pco_person_id, 'NEW-1', 'la ficha ya se había creado');
  assert.match(row.error, /^Workflow de Planning Center: Planning Center respondió 500/);
  await f.retryWorkflow();
  assert.equal(eventsOf(id, 'workflow_error').length, 1, 'el mismo error no se repite en cada reintento');

  fail = false;
  await f.retryWorkflow();
  row = db.prepare('SELECT workflow_pending, pco_card_id, error FROM applications WHERE id=?').get(id);
  assert.deepEqual({ ...row }, { workflow_pending: 0, pco_card_id: 'OK', error: null });
  assert.equal(calls.createPerson.length, 1, 'no se crea otra ficha al reintentar');
});

test('workflow: las solicitudes que ya había (sin marca de pendiente) no se tocan', async () => {
  reset();
  db.prepare('UPDATE applications SET workflow_pending=0').run();
  const { f, calls } = workflowFlow();
  const id = applyWf('antigua@x.es', 'Madrid');
  db.prepare("UPDATE applications SET status='listo', pco_person_id='5' WHERE id=?").run(id);
  await f.retryWorkflow();
  assert.equal(calls.addToWorkflow.length, 0);
});
