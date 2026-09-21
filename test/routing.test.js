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
  [1, 1, 0, false, true, true, 'Bases 1 y Bases 2 → voluntario de GC (y el líder ya puede llamar)'],
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
  });
}

test('lo que la persona declara en el formulario cuenta como hecho para el reparto', async () => {
  reset(); course = { bases1: false, bases2: false, gc: false };
  const id = apply({ b1: true, b2: true }); // dice Bases 1 y 2, en PCO no consta → líder + GC, sin Bases
  await flow.process(id);
  assert.equal(to('bases@test.es').length, 0);
  assert.equal(to('gc@test.es').length, 1);
  assert.equal(to('lider@test.es').length, 1);
  assert.match(to('lider@test.es')[0].html, /Dato sin verificar/);
});

test('el email al líder avisa si todavía no está en un GC, y el de la persona lo promete solo si hay voluntario', async () => {
  reset(); course = { bases1: true, bases2: true, gc: false };
  await flow.process(apply());
  assert.match(to('lider@test.es')[0].html, /Todavía no está en un Grupo de Conexión/);
  assert.match(to('ana@x.es')[0].html, /voluntario de GC te llamará/);
  reset();
  await flow.process(apply({}, empty)); // ciudad sin voluntarios
  assert.doesNotMatch(to('ana@x.es')[0].html, /voluntario de GC te llamará/);
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

test('pasa de Bases pendiente a lista para el líder al completar Bases 2 (y sigue esperando GC)', async () => {
  reset(); course = { bases1: true, bases2: false, gc: false };
  const id = apply();
  await flow.process(id);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'pendiente_bases');
  reset(); course = { bases1: true, bases2: true, gc: false };
  assert.ok((await flow.recheckPending()) >= 1);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'listo');
  assert.ok(to('lider@test.es').length >= 1);
  assert.equal(db.prepare('SELECT needs_gc FROM applications WHERE id = ?').get(id).needs_gc, 1);
});
