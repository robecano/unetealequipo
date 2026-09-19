const $ = (s, r = document) => r.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') return showLogin();
    throw new Error(out.error || 'Error');
  }
  return out;
}
const root = $('#root');
const say = (m) => alert(m);
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { say(e.message); } };

const STATUS = { recibida: 'Recibida', no_apto_aun: 'Aún sin antigüedad', sin_pco: 'Sin ficha (Bases 1)', pendiente_bases: 'Pendiente de Bases 2', listo: 'Para llamar', contactado: 'Contactado', visito: 'Visitó el equipo', confirmado: 'Confirmado', no_continua: 'No continúa' };
const ROLE = { admin: 'Administración', leader: 'Líder de equipo', bases: 'Voluntario de Bases' };
const TENURE = { 0: '< 6 meses', 6: '6–12 meses', 12: '1–2 años', 24: '> 2 años' };
const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z')).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '');
let me = null;

function showLogin() {
  const err = h('p', { class: 'error', hidden: true });
  root.replaceChildren(h('div', { class: 'login card' },
    h('h1', {}, 'Panel del equipo'), h('p', { class: 'muted' }, 'Entra con tu email y la contraseña común.'),
    h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api('/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); boot(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; }
    } },
      h('label', {}, 'Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username' })),
      h('label', {}, 'Contraseña', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
      err, h('button', { class: 'btn', type: 'submit' }, 'Entrar')),
    h('p', { class: 'muted' }, h('a', { href: '/' }, '← Volver a la web'))));
}

// ---------- Solicitudes ----------
const mark = (v) => (v == null ? h('span', { class: 'muted' }, '–') : v ? h('span', { class: 'ok' }, '✓') : h('span', { class: 'no' }, '✗'));

async function applicationsView(box) {
  const q = h('input', { type: 'search', placeholder: 'Buscar nombre, email, teléfono…' });
  const st = h('select', {}, h('option', { value: '' }, 'Todos los estados'), ...Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));
  const body = h('div');
  const load = guard(async () => {
    const rows = await api(`/panel/applications?status=${encodeURIComponent(st.value)}&q=${encodeURIComponent(q.value)}`);
    const act = (id, patch, label) => h('button', { onclick: guard(async () => { await api(`/panel/applications/${id}`, { method: 'PATCH', body: patch }); load(); }) }, label);
    body.replaceChildren(rows.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Persona', 'Equipo', 'Estado', 'B1', 'B2', 'GC', 'Bases', 'Acciones'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((a) => h('tr', {},
        h('td', {}, h('b', {}, a.name), h('br'), h('a', { href: `tel:${a.phone}` }, a.phone), h('br'), h('a', { href: `mailto:${a.email}` }, a.email), h('br'), h('span', { class: 'muted' }, `${fmtDate(a.created_at)} · ${TENURE[a.tenure_months] ?? ''}`)),
        h('td', {}, a.team, h('br'), h('span', { class: 'muted' }, a.city)),
        h('td', {}, h('span', { class: `pill s-${a.status}` }, STATUS[a.status] || a.status), a.followup_at && ['contactado', 'visito', 'listo'].includes(a.status) ? h('div', { class: 'muted' }, `Seguimiento: ${fmtDate(a.followup_at)}`) : null, a.error ? h('div', { class: 'error' }, a.error) : null),
        h('td', {}, mark(a.pco_bases1)), h('td', {}, mark(a.pco_bases2)), h('td', {}, mark(a.pco_gc)),
        h('td', {}, a.bases_name || a.bases_email || h('span', { class: 'muted' }, '–'), a.bases_email ? h('div', { class: 'muted' }, a.bases_status.replace('_', ' ')) : null),
        h('td', {}, h('div', { class: 'acts' },
          me.role === 'bases' ? [act(a.id, { bases_status: 'contactado' }, 'Contactado'), act(a.id, { bases_status: 'registrado' }, 'Registrado en Bases 2')] : [
            ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'contactado' }, 'Llamé') : null,
            ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'visito' }, 'Visitó') : null,
            ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'confirmado' }, 'Confirmar') : null,
            ['listo', 'contactado', 'visito', 'pendiente_bases'].includes(a.status) ? act(a.id, { status: 'no_continua' }, 'No continúa') : null,
            me.role === 'admin' && ['recibida', 'sin_pco'].includes(a.status) ? h('button', { onclick: guard(async () => { await api(`/panel/admin/applications/${a.id}/reprocess`, { method: 'POST' }); load(); }) }, 'Reprocesar') : null])))))))
      : h('div', { class: 'empty card' }, 'No hay solicitudes con estos filtros.'));
  });
  q.addEventListener('input', () => { clearTimeout(q.t); q.t = setTimeout(load, 250); });
  st.addEventListener('change', load);
  box.replaceChildren(h('div', { class: 'toolbar' }, q, me.role === 'bases' ? null : st), body);
  load();
}

