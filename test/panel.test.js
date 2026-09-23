const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-pn-')), 'test.db');
process.env.SESSION_SECRET = 'w'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';

const { db } = require('../src/db');
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

test('borrar: el admin puede, y el líder solo lo suyo (su equipo y su ciudad)', async () => {
  const mine = apply('Mia Propia', teamA);
  const ajena = apply('Otro Equipo', teamB);
  const otraCiudad = apply('Otra Ciudad', teamA, { city: other });
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${ajena}`)).status, 404);
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${otraCiudad}`)).status, 404);
  assert.ok(db.prepare('SELECT 1 FROM applications WHERE id = ?').get(ajena));
  assert.equal((await req('leader', 'DELETE', `/api/panel/applications/${mine}`)).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM applications WHERE id = ?').get(mine), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM application_events WHERE application_id = ?').get(mine).n, 0, 'el historial se borra en cascada');
  assert.equal((await req('admin', 'DELETE', `/api/panel/applications/${ajena}`)).status, 200);
  assert.equal((await req('admin', 'DELETE', `/api/panel/applications/${ajena}`)).status, 404, 'ya no existe');
  const sinSesion = await fetch(base + `/api/panel/applications/${otraCiudad}`, { method: 'DELETE' });
  assert.equal(sinSesion.status, 401);
});

test('el líder puede marcar el estado de una solicitud, pero no la de otro equipo o ciudad', async () => {
  const mine = apply('Para Contactar', teamA);
  const ajena = apply('No Es Mia', teamB);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${mine}`, { status: 'contactado' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(mine).status, 'contactado');
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${mine}`, { status: 'inventado' })).status, 400);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${ajena}`, { status: 'contactado' })).status, 404);
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

test('el orden de las columnas de cursos es B1, GC, B2 en el CSV (como en el panel), y llevan «Contrastado con PCO»', async () => {
  const id = apply('Orden Cursos', teamA, { pcoBases1: 1, pcoGc: 0, pcoBases2: 1, selfBases2: 0 });
  db.prepare('UPDATE applications SET self_bases1 = 1, self_gc = 0 WHERE id = ?').run(id);
  const [head, row] = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Orden')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const h = head.split(';'); const v = row.split(';');
  assert.deepEqual(h.slice(9, 17), ['Bases 1 (PCO)', 'GC (PCO)', 'Bases 2 (PCO)', 'Bases 1 (dijo)', 'GC (dijo)', 'Bases 2 (dijo)', 'Ficha Planning Center', 'Líder de equipo']);
  assert.deepEqual(v.slice(9, 15), ['Sí', 'No', 'Sí', 'Sí', 'No', 'No']);
  const i = h.indexOf('Contrastado con PCO');
  assert.ok(i > 0);
  assert.equal(v[i], 'Sí');
  const j = h.indexOf('Recordatorio');
  assert.ok(j > i, 'va después de Contrastado con PCO y su motivo');
  assert.match(v[j], /el paso que le falta/, 'le falta GC, aunque esté contrastado');
});

test('el administrador ve el líder de equipo asignado a cada persona (y si no hay, se le avisa); el líder no', async () => {
  const conLider = apply('Con Líder', teamA);          // teamA + city tiene a «Lía Líder»
  const sinLider = apply('Sin Líder', teamB);          // teamB no tiene ningún líder
  const rows = await (await req('admin', 'GET', '/api/panel/applications')).json();
  const a = rows.find((r) => r.id === conLider), b = rows.find((r) => r.id === sinLider);
  assert.deepEqual(a.leaders.map((l) => [l.name, l.email]), [['Lía Líder', 'lider@test.es']]);
  assert.deepEqual(b.leaders, []);
  // un líder desactivado no cuenta
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(leaderId);
  assert.deepEqual((await (await req('admin', 'GET', '/api/panel/applications')).json()).find((r) => r.id === conLider).leaders, []);
  db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(leaderId);
  // el líder no recibe ese dato para sus propias solicitudes
  const propios = await (await req('leader', 'GET', '/api/panel/applications')).json();
  assert.ok(propios.every((r) => r.leaders === undefined));
  // CSV: columna «Líder de equipo» solo para el administrador
  const csvAdmin = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=L%C3%ADder')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const head = csvAdmin[0].split(';');
  const i = head.indexOf('Líder de equipo');
  assert.ok(i > 0);
  const fila = (n) => csvAdmin.slice(1).find((l) => l.includes(n)).split(';');
  assert.equal(fila('Con Líder')[i], 'Lía Líder · 699 000 111');
  assert.equal(fila('Sin Líder')[i], 'Sin líder asignado');
  const csvLider = await (await req('leader', 'GET', '/api/panel/applications.csv')).text();
  assert.doesNotMatch(csvLider.split('\r\n')[0], /Líder de equipo/);
});

let basesId, gcId;
test('el admin da de alta a un líder de Bases y a uno de GC; no se les asignan equipos aunque se manden team_ids', async () => {
  const rb = await req('admin', 'POST', '/api/panel/admin/users', { email: 'bases@test.es', name: 'Bea Bases', role: 'bases', phone: '', city_ids: [city], team_ids: [teamA] });
  assert.equal(rb.status, 200);
  basesId = (await rb.json()).id;
  const rg = await req('admin', 'POST', '/api/panel/admin/users', { email: 'gc@test.es', name: 'Gabi GC', role: 'gc', phone: '', city_ids: [city] });
  assert.equal(rg.status, 200);
  gcId = (await rg.json()).id;
  const list = await (await req('admin', 'GET', '/api/panel/admin/users')).json();
  assert.equal(list.find((u) => u.email === 'bases@test.es').role, 'bases');
  assert.equal(list.find((u) => u.email === 'gc@test.es').role, 'gc');
  assert.deepEqual(list.find((u) => u.email === 'bases@test.es').team_ids, [], 'a Bases no se le asignan equipos aunque se hayan mandado team_ids');
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

test('Bases y GC no pueden cambiar el estado ni borrar (solo el líder de equipo y admin); comentar sí les deja', async () => {
  const id = apply('Toca Bases', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${id}`, { status: 'contactado' })).status, 403);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(id).status, 'listo', 'no cambió');
  assert.equal((await req('bases', 'PATCH', `/api/panel/applications/${id}`, { comment: 'La llamé, dice que ya se apuntó' })).status, 200);
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'comentario'").get(id));
  assert.equal((await req('bases', 'DELETE', `/api/panel/applications/${id}`)).status, 403);
  assert.ok(db.prepare('SELECT 1 FROM applications WHERE id = ?').get(id), 'sigue existiendo');
});

