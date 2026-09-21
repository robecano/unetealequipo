const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-em-')), 'test.db');
process.env.SESSION_SECRET = 'e'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@test.es';

const { db } = require('../src/db');
const et = require('../src/email-templates');
const emails = require('../src/emails');
const { createFlow } = require('../src/flow');
const { digestSchedule } = require('../src/jobs');
const { app } = require('../server');

const person = { name: 'Ana <b>Ruiz</b>', email: 'ana@x.es', phone: '+34 600 111 222', city: 'Madrid', team: 'Cafetería' };

test('los textos originales generan los emails de siempre', () => {
  const ready = emails.applicantEmail({ app: person, team: { name: 'Cafetería' }, missing: [] });
  assert.equal(ready.subject, 'Tu solicitud para servir en Cafetería');
  assert.match(ready.html, /Hola Ana, gracias por querer servir en <b>Cafetería<\/b>/);
  assert.match(ready.html, /te llamará esta semana y te invitará a visitar el equipo el próximo domingo/);
  const miss = emails.applicantEmail({ app: person, team: { name: 'X' }, missing: ['bases2', 'gc'], assign: { bases: true, gc: false } });
  assert.match(miss.html, /Un voluntario de Bases de tu ciudad/);
  assert.doesNotMatch(miss.html, /voluntario de Grupos de Conexión de tu ciudad/);
  assert.match(miss.html, /hillsong\.es\/bases\b/);
  assert.match(miss.html, /hillsong\.es\/gc\b/);
  const lead = emails.leaderReadyEmail({ app: person, team: { name: 'Cafetería' } });
  assert.equal(lead.subject, 'Para llamar esta semana: Ana <b>Ruiz</b> (Cafetería)');
  assert.match(lead.html, /esta semana/);
  assert.match(lead.text, /600 111 222/);
});