// ---------- Administración ----------
async function teamsView(box) {
  const teams = await api('/panel/admin/teams');
  const editor = h('div');
  const edit = (t = {}) => {
    const f = (name, label, type = 'text') => h('label', {}, label, h('input', { name, type, value: t[name] ?? '' }));
    editor.replaceChildren(h('form', { class: 'card form', onsubmit: guard(async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      d.active = e.target.active.checked;
      await api(t.id ? `/panel/admin/teams/${t.id}` : '/panel/admin/teams', { method: t.id ? 'PUT' : 'POST', body: d });
      teamsView(box);
    }) },
      h('h3', {}, t.id ? `Editar ${t.name}` : 'Nuevo equipo'),
      f('name', 'Nombre'),
      h('label', {}, 'Descripción breve', h('textarea', { name: 'description', rows: 3 }, t.description || '')),
      h('div', { class: 'row2' }, f('icon', 'Emoji (icono)'), f('sort', 'Orden', 'number')),
      f('image_url', 'URL de imagen (opcional, https)'),
      f('min_months', 'Meses mínimos en la iglesia (0 = sin mínimo)', 'number'),
      h('label', {}, 'Aviso para quien se apunta (p. ej. entrevista previa)', h('textarea', { name: 'notice', rows: 2 }, t.notice || '')),
      h('label', { class: 'checks' }, h('input', { type: 'checkbox', name: 'active', checked: t.active !== 0 }), 'Visible en la web'),
      h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Guardar'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancelar'))));
  };
  box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-sm', onclick: () => edit() }, '+ Nuevo equipo')), editor,
    h('div', { class: 'card' }, teams.length ? teams.map((t) => h('div', { class: 'li' }, h('div', {}, `${t.icon} `, h('b', {}, t.name), t.active ? '' : ' (oculto)', t.min_months ? h('span', { class: 'muted' }, ` · mín. ${t.min_months} meses`) : null), h('button', { class: 'mini', onclick: () => edit(t) }, 'Editar'))) : h('p', { class: 'muted' }, 'Aún no hay equipos.')));
}

