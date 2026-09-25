// getFormStatus y getGcInfo contra un Planning Center simulado que se comporta como la API real: sí existe
// /people/v2/people/{id}/form_submissions (comprobado contra producción) y la membresía de Groups solo trae el
// id del grupo, hay que resolverlo aparte.
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
  { id: '5', name: 'Asistencia Bloques 1, 2 y 3 (Sesión 1) de Bases 1' },
  { id: '6', name: 'Asistencia Bloques 4, 5 y 6 (Sesión 2) de Bases 1' },
];
const submissions = [
  { form: '1', person: '100', at: '2026-09-20T10:00:00Z' },
  { form: '3', person: '100', at: '2026-09-21T10:00:00Z' },
  { form: '2', person: '200', at: '2026-09-22T10:00:00Z' },
  { form: '4', person: '300', at: '2026-09-22T10:00:00Z' },
  { form: '5', person: '500', at: '2026-09-20T10:00:00Z' },
  { form: '6', person: '500', at: '2026-09-22T10:00:00Z' }, // las dos sesiones: cuenta como asistido
  { form: '5', person: '501', at: '2026-09-20T10:00:00Z' }, // solo una sesión: no cuenta
];
// Campos de Bases 1 y Bases 2 (casillas, una por sesión) tal como están en producción: mismo nombre de opción,
// «Bases 1» con un espacio inicial en el valor (norm() lo recorta igual).
const fieldDefs = { bases1: '900', bases2: '901' };
const fieldData = {
  400: [{ field: 'bases1', value: ' Asistencia Sesión 1' }], // solo una sesión: no debe contar como hecho
  401: [{ field: 'bases1', value: ' Asistencia Sesión 1' }, { field: 'bases1', value: ' Asistencia Sesión 2' }], // las dos: sí cuenta
};
const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  requests.push(url.pathname);
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if (url.pathname === '/people/v2/forms') return send(200, { data: forms.map((f) => ({ type: 'Form', id: f.id, attributes: { name: f.name } })) });
  if ((m = url.pathname.match(/^\/people\/v2\/people\/(\d+)\/form_submissions$/))) {
    const rows = submissions.filter((s) => s.person === m[1]).sort((a, b) => b.at.localeCompare(a.at));
    return send(200, { data: rows.map((s, i) => ({ type: 'FormSubmission', id: `${s.form}-${i}`, attributes: { created_at: s.at }, relationships: { form: { data: { type: 'Form', id: s.form } } } })) });
  }
  if (url.pathname === '/people/v2/field_definitions') return send(200, { data: [
    { type: 'FieldDefinition', id: fieldDefs.bases1, attributes: { name: 'Bases 1' } },
    { type: 'FieldDefinition', id: fieldDefs.bases2, attributes: { name: 'Bases 2' } },
  ] });
  if ((m = url.pathname.match(/^\/people\/v2\/people\/(\d+)\/field_data$/))) {
    const rows = fieldData[m[1]] || [];
    return send(200, { data: rows.map((r, i) => ({ type: 'FieldDatum', id: `${m[1]}-${i}`, attributes: { value: r.value }, relationships: { field_definition: { data: { type: 'FieldDefinition', id: fieldDefs[r.field] } } } })) });
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

test('getFormStatus lee los envíos de la persona y los cruza con los formularios de cada curso (Bases 1, Bases 2, GC; Bases 3 no cuenta)', async () => {
  const pco = require('../src/pco');
  assert.deepEqual(await pco.getFormStatus('100'), { bases1: true, bases2: false, gc: true, bases1Attendance: false });
  assert.deepEqual(await pco.getFormStatus('200'), { bases1: false, bases2: true, gc: false, bases1Attendance: false });
  assert.deepEqual(await pco.getFormStatus('300'), { bases1: false, bases2: false, gc: false, bases1Attendance: false });
  assert.ok(requests.some((p) => p === '/people/v2/people/100/form_submissions'), 'usa la ruta por persona (comprobada contra producción)');
});

test('getFormStatus: bases1Attendance solo es true si envió los dos formularios de asistencia de Bases 1 (Sesión 1 y Sesión 2)', async () => {
  const pco = require('../src/pco');
  assert.equal((await pco.getFormStatus('500')).bases1Attendance, true, 'envió las dos sesiones');
  assert.equal((await pco.getFormStatus('501')).bases1Attendance, false, 'solo envió la sesión 1');
  assert.equal((await pco.getFormStatus('300')).bases1Attendance, false, 'no envió ninguna');
});

test('getGcInfo: membresía activa en un grupo de tipo «Grupo de Conexión»', async () => {
  const pco = require('../src/pco');
  assert.deepEqual(await pco.getGcInfo('100'), { inGc: true, groupName: 'Pablo y Carolina' });
  assert.deepEqual(await pco.getGcInfo('200'), { inGc: false, groupName: null });
});

test('getCourseStatus: Bases 1 (igual que Bases 2) solo cuenta hecho con las dos sesiones marcadas, una sola no basta', async () => {
  const pco = require('../src/pco');
  const config = require('../src/config');
  const opts = { fields: config.fields, required: config.required };
  assert.equal((await pco.getCourseStatus('400', opts)).bases1, false, 'una sola sesión no cuenta');
  assert.equal((await pco.getCourseStatus('401', opts)).bases1, true, 'las dos sesiones sí cuentan');
});
