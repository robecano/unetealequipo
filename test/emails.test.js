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

const contrastadoOk = { ok: true, label: 'Sí' };
const contrastadoNo = { ok: false, label: 'No', guidance: 'Dice tener Bases 2, pero no consta en Planning Center. Contacta con el equipo de PCO de tu campus para corregirlo.', reminder: 'Recuerda que es importante que haga los pasos que le faltan antes de empezar a servir.' };
const person = { name: 'Ana <b>Ruiz</b>', email: 'ana@x.es', phone: '+34 600 111 222', city: 'Madrid', team: 'Cafetería', cursos: 'Bases 1: Sí · Bases 2: No · GC: Sí', contrastado: contrastadoNo };

test('email a la persona: recibida, con lo que consta o falta, y avisando de que el líder la contactará', () => {
  const found = emails.applicantEmail({ app: { name: 'Ana', city: 'Madrid' }, team: { name: 'Cafetería' }, missing: [] });
  assert.equal(found.subject, 'Tu solicitud para servir en Cafetería');
  assert.match(found.html, /Hola Ana, gracias por querer servir en <b>Cafetería<\/b>/);
  assert.match(found.html, /líder de tu equipo revisará tu solicitud y te contactará esta semana/);
  assert.doesNotMatch(found.html, /No hemos encontrado tu ficha/);

  const notFound = emails.applicantEmail({ app: { name: 'Ana', city: 'Madrid' }, team: { name: 'X' }, missing: [], notFoundInPco: true });
  assert.match(notFound.html, /No hemos encontrado tu ficha en nuestro sistema/);

  const missing = emails.applicantEmail({ app: { name: 'Ana', city: 'Madrid' }, team: { name: 'X' }, missing: ['bases2', 'gc'] });
  assert.match(missing.html, /Bases 2/);
  assert.match(missing.html, /hillsong\.es\/gc/);
});

test('tiempo mínimo insuficiente: no se avisa al líder, y el asunto/tono es distinto', () => {
  const m = emails.applicantEmail({ app: { name: 'Ana', city: 'Madrid' }, team: { name: 'Kids', notice: 'Se pide entrevista previa.' }, tenureShort: true });
  assert.equal(m.subject, 'Tu solicitud para servir en Kids');
  assert.match(m.html, /Para servir en este equipo necesitamos que lleves algo más de tiempo/);
  assert.match(m.html, /entrevista previa/);
});

test('resumen del líder: nuevas, seguimiento y resto solo aparecen si hay alguien, con los cursos y el contraste con PCO de cada uno', () => {
  const vacio = emails.leaderDigestEmail({ team: { name: 'Cafetería' }, nuevas: [], seguimiento: [], resto: [] });
  assert.doesNotMatch(vacio.html, /Nuevas desde el último resumen|Toca hacer seguimiento|Resto de tu lista/);
  const lleno = emails.leaderDigestEmail({ team: { name: 'Cafetería' }, nuevas: [person], seguimiento: [], resto: [{ ...person, name: 'Otra', contrastado: contrastadoOk }] });
  assert.match(lleno.html, /Nuevas desde el último resumen/);
  assert.doesNotMatch(lleno.html, /Toca hacer seguimiento/);
  assert.match(lleno.html, /Resto de tu lista/);
  assert.match(lleno.html, /Ana &lt;b&gt;Ruiz&lt;\/b&gt;/);
  assert.match(lleno.html, /Bases 1: Sí · Bases 2: No · GC: Sí/);
  assert.match(lleno.html, /Contrastado con PCO: No/);
  assert.match(lleno.html, /Contacta con el equipo de PCO de tu campus/);
  assert.match(lleno.html, /Recuerda que es importante que haga los pasos que le faltan antes de empezar a servir/);
  assert.match(lleno.html, /Otra/);
  assert.match(lleno.html, /Contrastado con PCO: Sí/);
});

