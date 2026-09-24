// getFormStatus y getGcInfo contra un Planning Center simulado que se comporta como la API real:
// no existe /people/v2/people/{id}/form_submissions (hay que leer los envíos de cada formulario) y la membresía de
// Groups solo trae el id del grupo.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-pco-')), 'test.db');
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.PCO_APP_ID = 'test';
process.env.PCO_SECRET = 'test';

const forms = [
  { id: '1', name: 'Registro Bases 1 Barcelona' },
  { id: '2', name: 'Registro Bases 2 Madrid' },
  { id: '3', name: 'Registro a Grupos de Conexión BCN' },
  { id: '4', name: 'Registro Bases 3 Barcelona' },
];
const submissions = [
  { form: '1', person: '100', at: '2026-09-20T10:00:00Z' },
  { form: '3', person: '100', at: '2026-09-21T10:00:00Z' },
  { form: '2', person: '200', at: '2026-09-22T10:00:00Z' },
  { form: '4', person: '300', at: '2026-09-22T10:00:00Z' },
];
const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  requests.push(url.pathname);
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if (url.pathname === '/people/v2/forms') return send(200, { data: forms.map((f) => ({ type: 'Form', id: f.id, attributes: { name: f.name } })) });
  if ((m = url.pathname.match(/^\/people\/v2\/forms\/(\d+)\/form_submissions$/))) {
    const rows = submissions.filter((s) => s.form === m[1]).sort((a, b) => b.at.localeCompare(a.at));
    return send(200, { data: rows.map((s, i) => ({ type: 'FormSubmission', id: `${s.form}-${i}`, attributes: { created_at: s.at }, relationships: { person: { data: { type: 'Person', id: s.person } } } })) });
  }
  if (url.pathname === '/groups/v2/group_types') return send(200, { data: [{ type: 'GroupType', id: '10', attributes: { name: 'Grupo de Conexión BCN' } }] });
  if (url.pathname === '/groups/v2/people/100/memberships') return send(200, { data: [{ type: 'Membership', id: 'm1', attributes: { joined_at: '2026-09-23T00:00:00Z' }, relationships: { group: { data: { type: 'Group', id: '77' } } } }] });
  if (url.pathname === '/groups/v2/groups/77') return send(200, { data: { type: 'Group', id: '77', attributes: { name: 'Pablo y Carolina', archived_at: null }, relationships: { group_type: { data: { type: 'GroupType', id: '10' } } } } });
  send(404, { errors: [{ detail: `No existe: ${url.pathname}` }] });
});

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  require('../src/config').pco.base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('getFormStatus lee los envíos de cada formulario (Bases 1, Bases 2, GC; Bases 3 no cuenta), sin la ruta por persona', async () => {
  const pco = require('../src/pco');
  assert.deepEqual(await pco.getFormStatus('100'), { bases1: true, bases2: false, gc: true });
  assert.deepEqual(await pco.getFormStatus('200'), { bases1: false, bases2: true, gc: false });
  assert.deepEqual(await pco.getFormStatus('300'), { bases1: false, bases2: false, gc: false });
  assert.ok(!requests.some((p) => /\/people\/v2\/people\/\d+\/form_submissions/.test(p)), 'no usa la ruta por persona (no existe)');
  const before = requests.length;
  await pco.getFormStatus('100');
  assert.equal(requests.length, before, 'los envíos quedan en memoria unos minutos');
});

test('getGcInfo: membresía activa en un grupo de tipo «Grupo de Conexión»', async () => {
  const pco = require('../src/pco');
  assert.deepEqual(await pco.getGcInfo('100'), { inGc: true, groupName: 'Pablo y Carolina' });
  assert.deepEqual(await pco.getGcInfo('200'), { inGc: false, groupName: null });
});
