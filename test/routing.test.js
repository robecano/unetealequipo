const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-rt-')), 'test.db');
process.env.SESSION_SECRET = 'r'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@test.es';

// Base "antigua": sin rol gc en el CHECK de users y sin teléfono. Debe migrarse conservando los datos.
{
  const old = new DatabaseSync(process.env.DB_PATH);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK (role IN ('admin','leader','bases')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO users (email, name, role) VALUES ('vieja@test.es', 'Vieja Líder', 'leader');`);
  old.close();
}

const { db } = require('../src/db');
const { createFlow } = require('../src/flow');

test('la migración añade el rol gc y conserva los usuarios existentes', () => {
  const u = db.prepare("SELECT * FROM users WHERE email = 'vieja@test.es'").get();
  assert.equal(u.name, 'Vieja Líder');
  assert.equal(u.role, 'leader');
  assert.equal(u.phone, '');
  assert.doesNotThrow(() => db.prepare("INSERT INTO users (email, role) VALUES ('nuevo-gc@test.es', 'gc')").run());
  db.prepare("DELETE FROM users WHERE email = 'nuevo-gc@test.es'").run();
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('applications') WHERE name = 'needs_gc'").get());
});

const sent = [];
let person = { id: '55', url: 'https://pco/55' };
let course = {};
const flow = createFlow({
  pco: { findPerson: async () => person, getCourseStatus: async () => course, addNote: async () => {} },
  mail: { sendMail: async (m) => sent.push(m) },
});
const to = (addr) => sent.filter((m) => [].concat(m.to).includes(addr));
const reset = () => { sent.length = 0; };

const city = Number(db.prepare("INSERT INTO cities (name) VALUES ('Madrid')").run().lastInsertRowid);
const empty = Number(db.prepare("INSERT INTO cities (name) VALUES ('Sinvoluntarios')").run().lastInsertRowid);
const team = Number(db.prepare("INSERT INTO teams (name) VALUES ('Cafetería')").run().lastInsertRowid);
const user = (email, role, cities = [city]) => {
  const id = Number(db.prepare('INSERT INTO users (email, role, name) VALUES (?,?,?)').run(email, role, email.split('@')[0]).lastInsertRowid);
  for (const c of cities) db.prepare('INSERT INTO user_cities VALUES (?,?)').run(id, c);
  return id;
};
const leader = user('lider@test.es', 'leader');
db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(leader, team);
const bases = user('bases@test.es', 'bases');
const gc = user('gc@test.es', 'gc');

const apply = (self = {}, cityId = city) => Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,self_bases1,self_bases2,self_gc)
  VALUES ('Ana Ruiz','ana@x.es','600111222',?,?,24,?,?,?)`).run(cityId, team, +!!self.b1, +!!self.b2, +!!self.gc).lastInsertRowid);

// [B1, B2, GC, ¿Bases?, ¿GC?, ¿líder?]
const MATRIZ = [
  [0, 0, 0, true, false, false, 'no tiene nada → voluntario de Bases'],
  [1, 0, 0, true, true, false, 'solo Bases 1 → voluntario de GC y de Bases (para Bases 2)'],
  [1, 0, 1, true, false, false, 'Bases 1 y GC → voluntario de Bases (para Bases 2)'],
  [1, 1, 0, false, true, false, 'Bases 1 y Bases 2 → voluntario de GC (el líder espera: le llegará en el listado opcional)'],
  [1, 1, 1, false, false, true, 'lo tiene todo → solo el líder'],
];
for (const [b1, b2, g, wantBases, wantGc, wantLeader, label] of MATRIZ) {
  test(`reparto: ${label}`, async () => {
    reset();
    course = { bases1: !!b1, bases2: !!b2, gc: !!g };
    const id = apply();
    await flow.process(id);
    assert.equal(to('ana@x.es').length, 1, 'la persona recibe un email');
    assert.equal(to('bases@test.es').length, +wantBases, 'voluntario de Bases');
    assert.equal(to('gc@test.es').length, +wantGc, 'voluntario de GC');
    assert.equal(to('lider@test.es').length, +wantLeader, 'líder');
    const row = db.prepare('SELECT bases_user_id, gc_user_id, needs_gc, status FROM applications WHERE id = ?').get(id);
    assert.equal(row.bases_user_id, wantBases ? bases : null);
    assert.equal(row.gc_user_id, wantGc ? gc : null);
    assert.equal(row.needs_gc, +wantGc);
    assert.equal(row.status, wantLeader ? 'listo' : 'pendiente_bases');
    assert.equal(db.prepare('SELECT needs_bases n FROM applications WHERE id = ?').get(id).n, +wantBases, 'needs_bases');
  });
}