test('el recordatorio aparece aunque esté contrastado, si de verdad le falta algo', () => {
  const contrastadoOkConFalta = { ok: true, label: 'Sí', reminder: 'Recuerda que es importante que haga el paso que le falta antes de empezar a servir.' };
  const m = emails.leaderDigestEmail({ team: { name: 'Cafetería' }, nuevas: [{ ...person, contrastado: contrastadoOkConFalta }], seguimiento: [], resto: [] });
  assert.match(m.html, /Contrastado con PCO: Sí/);
  assert.doesNotMatch(m.html, /⚠/, 'sin aviso de contraste: solo el recordatorio');
  assert.match(m.html, /Recuerda que es importante que haga el paso que le falta antes de empezar a servir/);
});

test('el texto del usuario se escapa: no se puede inyectar HTML ni scripts', () => {
  const m = emails.leaderDigestEmail({ team: { name: '<img src=x onerror=alert(1)>' }, nuevas: [{ ...person, name: '<script>alert(1)</script>' }], seguimiento: [], resto: [] });
  assert.doesNotMatch(m.html, /<script>/);
  assert.doesNotMatch(m.html, /<img src=x/);
  assert.match(m.html, /&lt;script&gt;/);
  // lo que escribe el admin en el cuerpo también se escapa
  const r = et.render('leader_digest', { vars: { equipo: 'X' }, blocks: { seccion_nuevas: 'x', seccion_seguimiento: 'x', seccion_resto: 'x' } }, { subject: 's', heading: 'h', body: 'Hola <script>x()</script> **negrita** _cursiva_ [web](https://ejemplo.es) https://otra.es\n\n{{seccion_nuevas}}' });
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /<b>negrita<\/b>/);
  assert.match(r.html, /<i>cursiva<\/i>/);
  assert.match(r.html, /<a href="https:\/\/ejemplo\.es"[^>]*>web<\/a>/);
  assert.match(r.html, /<a href="https:\/\/otra\.es"[^>]*>https:\/\/otra\.es<\/a>/);
  // un enlace javascript: no se convierte en enlace
  const j = et.render('leader_digest', { vars: {}, blocks: { seccion_nuevas: 'x', seccion_seguimiento: 'x', seccion_resto: 'x' } }, { subject: 's', heading: 'h', body: '[clic](javascript:alert(1))\n\n{{seccion_nuevas}}' });
  assert.doesNotMatch(j.html, /href="javascript/);
});

test('condicionales y botones', () => {
  const b = (flags, url = 'https://x.es') => et.render('applicant_received', { vars: { nombre: 'Ana' }, flags: { encontrado: false, no_encontrado: false, ...flags } }, { subject: 's', heading: 'h', body: `Hola {{nombre}}.{{#encontrado}} Con datos.{{/encontrado}}\n\n[[Ir|${url}]]` }).html;
  assert.match(b({ encontrado: true }), /Hola Ana\. Con datos\./);
  assert.doesNotMatch(b({ encontrado: false }), /Con datos/);
  assert.match(b({}), /<a href="https:\/\/x\.es"[^>]*>Ir<\/a>/);
  assert.doesNotMatch(b({}, 'javascript:alert(1)'), /javascript/);
});

test('validación: marcadores desconocidos, imprescindibles, bloques y condicionales', () => {
  const ok = { subject: 'Hola {{equipo}}', heading: 'T', body: 'Nuevas:\n\n{{seccion_nuevas}}\n\nSeguimiento:\n\n{{seccion_seguimiento}}\n\nResto:\n\n{{seccion_resto}}\n\n{{url_panel}}' };
  assert.deepEqual(et.validate('leader_digest', ok), []);
  assert.match(et.validate('leader_digest', { ...ok, body: 'Sin las secciones' }).join(' '), /Falta \{\{seccion_nuevas\}\}/);
  assert.match(et.validate('leader_digest', { ...ok, body: ok.body + '\n\n{{inventado}}' }).join(' '), /\{\{inventado\}\} no existe/);
  assert.match(et.validate('leader_digest', { ...ok, body: 'Mira {{seccion_nuevas}} aquí' }).join(' '), /debe ir solo/);
  assert.match(et.validate('applicant_received', { subject: 'x', heading: 'h', body: '{{#encontrado}}abierto' }).join(' '), /Falta cerrar/);
  assert.match(et.validate('applicant_received', { subject: 'x', heading: 'h', body: '{{#raro}}x{{/raro}}' }).join(' '), /no existe/);
  assert.match(et.validate('leader_digest', { ...ok, body: ok.body + '\n\n[[Ir|ftp://mal]]' }).join(' '), /enlace no válido/);
  assert.match(et.validate('leader_digest', { ...ok, subject: '' }).join(' '), /asunto/);
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
  await login('admin', 'admin@test.es', 'admin-pass');
  const city = Number(db.prepare("INSERT INTO cities (name) VALUES ('Madrid')").run().lastInsertRowid);
  const id = Number(db.prepare("INSERT INTO users (email, role) VALUES ('lider@test.es', 'leader')").run().lastInsertRowid);
  db.prepare('INSERT INTO user_cities VALUES (?,?)').run(id, city);
  await login('leader', 'lider@test.es', 'HillsongEspana');
});
test.after(() => server.close());