async function citiesView(box) {
  const cities = await api('/panel/admin/cities');
  const input = h('input', { placeholder: 'Nueva ciudad' });
  box.replaceChildren(h('form', { class: 'toolbar', onsubmit: guard(async (e) => { e.preventDefault(); await api('/panel/admin/cities', { method: 'POST', body: { name: input.value } }); citiesView(box); }) }, input, h('button', { class: 'btn btn-sm' }, 'Añadir')),
    h('div', { class: 'card' }, cities.map((c) => h('div', { class: 'li' }, h('span', {}, c.name, c.active ? '' : ' (oculta)'), h('button', { class: 'mini', onclick: guard(async () => { await api(`/panel/admin/cities/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); citiesView(box); }) }, c.active ? 'Ocultar' : 'Mostrar')))));
}

async function usersView(box) {
  const [users, cities, teams] = await Promise.all([api('/panel/admin/users'), api('/panel/admin/cities'), api('/panel/admin/teams')]);
  const editor = h('div');
  const checks = (name, items, selected) => h('div', { class: 'checks' }, items.map((i) => h('label', {}, h('input', { type: 'checkbox', name, value: i.id, checked: selected.includes(i.id) }), i.name)));
  const edit = (u = { role: 'leader', city_ids: [], team_ids: [], active: 1 }) => {
    const roleSel = h('select', { name: 'role', disabled: !!u.id }, ['leader', 'bases'].map((r) => h('option', { value: r, selected: u.role === r }, ROLE[r])));
    const teamBox = h('div', {}, h('p', { class: 'muted' }, 'Equipos que lidera'), checks('team_ids', teams, u.team_ids));
    const syncRole = () => { teamBox.hidden = roleSel.value !== 'leader'; };
    roleSel.addEventListener('change', syncRole);
    editor.replaceChildren(h('form', { class: 'card form', onsubmit: guard(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { email: f.get('email'), name: f.get('name'), role: u.id ? u.role : roleSel.value, active: e.target.active.checked, city_ids: f.getAll('city_ids'), team_ids: f.getAll('team_ids') };
      await api(u.id ? `/panel/admin/users/${u.id}` : '/panel/admin/users', { method: u.id ? 'PUT' : 'POST', body });
      usersView(box);
    }) },
      h('h3', {}, u.id ? `Editar ${u.email}` : 'Nueva persona'),
      h('div', { class: 'row2' }, h('label', {}, 'Nombre', h('input', { name: 'name', value: u.name || '' })), h('label', {}, 'Email', h('input', { name: 'email', type: 'email', value: u.email || '', required: true, readonly: !!u.id }))),
      h('label', {}, 'Rol', roleSel),
      h('div', {}, h('p', { class: 'muted' }, 'Ciudades'), checks('city_ids', cities, u.city_ids)), teamBox,
      h('label', { class: 'checks' }, h('input', { type: 'checkbox', name: 'active', checked: !!u.active }), 'Activo'),
      h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Guardar'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancelar'),
        u.id ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => { if (confirm(`¿Eliminar a ${u.email}?`)) { await api(`/panel/admin/users/${u.id}`, { method: 'DELETE' }); usersView(box); } }) }, 'Eliminar') : null)));
    syncRole();
  };
  const cityName = (id) => cities.find((c) => c.id === id)?.name;
  const teamName = (id) => teams.find((t) => t.id === id)?.name;
  box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-sm', onclick: () => edit() }, '+ Añadir líder o voluntario de Bases')), editor,
    h('div', { class: 'card' }, users.filter((u) => u.role !== 'admin').map((u) => h('div', { class: 'li' },
      h('div', {}, h('b', {}, u.name || u.email), u.active ? '' : ' (inactivo)', h('div', { class: 'muted' }, `${ROLE[u.role]} · ${u.email}`), h('div', { class: 'muted' }, [u.city_ids.map(cityName).join(', '), u.role === 'leader' ? u.team_ids.map(teamName).join(', ') : ''].filter(Boolean).join(' — '))),
      h('button', { class: 'mini', onclick: () => edit(u) }, 'Editar')))));
}

// ---------- Estructura ----------
async function boot() {
  try { me = await api('/me'); } catch { return; }
  if (!me?.id) return;
  const tabs = [['apps', me.role === 'bases' ? 'Mis pendientes de Bases 2' : 'Solicitudes', applicationsView]];
  if (me.role === 'admin') tabs.push(['teams', 'Equipos', teamsView], ['cities', 'Ciudades', citiesView], ['users', 'Líderes y Bases', usersView]);
  const content = h('div');
  const bar = h('div', { class: 'tabs' });
  const go = guard(async (key) => {
    const t = tabs.find((x) => x[0] === key);
    bar.replaceChildren(...tabs.map(([k, label]) => h('button', { class: `tab${k === key ? ' on' : ''}`, onclick: () => go(k) }, label)));
    content.replaceChildren();
    await t[2](content);
  });
  root.replaceChildren(
    h('div', { class: 'topbar' }, h('div', {}, h('h2', {}, 'Únete al equipo'), h('span', { class: 'muted' }, `${me.name || me.email} · ${ROLE[me.role]}`)),
      h('div', { class: 'acts' }, h('a', { class: 'mini', href: '/' }, 'Ver web'), h('button', { class: 'mini', onclick: async () => { await api('/logout', { method: 'POST' }); showLogin(); } }, 'Salir'))),
    bar, content);
  go('apps');
}
boot().then(() => { if (!me?.id) showLogin(); });