test('lo que la persona declara en el formulario cuenta como hecho para el reparto', async () => {
  reset(); course = { bases1: false, bases2: false, gc: false };
  const id = apply({ b1: true, b2: true }); // dice Bases 1 y 2, en PCO no consta → voluntario de GC, sin Bases y sin líder (falta GC)
  await flow.process(id);
  assert.equal(to('bases@test.es').length, 0);
  assert.equal(to('gc@test.es').length, 1);
  assert.equal(to('lider@test.es').length, 0);
  reset(); course = { bases1: false, bases2: false, gc: false };
  const id2 = apply({ b1: true, b2: true, gc: true }); // dice los tres → líder, con el aviso de dato sin verificar
  await flow.process(id2);
  assert.equal(to('lider@test.es').length, 1);
  assert.match(to('lider@test.es')[0].html, /Dato sin verificar/);
  assert.equal(to('bases@test.es').length + to('gc@test.es').length, 0);
});

test('la persona solo recibe la promesa del voluntario de GC si lo hay, y el líder no recibe nada mientras falte GC', async () => {
  reset(); course = { bases1: true, bases2: true, gc: false };
  await flow.process(apply());
  assert.equal(to('lider@test.es').length, 0, 'el líder espera: le llegará en el listado opcional');
  assert.match(to('ana@x.es')[0].html, /voluntario de Grupos de Conexión de tu ciudad te llamará/);
  assert.match(to('ana@x.es')[0].html, /hillsong\.es\/gc/);
  assert.match(to('gc@test.es')[0].html, /invitarla a apuntarse a un GC/);
  reset();
  await flow.process(apply({}, empty)); // ciudad sin voluntarios
  assert.doesNotMatch(to('ana@x.es')[0].html, /voluntario de Grupos de Conexión de tu ciudad te llamará/);
  assert.ok(to('admin@test.es').some((m) => /Sin voluntario de GC en Sinvoluntarios/.test(m.subject)));
});

test('el reparto entre voluntarios de GC de la misma ciudad es equilibrado', async () => {
  const doble = Number(db.prepare("INSERT INTO cities (name) VALUES ('Doble')").run().lastInsertRowid);
  const a = user('gca@test.es', 'gc', [doble]);
  const b = user('gcb@test.es', 'gc', [doble]);
  reset(); course = { bases1: true, bases2: true, gc: false };
  const ids = [];
  for (let i = 0; i < 4; i++) { const id = apply({}, doble); await flow.process(id); ids.push(id); }
  const reparto = db.prepare(`SELECT gc_user_id g, COUNT(*) n FROM applications WHERE id IN (${ids.join(',')}) GROUP BY gc_user_id`).all();
  assert.deepEqual(reparto.map((r) => r.g).sort(), [a, b].sort());
  assert.ok(reparto.every((r) => r.n === 2), 'dos y dos');
  // no se cuelan en el resumen de los voluntarios de otra ciudad
  reset();
  await flow.sendDigests();
  assert.equal(to('gc@test.es').filter((m) => /Ana Ruiz/.test(m.html)).length, 1);
  db.prepare('UPDATE users SET active = 0 WHERE id IN (?, ?)').run(a, b);
});

test('resumen semanal: el voluntario de GC recibe a quienes tienen Bases 1 y aún no están en un GC', async () => {
  reset();
  await flow.sendDigests();
  const d = to('gc@test.es');
  assert.equal(d.length, 1);
  assert.match(d[0].subject, /Grupo de Conexión/);
  assert.match(d[0].html, /Ana Ruiz/);
});

test('cuando la persona ya está en un GC según Planning Center deja de estar pendiente de un voluntario de GC', async () => {
  reset(); course = { bases1: true, bases2: true, gc: true };
  await flow.recheckPending();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM applications WHERE needs_gc = 1').get().n, 0);
  reset();
  await flow.sendDigests();
  assert.equal(to('gc@test.es').length, 0);
});