test('el texto del usuario se escapa: no se puede inyectar HTML ni scripts', () => {
  const m = emails.leaderReadyEmail({ app: { ...person, name: '<script>alert(1)</script>' }, team: { name: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(m.html, /<script>/);
  assert.doesNotMatch(m.html, /<img src=x/);
  assert.match(m.html, /&lt;script&gt;/);
  // lo que escribe el admin en el cuerpo también se escapa
  const r = et.render('applicant_ready', { vars: { nombre: 'Ana', equipo: 'X' } }, { subject: 's', heading: 'h', body: 'Hola <script>x()</script> **negrita** _cursiva_ [web](https://ejemplo.es) https://otra.es' });
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /<b>negrita<\/b>/);
  assert.match(r.html, /<i>cursiva<\/i>/);
  assert.match(r.html, /<a href="https:\/\/ejemplo\.es"[^>]*>web<\/a>/);
  assert.match(r.html, /<a href="https:\/\/otra\.es"[^>]*>https:\/\/otra\.es<\/a>/);
  // un enlace javascript: no se convierte en enlace
  const j = et.render('applicant_ready', { vars: {} }, { subject: 's', heading: 'h', body: '[clic](javascript:alert(1))' });
  assert.doesNotMatch(j.html, /href="javascript/);
});

test('condicionales y botones', () => {
  const b = (flags, url = 'https://x.es') => et.render('applicant_ready', { vars: { nombre: 'Ana' }, flags }, { subject: 's', heading: 'h', body: `Hola {{nombre}}.{{#gc}} Con GC.{{/gc}}\n\n[[Ir|${url}]]` }).html;
  assert.match(b({ gc: true }), /Hola Ana\. Con GC\./);
  assert.doesNotMatch(b({ gc: false }), /Con GC/);
  assert.match(b({}), /<a href="https:\/\/x\.es"[^>]*>Ir<\/a>/);
  assert.doesNotMatch(b({}, 'javascript:alert(1)'), /javascript/);
});

test('validación: marcadores desconocidos, imprescindibles, bloques y condicionales', () => {
  const ok = { subject: 'Hola {{nombre}}', heading: 'T', body: 'Persona:\n\n{{persona}}\n\n{{sin_verificar}}' };
  assert.deepEqual(et.validate('leader_ready', ok), []);
  assert.match(et.validate('leader_ready', { ...ok, body: 'Sin datos de la persona' }).join(' '), /Falta \{\{persona\}\}/);
  assert.match(et.validate('leader_ready', { ...ok, body: ok.body + '\n\n{{inventado}}' }).join(' '), /\{\{inventado\}\} no existe/);
  assert.match(et.validate('leader_ready', { ...ok, body: 'Mira {{persona}} aquí' }).join(' '), /debe ir solo/);
  assert.match(et.validate('leader_ready', { ...ok, body: ok.body + '\n\n{{#sin_gc}}abierto' }).join(' '), /Falta cerrar/);
  assert.match(et.validate('leader_ready', { ...ok, body: ok.body + '\n\n{{#raro}}x{{/raro}}' }).join(' '), /no existe/);
  assert.match(et.validate('leader_ready', { ...ok, body: ok.body + '\n\n[[Ir|ftp://mal]]' }).join(' '), /enlace no válido/);
  assert.match(et.validate('leader_ready', { ...ok, subject: '' }).join(' '), /asunto/);
  // los textos originales siempre son válidos
  for (const [key, t] of Object.entries(et.TEMPLATES)) assert.deepEqual(et.validate(key, t), [], `original de ${key}`);
});

let server, base;
const cookies = {};
const J = { 'Content-Type': 'application/json' };
const req = (who, method, url, body) => fetch(base + url, { method, headers: { ...J, ...(cookies[who] ? { Cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (who, email, pw) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ email, password: pw }) }); assert.equal(r.status, 200); cookies[who] = r.headers.get('set-cookie').split(';')[0]; };
test.before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await login('admin', 'admin-test-placeholder'.slice(0, 0) + 'admin@test.es', 'admin-pass');
  const city = Number(db.prepare("INSERT INTO cities (name) VALUES ('Madrid')").run().lastInsertRowid);
  for (const [email, role] of [['lider@test.es', 'leader'], ['gc@test.es', 'gc']]) {
    const id = Number(db.prepare('INSERT INTO users (email, role) VALUES (?,?)').run(email, role).lastInsertRowid);
    db.prepare('INSERT INTO user_cities VALUES (?,?)').run(id, city);
    await login(role, email, 'HillsongEspana');
  }
});
test.after(() => server.close());

test('solo el administrador ve y edita los emails', async () => {
  for (const who of ['leader', 'gc']) {
    assert.equal((await req(who, 'GET', '/api/panel/admin/emails')).status, 403);
    assert.equal((await req(who, 'PUT', '/api/panel/admin/emails/leader_ready', {})).status, 403);
    assert.equal((await req(who, 'PUT', '/api/panel/admin/email-schedule', { day: 2, hour: 9 })).status, 403);
  }
  assert.equal((await fetch(base + '/api/panel/admin/emails')).status, 401);
  const data = await (await req('admin', 'GET', '/api/panel/admin/emails')).json();
  assert.equal(data.templates.length, Object.keys(et.TEMPLATES).length);
  assert.deepEqual(Object.keys(data.groups), ['persona', 'lider', 'bases', 'gc']);
});

test('guardar un email: se valida, se usa al enviar y se puede restaurar', async () => {
  const good = { subject: 'AVISO {{nombre_completo}}', heading: 'Nuevo título', body: 'Llama a esta persona:\n\n{{persona}}\n\nGracias.', enabled: true };
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/emails/leader_ready', { ...good, body: 'sin la persona' })).status, 400);
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/emails/no_existe', good)).status, 404);
  const saved = await (await req('admin', 'PUT', '/api/panel/admin/emails/leader_ready', good)).json();
  assert.equal(saved.customized, true);
  assert.equal(saved.updated_by, 'admin@test.es');
  const m = emails.leaderReadyEmail({ app: person, team: { name: 'X' } });
  assert.equal(m.subject, 'AVISO Ana <b>Ruiz</b>');
  assert.match(m.html, /Nuevo título/);
  assert.match(m.html, /Llama a esta persona/);
  // restaurar
  const back = await (await req('admin', 'DELETE', '/api/panel/admin/emails/leader_ready')).json();
  assert.equal(back.customized, false);
  assert.match(emails.leaderReadyEmail({ app: person, team: { name: 'X' } }).subject, /^Para llamar esta semana/);
});

test('un email desactivado no se envía, y queda anotado', async () => {
  await req('admin', 'PUT', '/api/panel/admin/emails/applicant_ready', { ...et.TEMPLATES.applicant_ready, enabled: false });
  const sent = [];
  const flow = createFlow({ pco: { findPerson: async () => ({ id: '1' }), getCourseStatus: async () => ({ bases1: true, bases2: true, gc: true }), addNote: async () => {} }, mail: { sendMail: async (m) => sent.push(m) } });
  const city = db.prepare('SELECT id FROM cities LIMIT 1').get().id;
  const team = Number(db.prepare("INSERT INTO teams (name) VALUES ('T')").run().lastInsertRowid);
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES ('Ana','ana@x.es','600111222',?,?,24)`).run(city, team).lastInsertRowid);
  await flow.process(id);
  assert.equal(sent.filter((m) => [].concat(m.to).includes('ana@x.es')).length, 0);
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'email_desactivado'").get(id));
  await req('admin', 'DELETE', '/api/panel/admin/emails/applicant_ready');
});

test('vista previa: documento propio con su CSP, embebible solo desde la misma web, y sin ejecutar HTML del admin', async () => {
  const body = new URLSearchParams({ subject: 'Asunto <b>x</b>', heading: 'T', body: 'Hola {{nombre}} <script>alert(1)</script>' });
  const r = await fetch(base + '/api/panel/admin/emails/applicant_ready/preview', { method: 'POST', headers: { Cookie: cookies.admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  const html = await r.text();
  assert.match(html, /Hola Ana/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Asunto:<\/b> Asunto &lt;b&gt;x&lt;\/b&gt;/);
  const noAdmin = await fetch(base + '/api/panel/admin/emails/applicant_ready/preview', { method: 'POST', headers: { Cookie: cookies.leader, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(noAdmin.status, 403);
  const malo = await fetch(base + '/api/panel/admin/emails/leader_ready/preview', { method: 'POST', headers: { Cookie: cookies.admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ subject: 's', heading: 'h', body: 'sin persona' }) });
  assert.match(await malo.text(), /No se puede previsualizar/);
});

test('email de prueba: solo al propio administrador y sin SMTP no envía nada', async () => {
  const r = await req('admin', 'POST', '/api/panel/admin/emails/gc_assigned/test', { ...et.TEMPLATES.gc_assigned });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.to, 'admin@test.es');
  assert.equal(out.sent, false);
  assert.equal((await req('admin', 'POST', '/api/panel/admin/emails/gc_assigned/test', { subject: 's', heading: 'h', body: 'sin lista' })).status, 400);
});

test('el horario del resumen se guarda, se valida y lo usa el planificador', async () => {
  assert.deepEqual(digestSchedule(), { day: 1, hour: 8 }, 'por defecto: lunes 8:00');
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/email-schedule', { day: 9, hour: 8 })).status, 400);
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/email-schedule', { day: 2, hour: 25 })).status, 400);
  const r = await (await req('admin', 'PUT', '/api/panel/admin/email-schedule', { day: 5, hour: 18 })).json();
  assert.deepEqual([r.day, r.hour], [5, 18]);
  assert.deepEqual(digestSchedule(), { day: 5, hour: 18 });
  assert.deepEqual((await (await req('admin', 'GET', '/api/panel/admin/emails')).json()).schedule.day, 5);
});

test('el voluntario de GC solo ve a quien necesita un GC en sus ciudades, y no puede borrar ni cambiar el estado del líder', async () => {
  const city = db.prepare('SELECT id FROM cities LIMIT 1').get().id;
  const team = db.prepare('SELECT id FROM teams LIMIT 1').get().id;
  const mk = (name, needsGc, cityId = city) => Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months,status,needs_gc) VALUES (?,?,?,?,?,24,'listo',?)`).run(name, `${name}@x.es`, '600111222', cityId, team, needsGc).lastInsertRowid);
  const otra = Number(db.prepare("INSERT INTO cities (name) VALUES ('Otra')").run().lastInsertRowid);
  const si = mk('NecesitaGC', 1), no = mk('YaTieneGC', 0), lejos = mk('OtraCiudad', 1, otra);
  const rows = await (await req('gc', 'GET', '/api/panel/applications')).json();
  const nombres = rows.map((r) => r.name);
  assert.ok(nombres.includes('NecesitaGC'));
  assert.ok(!nombres.includes('YaTieneGC') && !nombres.includes('OtraCiudad'));
  assert.equal((await req('gc', 'PATCH', `/api/panel/applications/${si}`, { gc_status: 'contactado' })).status, 200);
  assert.equal(db.prepare('SELECT gc_status s FROM applications WHERE id = ?').get(si).s, 'contactado');
  assert.equal((await req('gc', 'PATCH', `/api/panel/applications/${si}`, { gc_status: 'inventado' })).status, 400);
  assert.equal((await req('gc', 'PATCH', `/api/panel/applications/${si}`, { status: 'confirmado' })).status, 403);
  assert.equal((await req('gc', 'DELETE', `/api/panel/applications/${si}`)).status, 403);
  assert.equal((await req('gc', 'PATCH', `/api/panel/applications/${lejos}`, { gc_status: 'contactado' })).status, 404);
  const csv = await (await req('admin', 'GET', '/api/panel/applications.csv?q=NecesitaGC')).text();
  assert.match(csv, /Voluntario GC;Email voluntario GC;Teléfono voluntario GC;Estado en GC/);
});

test('el admin puede dar de alta a un voluntario de GC con teléfono', async () => {
  const r = await req('admin', 'POST', '/api/panel/admin/users', { email: 'nuevo-gc@test.es', name: 'Gabi GC', role: 'gc', phone: '+34 655 444 333', city_ids: [db.prepare('SELECT id FROM cities LIMIT 1').get().id] });
  assert.equal(r.status, 200);
  const u = db.prepare("SELECT role, phone FROM users WHERE email = 'nuevo-gc@test.es'").get();
  assert.deepEqual([u.role, u.phone], ['gc', '+34 655 444 333']);
});