test('solo el administrador ve y edita los emails', async () => {
  assert.equal((await req('leader', 'GET', '/api/panel/admin/emails')).status, 403);
  assert.equal((await req('leader', 'PUT', '/api/panel/admin/emails/leader_digest', {})).status, 403);
  assert.equal((await req('leader', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 2, hour: 9 }] })).status, 403);
  assert.equal((await fetch(base + '/api/panel/admin/emails')).status, 401);
  const data = await (await req('admin', 'GET', '/api/panel/admin/emails')).json();
  assert.equal(data.templates.length, Object.keys(et.TEMPLATES).length);
  assert.deepEqual(Object.keys(data.groups), ['persona', 'lider']);
});

test('guardar un email: se valida, se usa al enviar y se puede restaurar', async () => {
  const good = { subject: 'AVISO {{equipo}}', heading: 'Nuevo título', body: 'Tu lista:\n\n{{seccion_nuevas}}\n\n{{seccion_seguimiento}}\n\n{{seccion_resto}}\n\nGracias.', enabled: true };
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/emails/leader_digest', { ...good, body: 'sin las secciones' })).status, 400);
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/emails/no_existe', good)).status, 404);
  const saved = await (await req('admin', 'PUT', '/api/panel/admin/emails/leader_digest', good)).json();
  assert.equal(saved.customized, true);
  assert.equal(saved.updated_by, 'admin@test.es');
  const m = emails.leaderDigestEmail({ team: { name: 'Cafetería' }, nuevas: [person], seguimiento: [], resto: [] });
  assert.equal(m.subject, 'AVISO Cafetería');
  assert.match(m.html, /Nuevo título/);
  assert.match(m.html, /Tu lista/);
  // restaurar
  const back = await (await req('admin', 'DELETE', '/api/panel/admin/emails/leader_digest')).json();
  assert.equal(back.customized, false);
  assert.match(emails.leaderDigestEmail({ team: { name: 'Cafetería' }, nuevas: [person], seguimiento: [], resto: [] }).subject, /^Tu lista/);
});

test('un email desactivado no se envía, y queda anotado', async () => {
  await req('admin', 'PUT', '/api/panel/admin/emails/applicant_received', { ...et.TEMPLATES.applicant_received, enabled: false });
  const sent = [];
  const flow = createFlow({ pco: { findPerson: async () => ({ id: '1' }), getCourseStatus: async () => ({ bases1: true, bases2: true, gc: true }), addNote: async () => {} }, mail: { sendMail: async (m) => sent.push(m) } });
  const city = db.prepare('SELECT id FROM cities LIMIT 1').get().id;
  const team = Number(db.prepare("INSERT INTO teams (name) VALUES ('T')").run().lastInsertRowid);
  const id = Number(db.prepare(`INSERT INTO applications (name,email,phone,city_id,team_id,tenure_months) VALUES ('Ana','ana@x.es','600111222',?,?,24)`).run(city, team).lastInsertRowid);
  await flow.process(id);
  assert.equal(sent.filter((m) => [].concat(m.to).includes('ana@x.es')).length, 0);
  assert.ok(db.prepare("SELECT 1 FROM application_events WHERE application_id = ? AND event = 'email_desactivado'").get(id));
  await req('admin', 'DELETE', '/api/panel/admin/emails/applicant_received');
});