test('pasa a lista para el líder cuando completa Bases 1, Bases 2 y GC; mientras falte algo sigue pendiente', async () => {
  reset(); course = { bases1: true, bases2: false, gc: false };
  const id = apply();
  await flow.process(id);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'pendiente_bases');
  reset(); course = { bases1: true, bases2: true, gc: false };
  assert.equal(await flow.recheckPending() >= 0, true);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'pendiente_bases', 'con Bases 2 pero sin GC todavía no');
  assert.equal(db.prepare('SELECT needs_bases n FROM applications WHERE id = ?').get(id).n, 0, 'ya no necesita voluntario de Bases');
  assert.equal(to('lider@test.es').length, 0);
  reset(); course = { bases1: true, bases2: true, gc: true };
  assert.ok((await flow.recheckPending()) >= 1);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'listo');
  assert.ok(to('lider@test.es').length >= 1);
  assert.equal(db.prepare('SELECT needs_gc n FROM applications WHERE id = ?').get(id).n, 0);
});

test('quien acaba Bases 1 después recibe un voluntario de GC (y se le avisa)', async () => {
  reset(); course = { bases1: false, bases2: false, gc: false };
  const id = apply();
  await flow.process(id);
  assert.equal(db.prepare('SELECT gc_user_id g FROM applications WHERE id = ?').get(id).g, null, 'sin Bases 1 todavía no toca GC');
  reset(); course = { bases1: true, bases2: false, gc: false };
  await flow.recheckPending();
  assert.ok(db.prepare('SELECT gc_user_id g FROM applications WHERE id = ?').get(id).g, 'ya toca GC');
  assert.ok(to('gc@test.es').length + to('gca@test.es').length + to('gcb@test.es').length >= 1, 'el voluntario recibe el aviso');
  reset();
  await flow.recheckPending(); // no se repite el aviso
  assert.equal(to('gc@test.es').length, 0);
});

test('el voluntario de Bases solo ve a quien le falta Bases; el de GC, a quien le falta GC', async () => {
  const c = Number(db.prepare("INSERT INTO cities (name) VALUES ('Alcance')").run().lastInsertRowid);
  const t = Number(db.prepare("INSERT INTO teams (name) VALUES ('Alcance equipo')").run().lastInsertRowid);
  const b = user('b-alcance@test.es', 'bases', [c]);
  const g = user('g-alcance@test.es', 'gc', [c]);
  const f = createFlow({ pco: { findPerson: async () => person, getCourseStatus: async () => course, addNote: async () => {} }, mail: { sendMail: async (m) => sent.push(m) } });
  reset();
  const mk = (name, cs) => { course = cs; const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES (?,?,?,?,?,24)`).run(name, `${name}@x.es`, '600111222', c, t).lastInsertRowid); return f.process(id); };
  await mk('FaltaBases', { bases1: true, bases2: false, gc: true });
  await mk('FaltaSoloGC', { bases1: true, bases2: true, gc: false });
  await f.sendDigests();
  const dB = to('b-alcance@test.es')[0].html;
  const dG = to('g-alcance@test.es')[0].html;
  assert.match(dB, /FaltaBases/);
  assert.doesNotMatch(dB, /FaltaSoloGC/);
  assert.match(dG, /FaltaSoloGC/);
  assert.doesNotMatch(dG, /FaltaBases/);
  assert.ok(b && g);
});

// ---------- Listado opcional para el líder: interesados que aún no tienen Bases 1, Bases 2 o GC ----------
test('el líder recibe un listado aparte (opcional) con lo que le falta a cada interesado', async () => {
  // Base limpia de ciudad para no mezclar con los otros tests
  const c = Number(db.prepare("INSERT INTO cities (name) VALUES ('Listado')").run().lastInsertRowid);
  const t = Number(db.prepare("INSERT INTO teams (name) VALUES ('Sonido')").run().lastInsertRowid);
  const l = user('lider-listado@test.es', 'leader', [c]);
  db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(l, t);
  const nueva = (name, self = {}) => Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,self_bases1,self_bases2,self_gc)
    VALUES (?,?,?,?,?,24,?,?,?)`).run(name, `${name.toLowerCase().replace(/\W/g, '')}@x.es`, '600111222', c, t, +!!self.b1, +!!self.b2, +!!self.gc).lastInsertRowid);

  const nada = nueva('Nada Nadal');            // no tiene nada
  const soloB1 = nueva('Solo Uno');            // solo Bases 1
  const b1gc = nueva('Uno Gece', { gc: true }); // Bases 1 en PCO + dice tener GC
  const listo = nueva('Listo Sin Gece');       // Bases 1 y 2, sin GC → aún no se le pide al líder que llame: va al listado opcional
  const sinFicha = nueva('Sin Ficha');         // no existe en Planning Center
  const todo = nueva('Lo Tiene Todo');         // completo
  const tenure = nueva('Sin Tiempo');          // aún sin antigüedad: no entra en ninguna lista

  const por = { [nada]: { bases1: false, bases2: false, gc: false }, [soloB1]: { bases1: true, bases2: false, gc: false }, [b1gc]: { bases1: true, bases2: false, gc: false },
    [listo]: { bases1: true, bases2: true, gc: false }, [todo]: { bases1: true, bases2: true, gc: true } };
  const fx = createFlow({
    pco: { findPerson: async () => person, getCourseStatus: async () => course, addNote: async () => {} },
    mail: { sendMail: async (m) => sent.push(m) },
  });
  reset();
  for (const id of [nada, soloB1, b1gc, listo, todo]) { course = por[id]; person = { id: String(id), url: `https://pco/${id}` }; await fx.process(id); }
  person = null; await fx.process(sinFicha);
  db.prepare("UPDATE applications SET status = 'no_apto_aun' WHERE id = ?").run(tenure);

  reset();
  await fx.sendDigests();
  const mails = to('lider-listado@test.es');
  assert.equal(mails.length, 1, 'un solo email por equipo');
  const html = mails[0].html;
  const [antes, pendientes] = html.split('Interesados que aún no tienen Bases 1, Bases 2 o GC');
  assert.ok(pendientes, 'existe el listado aparte');
  // Lista de llamar: solo quien ya tiene Bases 1 y 2 (con la nota de que aún no tiene GC, si es el caso)
  assert.match(antes, /Llamar esta semana/);
  assert.match(antes, /Lo Tiene Todo/);
  assert.doesNotMatch(antes, /Le falta/, 'quien lo tiene todo no lleva nota');
  assert.doesNotMatch(antes, /Nada Nadal|Solo Uno|Uno Gece|Sin Ficha|Listo Sin Gece/);
  // Listado opcional
  assert.match(pendientes, /seguimiento opcional/);
  assert.match(pendientes, /Es opcional/);
  assert.match(pendientes, /Nada Nadal[^]*?Le falta: Bases 1, Bases 2 y GC/);
  assert.match(pendientes, /Solo Uno[^]*?Le falta: Bases 2 y GC/);
  assert.match(pendientes, /Uno Gece[^]*?Le falta: Bases 2\b(?! y GC)/, 'lo que dijo tener (GC) cuenta como hecho');
  assert.match(pendientes, /Sin Ficha[^]*?no tiene ficha en Planning Center/);
  assert.match(pendientes, /Listo Sin Gece[^]*?Le falta: GC/, 'con Bases 1 y 2 pero sin GC: va al listado opcional, no a «Llamar»');
  assert.doesNotMatch(pendientes, /Lo Tiene Todo|Sin Tiempo/);
});

