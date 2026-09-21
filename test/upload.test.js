const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ute-up-')), 'test.db');
process.env.SESSION_SECRET = 'y'.repeat(40);
process.env.PANEL_PASSWORD = 'HillsongEspana';
process.env.ADMIN_EMAIL = 'admin@test.es';
process.env.ADMIN_PASSWORD = 'admin-pass';

const { app } = require('../server');
let server, base, cookie;

test.before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.es', password: 'admin-pass' }) });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const upload = (body, type) => fetch(base + '/api/panel/admin/images', { method: 'POST', headers: { 'Content-Type': type, Cookie: cookie }, body });

test('sube un PNG válido y se sirve desde /uploads', async () => {
  const r = await upload(PNG, 'image/png');
  assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.match(url, /^\/uploads\/team-[0-9a-f]{16}\.png$/);
  const img = await fetch(base + url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('rechaza un archivo que dice ser PNG pero no lo es, SVG y tipos no permitidos', async () => {
  assert.equal((await upload(Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 400);
  assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status, 400);
  assert.equal((await upload(Buffer.from('hola'), 'text/html')).status, 400);
});

test('rechaza imágenes de más de 3 MB', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
  assert.equal((await upload(big, 'image/png')).status, 413);
});

test('sin sesión no se puede subir', async () => {
  const r = await fetch(base + '/api/panel/admin/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG });
  assert.equal(r.status, 401);
});

test('el equipo acepta emoji con varias partes y solo URLs https o /uploads', async () => {
  const save = (body) => fetch(base + '/api/panel/admin/teams', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  assert.equal((await save({ name: 'Malo', image_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await save({ name: 'Malo2', image_url: 'http://x.es/a.png' })).status, 400);
  const ok = await save({ name: 'Familia', icon: '👨‍👩‍👧', image_url: '/uploads/team-abc.png' });
  assert.equal(ok.status, 200);
  const teams = await (await fetch(base + '/api/public')).json();
  assert.equal(teams.areas.find((t) => t.name === 'Familia').icon, '👨‍👩‍👧');
});