test('Bases y GC marcan si ya han llamado; el líder de equipo lo ve, y ni él ni admin pueden marcarlo por ellos', async () => {
  const id = apply('Marcar Llamada', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  assert.equal(db.prepare('SELECT bases_contacted_at FROM applications WHERE id = ?').get(id).bases_contacted_at, null);
  const r = await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contacted: true });
  assert.equal(r.status, 200);
  assert.ok(db.prepare('SELECT bases_contacted_at FROM applications WHERE id = ?').get(id).bases_contacted_at);
  // el líder de equipo (y admin) lo ven en su lista, sin haber hecho nada
  const rowsLeader = await (await req('leader', 'GET', '/api/panel/applications')).json();
  assert.ok(rowsLeader.find((x) => x.id === id).bases_contacted_at);
  // ni admin ni el líder de equipo pueden marcarlo por Bases o GC
  assert.equal((await req('admin', 'PATCH', `/api/panel/applications/${id}`, { contacted: true })).status, 403);
  assert.equal((await req('leader', 'PATCH', `/api/panel/applications/${id}`, { contacted: true })).status, 403);
  // se puede desmarcar
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contacted: false });
  assert.equal(db.prepare('SELECT bases_contacted_at FROM applications WHERE id = ?').get(id).bases_contacted_at, null);
});

test('CSV: columnas «Líder de Bases» y «Líder de GC», solo para admin, con «Sin líder asignado» si no hay', async () => {
  const id = apply('Con Ambos Roles', teamA, { pcoBases1: 0, pcoBases2: 0, pcoGc: 0 });
  const csvAdmin = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Con%20Ambos%20Roles')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const head = csvAdmin[0].split(';');
  const iBases = head.indexOf('Líder de Bases'), iGc = head.indexOf('Líder de GC');
  assert.ok(iBases > 0 && iGc > 0);
  const fila = csvAdmin[1].split(';');
  assert.equal(fila[iBases], 'Bea Bases');
  assert.equal(fila[iGc], '', 'no le toca a GC (sin Bases 1), así que va vacío');
  const csvLider = await (await req('leader', 'GET', '/api/panel/applications.csv')).text();
  assert.doesNotMatch(csvLider.split('\r\n')[0], /Líder de Bases|Líder de GC/);

  // «Le llamó Bases» / «Le llamó GC»: visibles para todos (también el líder de equipo), con la fecha si ya llamó
  const iLlamoBases = head.indexOf('Le llamó Bases'), iLlamoGc = head.indexOf('Le llamó GC');
  assert.ok(iLlamoBases > 0 && iLlamoGc > 0);
  assert.equal(fila[iLlamoBases], 'No');
  assert.equal(fila[iLlamoGc], 'No');
  await req('bases', 'PATCH', `/api/panel/applications/${id}`, { contacted: true });
  const filaLuego = (await (await req('admin', 'GET', '/api/panel/applications.csv?q=Con%20Ambos%20Roles')).text()).replace(/^﻿/, '').trim().split('\r\n')[1].split(';');
  assert.match(filaLuego[iLlamoBases], /^\d{2}\/\d{2}\/\d{4}/);
  const csvLiderLuego = (await (await req('leader', 'GET', '/api/panel/applications.csv?q=Con%20Ambos%20Roles')).text()).replace(/^﻿/, '').trim().split('\r\n');
  const headLider = csvLiderLuego[0].split(';');
  assert.match(csvLiderLuego[1].split(';')[headLider.indexOf('Le llamó Bases')], /^\d{2}\/\d{2}\/\d{4}/, 'el líder de equipo también lo ve, sin la columna de líderes');
});