test('quien no tenía ficha y volvió a apuntarse no sale dos veces en el listado', async () => {
  const c = db.prepare("SELECT id FROM cities WHERE name = 'Listado'").get().id;
  const t = db.prepare("SELECT id FROM teams WHERE name = 'Sonido'").get().id;
  const ins = (status) => Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status) VALUES ('Vuelve Otra Vez','vuelve@x.es','600111222',?,?,24,?)`).run(c, t, status).lastInsertRowid);
  const vieja = ins('sin_pco');
  const nueva = ins('listo');
  reset();
  await createFlow({ pco: {}, mail: { sendMail: async (m) => sent.push(m) } }).sendDigests();
  const html = to('lider-listado@test.es')[0].html;
  const [antes, pendientes] = html.split('Interesados que aún no tienen Bases 1, Bases 2 o GC');
  assert.match(antes, /Vuelve Otra Vez/, 'sale en la lista de llamar');
  assert.doesNotMatch(pendientes || '', /Vuelve Otra Vez/, 'y ya no como «sin ficha»');
  assert.ok(vieja < nueva);
});

test('si nadie está pendiente, el email no incluye el listado opcional', async () => {
  const c = Number(db.prepare("INSERT INTO cities (name) VALUES ('Solo llamar')").run().lastInsertRowid);
  const t = Number(db.prepare("INSERT INTO teams (name) VALUES ('Video')").run().lastInsertRowid);
  const l = user('lider-solo@test.es', 'leader', [c]);
  db.prepare('INSERT INTO leader_teams VALUES (?,?)').run(l, t);
  db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status) VALUES ('Solo Llamar','sl@x.es','600111222',?,?,24,'listo')`).run(c, t);
  reset();
  await flow.sendDigests();
  const html = to('lider-solo@test.es')[0].html;
  assert.match(html, /Llamar esta semana/);
  assert.doesNotMatch(html, /seguimiento opcional/);
});
