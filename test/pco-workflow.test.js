// Búsqueda por nombre exacto, creación de ficha y workflow «Servir En Un Equipo (ciudad)» contra un Planning
// Center simulado que responde como la API real (comprobado contra producción: nombre de una palabra → 422
// «last_name can't be blank»; email de dominio no permitido → 422; tarjetas por persona con relationships.workflow).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-wf-')), 'test.db');
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.PCO_APP_ID = 'test';
process.env.PCO_SECRET = 'test';

const people = [
  { id: '1', name: 'Elena Sánchez Salinas', emails: ['elena@x.es'], phones: ['600111222'], created_at: '2024-01-01T00:00:00Z' },
  { id: '2', name: 'Elena Sánchez Salinas', emails: ['otra@x.es'], phones: [], created_at: '2025-01-01T00:00:00Z' }, // mismo nombre, más reciente
  { id: '3', name: 'Pedro Gil', emails: ['pedro@x.es'], phones: ['699000111'], created_at: '2024-06-01T00:00:00Z' },
  { id: '4', name: 'Pedro Gil Martín', emails: [], phones: [], created_at: '2024-06-01T00:00:00Z' }, // nombre parecido, no igual
];
const workflows = [
  { id: '10', name: 'Servir En Un Equipo (Barcelona)', campus_id: 111 },
  { id: '11', name: 'Servir En Un Equipo (Madrid)', campus_id: 222 },
  { id: '12', name: 'Servir En Un Equipo (Valencia) ', campus_id: 333 }, // espacio de más, como en producción
  { id: '13', name: 'Servir En Un Equipo (Sevilla)', campus_id: 444, archived_at: '2026-01-01T00:00:00Z' },
  { id: '20', name: 'BASES 1: FUNDAMENTOS (BARCELONA)', campus_id: 111 },
];
const cards = { 1: [] }; // persona → tarjetas
const created = [];
const posts = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    let m;
    if (req.method === 'GET' && url.pathname === '/people/v2/people') {
      const term = String(url.searchParams.get('where[search_name_or_email_or_phone_number]') || '').toLowerCase();
      const strip = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const hit = people.filter((p) => strip(p.name).includes(strip(term)) || p.emails.includes(term) || p.phones.some((ph) => term.replace(/\D/g, '').endsWith(ph)));
      return send(200, { data: hit.map((p) => ({ type: 'Person', id: p.id, attributes: { name: p.name } })) });
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/people\/v2\/people\/(\d+)$/))) {
      const p = people.find((x) => x.id === m[1]);
      if (!p) return send(404, { errors: [{ detail: 'no existe' }] });
      return send(200, { data: { type: 'Person', id: p.id, attributes: { name: p.name, created_at: p.created_at }, links: { html: `https://pco/people/${p.id}` } },
        included: [...p.emails.map((a, i) => ({ type: 'Email', id: `e${i}`, attributes: { address: a } })), ...p.phones.map((n, i) => ({ type: 'PhoneNumber', id: `t${i}`, attributes: { number: n } }))] });
    }
    if (req.method === 'POST' && url.pathname === '/people/v2/people') {
      const a = body.data.attributes;
      if (!a.last_name) return send(422, { errors: [{ detail: "can't be blank", source: { parameter: 'last_name' } }] });
      const id = String(900 + created.length);
      created.push({ id, ...a, emails: [], phones: [] });
      return send(201, { data: { type: 'Person', id, attributes: { name: `${a.first_name} ${a.last_name}` } } });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/people\/v2\/people\/(\d+)\/emails$/))) {
      if (/@example\.com$/.test(body.data.attributes.address)) return send(422, { errors: [{ detail: 'has a disallowed domain name' }] });
      created.find((c) => c.id === m[1]).emails.push(body.data.attributes.address);
      return send(201, { data: { type: 'Email', id: 'x', attributes: {} } });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/people\/v2\/people\/(\d+)\/phone_numbers$/))) {
      created.find((c) => c.id === m[1]).phones.push(body.data.attributes.number);
      return send(201, { data: { type: 'PhoneNumber', id: 'x', attributes: {} } });
    }
    if (req.method === 'GET' && url.pathname === '/people/v2/workflows') {
      return send(200, { data: workflows.map((w) => ({ type: 'Workflow', id: w.id, attributes: { name: w.name, campus_id: w.campus_id, archived_at: w.archived_at ?? null } })) });
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/people\/v2\/people\/(\d+)\/workflow_cards$/))) {
      return send(200, { data: (cards[m[1]] || []).map((c) => ({ type: 'WorkflowCard', id: c.id, attributes: { stage: c.stage, removed_at: c.removed_at ?? null }, relationships: { workflow: { data: { type: 'Workflow', id: c.workflow } } } })) });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/people\/v2\/workflows\/(\d+)\/cards$/))) {
      posts.push({ workflow: m[1], person: body.data.attributes.person_id });
      return send(201, { data: { type: 'WorkflowCard', id: `card-${posts.length}`, attributes: {} } });
    }
    send(404, { errors: [{ detail: `No existe: ${req.method} ${url.pathname}` }] });
  });
});

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  require('../src/config').pco.base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('findPerson: la misma persona si coincide el email, el teléfono o el nombre y apellidos exactos (sin tildes ni mayúsculas)', async () => {
  const pco = require('../src/pco');
  assert.equal((await pco.findPerson({ email: 'pedro@x.es', phone: '', name: 'Otro Nombre' })).id, '3', 'por email');
  assert.equal((await pco.findPerson({ email: 'nuevo@x.es', phone: '+34 699 000 111', name: 'Otro Nombre' })).id, '3', 'por teléfono');
  const porNombre = await pco.findPerson({ email: 'nuevo@x.es', phone: '', name: 'ELENA  sanchez salinas' });
  assert.equal(porNombre.id, '1', 'por nombre exacto: de varias con el mismo nombre gana la ficha más antigua');
  assert.equal(await pco.findPerson({ email: 'nuevo@x.es', phone: '', name: 'Pedro Gil Mart' }), null, 'un nombre parecido no vale');
  assert.equal(await pco.findPerson({ email: 'nuevo@x.es', phone: '', name: 'Pedro' }), null, 'una sola palabra no basta para decir que es la misma persona');
  assert.equal((await pco.findPerson({ email: 'elena@x.es', phone: '', name: 'Nombre Distinto' })).id, '1', 'el email manda aunque el nombre no coincida');
});