test('vista previa: documento propio con su CSP, embebible solo desde la misma web, y sin ejecutar HTML del admin', async () => {
  const body = new URLSearchParams({ subject: 'Asunto <b>x</b>', heading: 'T', body: 'Hola {{nombre}} <script>alert(1)</script>' });
  const r = await fetch(base + '/api/panel/admin/emails/applicant_received/preview', { method: 'POST', headers: { Cookie: cookies.admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  const html = await r.text();
  assert.match(html, /Hola Ana/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Asunto:<\/b> Asunto &lt;b&gt;x&lt;\/b&gt;/);
  const noAdmin = await fetch(base + '/api/panel/admin/emails/applicant_received/preview', { method: 'POST', headers: { Cookie: cookies.leader, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(noAdmin.status, 403);
  const malo = await fetch(base + '/api/panel/admin/emails/leader_digest/preview', { method: 'POST', headers: { Cookie: cookies.admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ subject: 's', heading: 'h', body: 'sin las secciones' }) });
  assert.match(await malo.text(), /No se puede previsualizar/);
});

test('email de prueba: solo al propio administrador y sin SMTP no envía nada', async () => {
  const r = await req('admin', 'POST', '/api/panel/admin/emails/leader_digest/test', { ...et.TEMPLATES.leader_digest });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.to, 'admin@test.es');
  assert.equal(out.sent, false);
  assert.equal((await req('admin', 'POST', '/api/panel/admin/emails/leader_digest/test', { subject: 's', heading: 'h', body: 'sin secciones' })).status, 400);
});

test('el horario del resumen se guarda, se valida, y admite varias franjas', async () => {
  assert.deepEqual(digestSchedule(), [{ day: 1, hour: 8 }, { day: 4, hour: 8 }], 'por defecto: lunes y jueves 8:00');
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 9, hour: 8 }] })).status, 400);
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 2, hour: 25 }] })).status, 400);
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/email-schedule', { slots: [] })).status, 400);
  assert.equal((await req('admin', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 2, hour: 9 }, { day: 2, hour: 9 }] })).status, 400, 'franjas repetidas');
  const r = await (await req('admin', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 5, hour: 18 }, { day: 2, hour: 9 }] })).json();
  assert.deepEqual(r.slots, [{ day: 5, hour: 18 }, { day: 2, hour: 9 }]);
  assert.deepEqual(digestSchedule(), [{ day: 5, hour: 18 }, { day: 2, hour: 9 }]);
  assert.deepEqual((await (await req('admin', 'GET', '/api/panel/admin/emails')).json()).schedule.slots, [{ day: 5, hour: 18 }, { day: 2, hour: 9 }]);
  // la descripción de «Tu lista» (lo que ve el admin en la lista de emails) refleja el horario recién guardado, no el de por defecto
  const digest = (await (await req('admin', 'GET', '/api/panel/admin/emails')).json()).templates.find((t) => t.key === 'leader_digest');
  assert.match(digest.when, /viernes a las 18:00 y martes a las 09:00/);
  await req('admin', 'PUT', '/api/panel/admin/email-schedule', { slots: [{ day: 1, hour: 8 }, { day: 4, hour: 8 }] }); // vuelve al horario por defecto para no afectar otras pruebas
});

test('la web: «Cómo funciona» nombra Bases 1, GC y Bases 2 y el formulario pregunta en ese orden', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<b>Bases 1, GC y Bases 2<\/b>/);
  assert.doesNotMatch(html, /<b>Bases 1 y 2<\/b>/);
  assert.match(html, /el líder de tu equipo te lo dirá al contactarte/);
  assert.match(html, /<h2>Únete al Equipo<\/h2>/);
  const orden = [...html.matchAll(/class="yn"><span>.*?<\/span><label><input type="radio" name="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(orden, ['bases1', 'gc', 'bases2']);
});
