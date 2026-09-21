const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ute-ar-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.SESSION_SECRET = 'z'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';

// Base "antigua" (antes de las áreas): nombre único global y sin parent_id, con datos que hay que conservar
{
  const old = new DatabaseSync(process.env.DB_PATH);
  old.exec(`
    CREATE TABLE teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', min_months INTEGER NOT NULL DEFAULT 0, notice TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
    INSERT INTO teams (name, description, min_months) VALUES ('Antiguo', 'de antes', 6);`);
  old.close();
}

const { db } = require('../src/db');
const { seed, AREAS } = require('../scripts/seed-equipos');
const { publicTree, findSelectable } = require('../src/teams');
const { app } = require('../server');

test('la migración conserva los equipos antiguos y permite nombres repetidos entre área y subequipo', () => {
  const old = db.prepare("SELECT * FROM teams WHERE name = 'Antiguo'").get();
  assert.equal(old.description, 'de antes');
  assert.equal(old.min_months, 6);
  assert.equal(old.parent_id, null);
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('teams') WHERE name = 'parent_id'").get());
});

test('el seed crea las 12 áreas y todos los subequipos, y es idempotente', () => {
  const first = seed({ cities: true });
  const subs = AREAS.reduce((n, a) => n + a.teams.length, 0);
  assert.equal(first, AREAS.length + subs);
  assert.equal(AREAS.length, 12);
  assert.equal(seed(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM teams WHERE parent_id IS NULL AND name != ?').get('Antiguo').n, 12);
  // "Kids" existe como área y como subequipo sin chocar
  assert.equal(db.prepare("SELECT COUNT(*) n FROM teams WHERE name = 'Kids'").get().n, 2);
});

test('no pisa lo que se haya editado en el panel', () => {
  db.prepare("UPDATE teams SET description = 'editada', icon = '🔥' WHERE parent_id IS NULL AND name = 'IT'").run();
  seed();
  const it = db.prepare("SELECT * FROM teams WHERE parent_id IS NULL AND name = 'IT'").get();
  assert.equal(it.description, 'editada');
  assert.equal(it.icon, '🔥');
});

test('el árbol público lista áreas con sus subequipos; un área sin subequipos cuenta como equipo', () => {
  const tree = publicTree();
  const kids = tree.find((a) => a.name === 'Kids');
  assert.deepEqual(kids.teams.map((t) => t.name), ['Sala de Familias', 'Kids', 'Voltage']);
  assert.equal(kids.teams[0].min_months, 12);
  const solo = tree.find((a) => a.name === 'Antiguo');
  assert.equal(solo.teams.length, 1);
  assert.equal(solo.teams[0].id, solo.id);
});

test('solo se pueden elegir subequipos (o áreas sin subequipos), no las áreas que los agrupan', () => {
  const area = db.prepare("SELECT id FROM teams WHERE parent_id IS NULL AND name = 'Creativos'").get().id;
  const sub = db.prepare('SELECT id FROM teams WHERE parent_id = ? AND name = ?').get(area, 'Alabanza').id;
  assert.equal(findSelectable(area), undefined);
  assert.equal(findSelectable(sub).name, 'Alabanza');
  db.prepare('UPDATE teams SET active = 0 WHERE id = ?').run(sub);
  assert.equal(findSelectable(sub), undefined);
  db.prepare('UPDATE teams SET active = 1 WHERE id = ?').run(sub);
  // si se oculta el área, sus subequipos dejan de poder elegirse
  db.prepare('UPDATE teams SET active = 0 WHERE id = ?').run(area);
  assert.equal(findSelectable(sub), undefined);
  db.prepare('UPDATE teams SET active = 1 WHERE id = ?').run(area);
});

let server, base, cookie;
test.before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.es', password: 'admin-pass' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());
const post = (p, body, method = 'POST') => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

test('el formulario rechaza un área con subequipos y acepta un subequipo', async () => {
  const pub = await (await fetch(base + '/api/public')).json();
  const city = pub.cities[0].id;
  const creativos = pub.areas.find((a) => a.name === 'Creativos');
  const form = (team_id) => post('/api/apply', { name: 'Ana Ruiz', email: `a${team_id}@x.es`, phone: '600111222', city_id: city, team_id, tenure: '24' });
  assert.equal((await form(creativos.id)).status, 400);
  assert.equal((await form(creativos.teams[0].id)).status, 200);
});

test('el admin crea subequipos, no puede anidar más de un nivel y los nombres se repiten solo entre áreas distintas', async () => {
  const area = (await (await fetch(base + '/api/public')).json()).areas.find((a) => a.name === 'Kids').id;
  assert.equal((await post('/api/panel/admin/teams', { name: 'Nuevo', parent_id: area })).status, 200);
  assert.equal((await post('/api/panel/admin/teams', { name: 'Nuevo', parent_id: area })).status, 400); // repetido en la misma área
  const sub = db.prepare("SELECT id FROM teams WHERE name = 'Nuevo'").get().id;
  assert.equal((await post('/api/panel/admin/teams', { name: 'Anidado', parent_id: sub })).status, 400); // colgar de un subequipo
  assert.equal((await post(`/api/panel/admin/teams/${area}`, { name: 'Kids', parent_id: area }, 'PUT')).status, 400); // de sí mismo
  assert.equal((await post('/api/panel/admin/teams', { name: 'Kids', description: 'otra área con el mismo nombre en otro sitio', parent_id: db.prepare("SELECT id FROM teams WHERE name='IT' AND parent_id IS NULL").get().id })).status, 200);
});

test('las imágenes de las áreas incluidas en el proyecto se aceptan al editar', async () => {
  const conex = db.prepare("SELECT * FROM teams WHERE name = 'Conexiones' AND parent_id IS NULL").get();
  assert.equal(conex.image_url, '/img/areas/conexiones.jpg');
  const r = await post(`/api/panel/admin/teams/${conex.id}`, { name: 'Conexiones', description: conex.description, icon: conex.icon, image_url: conex.image_url, min_months: 0, sort: 4, active: true }, 'PUT');
  assert.equal(r.status, 200);
  const img = await fetch(base + '/img/areas/conexiones.jpg');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
});

test('todas las áreas tienen su foto y el archivo existe en el proyecto', () => {
  const root = path.join(__dirname, '..', 'public');
  const conFoto = AREAS.filter((a) => a.image);
  assert.equal(conFoto.length, 12);
  for (const a of conFoto) assert.ok(fs.existsSync(path.join(root, a.image)), `falta ${a.image}`);
});

test('el seed rellena la foto de un área que no la tenía, sin pisar una ya elegida', () => {
  db.prepare("UPDATE teams SET image_url = '' WHERE parent_id IS NULL AND name = 'Kids'").run();
  db.prepare("UPDATE teams SET image_url = '/uploads/mia.png' WHERE parent_id IS NULL AND name = 'Sisterhood'").run();
  seed();
  assert.equal(db.prepare("SELECT image_url u FROM teams WHERE parent_id IS NULL AND name = 'Kids'").get().u, '/img/areas/kids.jpg');
  assert.equal(db.prepare("SELECT image_url u FROM teams WHERE parent_id IS NULL AND name = 'Sisterhood'").get().u, '/uploads/mia.png');
});

test('el aviso de organización aparece en Comunidades, Sisterhood, Jóvenes, CityCare y Formaciones, y llega a sus subequipos y al email', async () => {
  const tree = publicTree();
  for (const n of ['Comunidades', 'Sisterhood', 'Jóvenes', 'CityCare', 'Formaciones']) {
    const a = tree.find((x) => x.name === n);
    assert.match(a.notice, /^El servicio en esta área sería ayudando en el equipo de organización y gestión de las actividades y eventos\.$/, n);
    assert.equal(a.teams[0].area_notice, a.notice);
  }
  for (const n of ['Kids', 'Domingo', 'IT']) assert.equal(tree.find((x) => x.name === n).notice, '');
  const { fullApp } = require('../src/flow');
  const emails = require('../src/emails');
  const men = db.prepare("SELECT id FROM teams WHERE name = 'Men'").get().id;
  const city = db.prepare('SELECT id FROM cities LIMIT 1').get().id;
  const id = Number(db.prepare("INSERT INTO applications (name,email,phone,city_id,team_id) VALUES ('Luis','l@x.es','600111222',?,?)").run(city, men).lastInsertRowid);
  const a = fullApp(id);
  assert.match(a.area_notice, /organización y gestión/);
  const mail = emails.applicantEmail({ app: a, team: { name: a.team_name, notice: a.team_notice }, missing: [] });
  assert.match(mail.html, /organización y gestión de las actividades y eventos/);
  const kids = db.prepare("SELECT id FROM teams WHERE name = 'Voltage'").get().id;
  const id2 = Number(db.prepare("INSERT INTO applications (name,email,phone,city_id,team_id) VALUES ('Eva','e@x.es','600111222',?,?)").run(city, kids).lastInsertRowid);
  assert.ok(!fullApp(id2).area_notice);
});