test('createPerson: separa nombre y apellidos, arregla mayúsculas, pone el campus, y un email o teléfono que falle no impide crearla', async () => {
  const pco = require('../src/pco');
  const a = await pco.createPerson({ name: 'MARIA DEL CARMEN GARCIA LOPEZ', email: 'mc@gmail.com', phone: '+34 600 111 333', campusId: '111' });
  const c = created.find((x) => x.id === a.id);
  assert.equal(c.first_name, 'Maria');
  assert.equal(c.last_name, 'del Carmen Garcia Lopez', 'la primera palabra es el nombre y el resto los apellidos; las partículas quedan en minúscula');
  assert.equal(c.primary_campus_id, 111);
  assert.deepEqual(c.emails, ['mc@gmail.com']);
  assert.deepEqual(c.phones, ['+34 600 111 333']);
  assert.deepEqual(a.warnings, []);

  const b = await pco.createPerson({ name: 'Ana Ruiz', email: 'ana@example.com', phone: '600222333' });
  assert.deepEqual(created.find((x) => x.id === b.id).phones, ['600222333'], 'el teléfono se guarda aunque el email dé error');
  assert.match(b.warnings.join(' '), /email: .*disallowed domain/);

  const solo = await pco.createPerson({ name: 'Madonna', email: '', phone: '' });
  assert.equal(created.find((x) => x.id === solo.id).last_name, '(sin apellido)', 'Planning Center exige apellido');

  const mixto = await pco.createPerson({ name: 'Iñaki de la Fuente', email: '', phone: '' });
  assert.equal(created.find((x) => x.id === mixto.id).first_name, 'Iñaki', 'un nombre ya con mayúsculas y minúsculas se respeta tal cual');
});

test('workflowForCity: encuentra «Servir En Un Equipo (ciudad)» por nombre (con espacios de más, sin tildes, sin los archivados ni otros workflows)', async () => {
  const pco = require('../src/pco');
  assert.deepEqual(await pco.workflowForCity('Barcelona'), { id: '10', name: 'Servir En Un Equipo (Barcelona)', campusId: '111' });
  assert.equal((await pco.workflowForCity('Valencia')).id, '12');
  assert.equal((await pco.workflowForCity('madrid')).id, '11');
  assert.equal(await pco.workflowForCity('Sevilla'), null, 'archivado');
  assert.equal(await pco.workflowForCity('Bilbao'), null, 'sin workflow');
});

test('addToWorkflow: crea la tarjeta, no duplica si ya hay una activa en ese workflow, y sí crea otra si la anterior estaba completada o quitada', async () => {
  const pco = require('../src/pco');
  posts.length = 0;
  const first = await pco.addToWorkflow('1', '10');
  assert.deepEqual(first, { cardId: 'card-1', existing: false });
  assert.deepEqual(posts, [{ workflow: '10', person: 1 }]);

  cards['1'] = [{ id: 'c-activa', stage: 'ready', workflow: '10' }];
  assert.deepEqual(await pco.addToWorkflow('1', '10'), { cardId: 'c-activa', existing: true });
  assert.equal(posts.length, 1, 'no se crea otra');

  cards['1'] = [{ id: 'c-otro', stage: 'ready', workflow: '20' }];
  assert.equal((await pco.addToWorkflow('1', '10')).existing, false, 'una tarjeta de otro workflow no cuenta');

  cards['1'] = [{ id: 'c-hecha', stage: 'completed', workflow: '10' }, { id: 'c-quitada', stage: 'removed', removed_at: '2026-01-01T00:00:00Z', workflow: '10' }];
  assert.equal((await pco.addToWorkflow('1', '10')).existing, false, 'completada o quitada: se puede volver a empezar');

  cards['1'] = [{ id: 'c-dormida', stage: 'snoozed', workflow: '10' }];
  assert.equal((await pco.addToWorkflow('1', '10')).existing, true, 'aplazada también cuenta como activa');
});
