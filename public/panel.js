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

const STATUS = { recibida: 'Recibida', no_apto_aun: 'Aún sin antigüedad', sin_pco: 'Sin ficha (Bases 1)', pendiente_bases: 'Pendiente de Bases o GC', listo: 'Para llamar', contactado: 'Contactado', visito: 'Visitó el equipo', confirmado: 'Confirmado', no_continua: 'No continúa' };
const ROLE = { admin: 'Administración', leader: 'Líder de equipo', bases: 'Voluntario de Bases', gc: 'Voluntario de GC' };
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
// Celda de curso: lo que consta en Planning Center y, debajo, lo que dijo la persona (⚠ si dijo Sí y no consta)
const course = (pco, self) => h('td', {}, mark(pco), self == null ? null : h('div', { class: 'muted' }, `dijo ${self ? 'Sí' : 'No'}${pco === 0 && self ? ' ⚠' : ''}`));

async function applicationsView(box) {
  const q = h('input', { type: 'search', placeholder: 'Buscar nombre, email, teléfono…' });
  const st = h('select', {}, h('option', { value: '' }, 'Todos los estados'), ...Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));
  const body = h('div');
  // Voluntarios y líderes pueden quitar personas de su lista; aquí se ven las quitadas (para volver a ponerlas)
  const hasList = ['bases', 'gc', 'leader'].includes(me.role);
  const view = h('select', {}, h('option', { value: '' }, me.role === 'leader' ? 'Mi listado' : 'En mi lista'), h('option', { value: '1' }, 'Quitadas'));
  // Descarga en CSV con los mismos filtros que estás viendo (estado y búsqueda)
  const exportLink = h('a', { class: 'mini export', download: '' }, '⬇ Exportar CSV');
  const setExport = (n) => {
    exportLink.href = `/api/panel/applications.csv?status=${encodeURIComponent(st.value)}&q=${encodeURIComponent(q.value)}&removed=${hasList ? view.value : ''}`;
    exportLink.textContent = `⬇ Exportar CSV (${n})`;
  };
  const load = guard(async () => {
    const rows = await api(`/panel/applications?status=${encodeURIComponent(st.value)}&q=${encodeURIComponent(q.value)}&removed=${hasList ? view.value : ''}`);
    const quitadas = hasList && view.value === '1';
    setExport(rows.length);
    const quitar = (a, quitadas, quitarTxt = 'Quitar de mi lista', volverTxt = 'Volver a mi lista') => act(a.id, { removed: !quitadas }, quitadas ? volverTxt : quitarTxt);
    const act = (id, patch, label) => h('button', { onclick: guard(async () => { await api(`/panel/applications/${id}`, { method: 'PATCH', body: patch }); load(); }) }, label);
    body.replaceChildren(rows.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Persona', 'Equipo', 'Estado', 'B1', 'GC', 'B2', 'Vol. Bases', 'Vol. GC', 'Acciones'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((a) => h('tr', {},
        h('td', {}, h('b', {}, a.name), a.needs_bases && a.bases_form_before ? h('div', { class: 'warn-mini' }, '⚠ Ya rellenó el formulario de Bases anteriormente pero no fue contactado') : null, h('br'), h('a', { href: `tel:${a.phone}` }, a.phone), h('br'), h('a', { href: `mailto:${a.email}` }, a.email), h('br'), h('span', { class: 'muted' }, `${fmtDate(a.created_at)} · ${TENURE[a.tenure_months] ?? ''}`)),
        h('td', {}, a.team, h('br'), h('span', { class: 'muted' }, a.city)),
        h('td', {}, h('span', { class: `pill s-${a.status}` }, STATUS[a.status] || a.status), a.followup_at && ['contactado', 'visito', 'listo'].includes(a.status) ? h('div', { class: 'muted' }, `Seguimiento: ${fmtDate(a.followup_at)}`) : null, a.error ? h('div', { class: 'error' }, a.error) : null),
        course(a.pco_bases1, a.self_bases1), course(a.pco_gc, a.self_gc), course(a.pco_bases2, a.self_bases2),
        h('td', {}, a.bases_name || a.bases_email || h('span', { class: 'muted' }, '–'), a.bases_phone ? h('div', {}, h('a', { href: `tel:${a.bases_phone}` }, a.bases_phone)) : null, a.bases_email ? h('div', { class: 'muted' }, a.bases_status.replace('_', ' ')) : null),
        h('td', {}, a.gc_name || a.gc_email || h('span', { class: 'muted' }, a.needs_gc ? 'sin asignar' : '–'), a.gc_phone ? h('div', {}, h('a', { href: `tel:${a.gc_phone}` }, a.gc_phone)) : null, a.gc_email ? h('div', { class: 'muted' }, a.gc_status.replace('_', ' ')) : null),
        h('td', {}, h('div', { class: 'acts' },
          me.role === 'gc' ? [!quitadas ? act(a.id, { gc_status: 'contactado' }, 'Contactado') : null, !quitadas ? act(a.id, { gc_status: 'registrado' }, 'Ya está en un GC') : null, quitar(a, quitadas)]
          : me.role === 'bases' ? [!quitadas ? act(a.id, { bases_status: 'contactado' }, 'Contactado') : null, !quitadas ? act(a.id, { bases_status: 'registrado' }, 'Ya está apuntado en Bases') : null, quitar(a, quitadas)] : [
            me.role === 'leader' && (quitadas || ['pendiente_bases', 'sin_pco'].includes(a.status)) ? quitar(a, quitadas, 'Quitar de mi listado', 'Volver a mi listado') : null,
            ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'contactado' }, 'Llamé') : null,
            ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'visito' }, 'Visitó') : null,
            ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'confirmado' }, 'Confirmar') : null,
            ['listo', 'contactado', 'visito', 'pendiente_bases'].includes(a.status) ? act(a.id, { status: 'no_continua' }, 'No continúa') : null,
            h('button', { class: 'danger', onclick: guard(async () => {
              if (!confirm(`¿Borrar la solicitud de ${a.name}?\n\nSe elimina también su historial en esta web. No se puede deshacer.\n(La nota en su perfil de Planning Center no se borra.)`)) return;
              await api(`/panel/applications/${a.id}`, { method: 'DELETE' });
              load();
            }) }, 'Borrar'),
            me.role === 'admin' && ['recibida', 'sin_pco'].includes(a.status) ? h('button', { onclick: guard(async () => { await api(`/panel/admin/applications/${a.id}/reprocess`, { method: 'POST' }); load(); }) }, 'Reprocesar') : null])))))))
      : h('div', { class: 'empty card' }, (['bases', 'gc'].includes(me.role) ? 'Ahora mismo no hay nadie de posible seguimiento.' : 'No hay solicitudes con estos filtros.')));
  });
  q.addEventListener('input', () => { clearTimeout(q.t); q.t = setTimeout(load, 250); });
  st.addEventListener('change', load);
  view.addEventListener('change', load);
  box.replaceChildren(h('div', { class: 'toolbar' }, q, ['bases', 'gc'].includes(me.role) ? null : st, hasList ? view : null, exportLink), body);
  load();
}

// ---------- Administración ----------

const EMOJIS = ['🎶', '🎤', '🎸', '🥁', '🎛️', '💡', '🎥', '📸', '🤝', '☕', '🧒', '👶', '💛', '🙏', '📖', '🚗', '🧹', '🍽️', '🎨', '📣'];

/** Emoji o imagen del equipo, con vista previa. Si hay imagen se muestra la imagen; si no, el emoji. */
function media(t) {
  const preview = h('div', { class: 'team-preview' });
  const icon = h('input', { name: 'icon', value: t.icon || '', placeholder: '🎶', maxlength: '12' });
  const image = h('input', { name: 'image_url', value: t.image_url || '', placeholder: 'https://… o sube una imagen' });
  const status = h('span', { class: 'muted' });
  const draw = () => preview.replaceChildren(image.value.trim() ? h('img', { src: image.value.trim(), alt: '' }) : h('span', { class: 'icon' }, icon.value.trim() || '🙂'));
  icon.addEventListener('input', draw);
  image.addEventListener('input', draw);
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    status.textContent = 'Subiendo…';
    try {
      const res = await fetch('/api/panel/admin/images', { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'No se pudo subir');
      image.value = out.url;
      status.textContent = 'Imagen subida. Pulsa Guardar.';
      draw();
    } catch (ex) { status.textContent = ex.message; }
    e.target.value = '';
  } });
  draw();
  return h('div', { class: 'media card' },
    preview,
    h('div', { class: 'stack' },
      h('label', {}, 'Emoji del equipo', icon),
      h('div', { class: 'emojis' }, EMOJIS.map((em) => h('button', { type: 'button', class: 'mini', onclick: () => { icon.value = em; draw(); } }, em))),
      h('label', {}, 'Imagen (opcional, PNG, JPG o WebP, máx. 3 MB)', file, image),
      h('button', { type: 'button', class: 'mini', onclick: () => { image.value = ''; status.textContent = 'Imagen quitada. Pulsa Guardar.'; draw(); } }, 'Quitar imagen'),
      status));
}

async function teamsView(box) {
  const teams = await api('/panel/admin/teams');
  const areas = teams.filter((t) => !t.parent_id);
  const subsOf = (id) => teams.filter((t) => t.parent_id === id);
  const editor = h('div');
  const edit = (t = {}) => {
    const f = (name, label, type = 'text') => h('label', {}, label, h('input', { name, type, value: t[name] ?? '' }));
    const parent = h('select', { name: 'parent_id' }, h('option', { value: '' }, '— Es un área (aparece como tarjeta en la web) —'),
      ...areas.filter((a) => a.id !== t.id).map((a) => h('option', { value: a.id, selected: a.id === t.parent_id }, `Subequipo de: ${a.name}`)));
    const mediaBox = h('div', {}, media(t));
    const sync = () => { mediaBox.hidden = !!parent.value; };
    parent.addEventListener('change', sync);
    editor.replaceChildren(h('form', { class: 'card form', onsubmit: guard(async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      d.active = e.target.active.checked;
      await api(t.id ? `/panel/admin/teams/${t.id}` : '/panel/admin/teams', { method: t.id ? 'PUT' : 'POST', body: d });
      teamsView(box);
    }) },
      h('h3', {}, t.id ? `Editar ${t.name}` : 'Nuevo equipo'),
      h('label', {}, 'Tipo', parent),
      f('name', 'Nombre'),
      h('label', {}, 'Descripción breve', h('textarea', { name: 'description', rows: 3 }, t.description || '')),
      mediaBox,
      f('sort', 'Orden', 'number'),
      f('min_months', 'Meses mínimos en la iglesia (0 = sin mínimo)', 'number'),
      h('label', {}, 'Aviso para quien se apunta (p. ej. entrevista previa). En un área se muestra al abrirla', h('textarea', { name: 'notice', rows: 2 }, t.notice || '')),
      h('label', { class: 'checks' }, h('input', { type: 'checkbox', name: 'active', checked: t.active !== 0 }), 'Visible en la web'),
      h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Guardar'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancelar'))));
    sync();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const row = (t, sub) => h('div', { class: `li${sub ? ' li-sub' : ''}` },
    h('div', {}, t.image_url ? h('img', { class: 'thumb', src: t.image_url, alt: '' }) : (t.icon ? `${t.icon} ` : ''), h('b', {}, t.name), t.active ? '' : ' (oculto)', t.min_months ? h('span', { class: 'muted' }, ` · mín. ${t.min_months} meses`) : null),
    h('button', { class: 'mini', onclick: () => edit(t) }, 'Editar'));
  box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-sm', onclick: () => edit() }, '+ Nuevo equipo o área'), h('span', { class: 'muted' }, `${areas.length} áreas · ${teams.length - areas.length} subequipos`)), editor,
    ...(areas.length ? areas.map((a) => h('div', { class: 'card group' }, row(a, false), subsOf(a.id).map((t) => row(t, true)),
      h('button', { class: 'mini add-sub', onclick: () => edit({ parent_id: a.id }) }, `+ Subequipo en ${a.name}`))) : [h('p', { class: 'muted' }, 'Aún no hay equipos.')]));
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
  // Un líder se asigna a subequipos (o a un área sin subequipos), no a las áreas que los agrupan
  const selectable = teams.filter((t) => t.parent_id || !teams.some((c) => c.parent_id === t.id)).map((t) => ({ id: t.id, name: t.parent_name && t.parent_name !== t.name ? `${t.parent_name} › ${t.name}` : t.name }));
  const checks = (name, items, selected) => h('div', { class: 'checks' }, items.map((i) => h('label', {}, h('input', { type: 'checkbox', name, value: i.id, checked: selected.includes(i.id) }), i.name)));
  const edit = (u = { role: 'leader', city_ids: [], team_ids: [], active: 1 }) => {
    const roleSel = h('select', { name: 'role', disabled: !!u.id }, ['leader', 'bases', 'gc'].map((r) => h('option', { value: r, selected: u.role === r }, ROLE[r])));
    const teamBox = h('div', {}, h('p', { class: 'muted' }, 'Equipos que lidera'), checks('team_ids', selectable, u.team_ids));
    const syncRole = () => { teamBox.hidden = roleSel.value !== 'leader'; };
    roleSel.addEventListener('change', syncRole);
    editor.replaceChildren(h('form', { class: 'card form', onsubmit: guard(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { email: f.get('email'), name: f.get('name'), phone: f.get('phone'), role: u.id ? u.role : roleSel.value, active: e.target.active.checked, city_ids: f.getAll('city_ids'), team_ids: f.getAll('team_ids') };
      await api(u.id ? `/panel/admin/users/${u.id}` : '/panel/admin/users', { method: u.id ? 'PUT' : 'POST', body });
      usersView(box);
    }) },
      h('h3', {}, u.id ? `Editar ${u.email}` : 'Nueva persona'),
      h('div', { class: 'row2' }, h('label', {}, 'Nombre', h('input', { name: 'name', value: u.name || '' })), h('label', {}, 'Email', h('input', { name: 'email', type: 'email', value: u.email || '', required: true, readonly: !!u.id }))),
      h('label', {}, 'Teléfono (para que puedan contactarle)', h('input', { name: 'phone', type: 'tel', value: u.phone || '', placeholder: '+34 600 000 000', autocomplete: 'off' })),
      h('label', {}, 'Rol', roleSel),
      h('div', {}, h('p', { class: 'muted' }, 'Ciudades'), checks('city_ids', cities, u.city_ids)), teamBox,
      h('label', { class: 'checks' }, h('input', { type: 'checkbox', name: 'active', checked: !!u.active }), 'Activo'),
      h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Guardar'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancelar'),
        u.id ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => { if (confirm(`¿Eliminar a ${u.email}?`)) { await api(`/panel/admin/users/${u.id}`, { method: 'DELETE' }); usersView(box); } }) }, 'Eliminar') : null)));
    syncRole();
  };
  const cityName = (id) => cities.find((c) => c.id === id)?.name;
  const teamName = (id) => selectable.find((t) => t.id === id)?.name;
  box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-sm', onclick: () => edit() }, '+ Añadir líder o voluntario')), editor,
    h('div', { class: 'card' }, users.filter((u) => u.role !== 'admin').map((u) => h('div', { class: 'li' },
      h('div', {}, h('b', {}, u.name || u.email), u.active ? '' : ' (inactivo)', h('div', { class: 'muted' }, `${ROLE[u.role]} · ${u.email}`), u.phone ? h('div', {}, '📞 ', h('a', { href: `tel:${u.phone}` }, u.phone)) : h('div', { class: 'muted' }, 'Sin teléfono'), h('div', { class: 'muted' }, [u.city_ids.map(cityName).join(', '), u.role === 'leader' ? u.team_ids.map(teamName).join(', ') : ''].filter(Boolean).join(' — '))),
      h('button', { class: 'mini', onclick: () => edit(u) }, 'Editar')))));
}


// ---------- Emails (solo administración) ----------
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const GROUP_ICON = { persona: '🙋', lider: '📞', bases: '📘', gc: '🏠' };

async function emailsView(box) {
  const data = await api('/panel/admin/emails');
  const editor = h('div');
  const sched = data.schedule;

  const daySel = h('select', {}, DAYS.map((d, i) => h('option', { value: i, selected: i === sched.day }, d)));
  const hourSel = h('select', {}, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === sched.hour }, `${String(i).padStart(2, '0')}:00`)));
  const schedule = h('div', { class: 'card stack' },
    h('h3', {}, 'Cuándo se envían'),
    h('p', { class: 'muted' }, 'Inmediatos: en cuanto alguien se apunta (a la persona, al voluntario de Bases o de GC que le toque y al líder si ya tiene Bases 1 y 2). Si Planning Center no responde, se reintenta cada 5 minutos.'),
    h('p', { class: 'muted' }, `Resumen semanal (líderes y voluntarios): una vez por semana, el día y la hora que elijas, en hora de ${sched.tz}. Solo se envía a quien tenga a alguien pendiente. Ese mismo día se vuelve a mirar en Planning Center quién ya ha completado Bases 2.`),
    h('div', { class: 'toolbar' }, h('label', {}, 'Día ', daySel), h('label', {}, 'Hora ', hourSel),
      h('button', { class: 'btn btn-sm', onclick: guard(async () => { await api('/panel/admin/email-schedule', { method: 'PUT', body: { day: Number(daySel.value), hour: Number(hourSel.value) } }); say('Horario guardado.'); }) }, 'Guardar horario')));

  const open = (t) => {
    const subject = h('input', { name: 'subject', value: t.subject });
    const heading = h('input', { name: 'heading', value: t.heading });
    const body = h('textarea', { name: 'body', rows: 16, class: 'mono' }, t.body);
    const enabled = h('input', { type: 'checkbox', name: 'enabled', checked: t.enabled });
    const status = h('span', { class: 'muted' });
    const frame = h('iframe', { name: 'pv-' + t.key, class: 'preview', title: 'Vista previa' });
    const insert = (text) => { const a = body.selectionStart, b = body.selectionEnd; body.setRangeText(text, a, b, 'end'); body.focus(); };
    const values = () => ({ subject: subject.value, heading: heading.value, body: body.value, enabled: enabled.checked });
    const form = h('form', { method: 'post', action: `/api/panel/admin/emails/${t.key}/preview`, target: frame.name, class: 'hidden' },
      h('input', { type: 'hidden', name: 'subject' }), h('input', { type: 'hidden', name: 'heading' }), h('input', { type: 'hidden', name: 'body' }));
    const preview = () => { form.subject.value = subject.value; form.heading.value = heading.value; form.body.value = body.value; form.submit(); };
    const chips = h('div', { class: 'emojis' },
      t.vars.map((v) => h('button', { type: 'button', class: 'mini chip', title: v.desc + (v.block ? ' (va solo, en su propio párrafo)' : ''), onclick: () => insert(v.block ? `\n\n{{${v.name}}}\n\n` : `{{${v.name}}}`) }, `{{${v.name}}}`)),
      t.flags.map((f) => h('button', { type: 'button', class: 'mini chip alt', title: `Solo si: ${f.desc}`, onclick: () => insert(`{{#${f.name}}}texto{{/${f.name}}}`) }, `si ${f.name}`)));
    editor.replaceChildren(h('div', { class: 'card form' },
      h('h3', {}, t.title), h('p', { class: 'muted' }, `Para: ${t.to}. ${t.when}`),
      h('label', {}, 'Asunto', subject), h('label', {}, 'Título dentro del email', heading),
      h('label', {}, 'Cuerpo', body),
      h('p', { class: 'muted' }, 'Toca un marcador para insertarlo donde tengas el cursor. Los morados son condicionales: solo se muestran si se cumple la condición.'),
      chips,
      h('details', {}, h('summary', {}, 'Cómo se escribe'), h('div', { class: 'muted' },
        h('p', {}, 'Una línea en blanco separa los párrafos. ', h('code', {}, '**negrita**'), ' · ', h('code', {}, '_cursiva_'), ' · ', h('code', {}, '- elemento'), ' para listas · ', h('code', {}, '[texto](https://…)'), ' para enlaces · ', h('code', {}, '[[Texto del botón|https://…]]'), ' para un botón.'),
        h('p', {}, 'Los marcadores marcados como «bloque» (listas de personas, avisos…) van solos en su párrafo. Si falta uno imprescindible o hay uno que no existe, no te dejará guardar.'))),
      h('label', { class: 'checks' }, enabled, 'Enviar este email (desmárcalo para dejar de enviarlo)'),
      h('div', { class: 'acts' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: guard(async () => {
          const out = await api(`/panel/admin/emails/${t.key}`, { method: 'PUT', body: values() });
          status.textContent = 'Guardado ✓'; Object.assign(t, out); preview();
          list(); // refresca las etiquetas «Personalizado / Desactivado»
        }) }, 'Guardar'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: preview }, 'Vista previa'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => {
          const out = await api(`/panel/admin/emails/${t.key}/test`, { method: 'POST', body: values() });
          say(out.sent ? `Prueba enviada a ${out.to}.` : 'Sin SMTP configurado: la prueba solo se ha escrito en el registro del servidor.');
        }) }, 'Enviarme una prueba'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => {
          if (!confirm('¿Volver al texto original de este email? Se pierde lo que hayas escrito.')) return;
          const out = await api(`/panel/admin/emails/${t.key}`, { method: 'DELETE' });
          Object.assign(t, out); open(t); list();
        }) }, 'Restaurar el original'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cerrar'), status),
      form, frame));
    preview();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const listBox = h('div');
  const list = () => listBox.replaceChildren(...Object.entries(data.groups).flatMap(([g, label]) => [
    h('h3', { class: 'group-title' }, `${GROUP_ICON[g]} ${label}`),
    h('div', { class: 'card' }, data.templates.filter((t) => t.group === g).map((t) => h('div', { class: 'li' },
      h('div', {}, h('b', {}, t.title), t.customized ? h('span', { class: 'pill s-listo' }, 'Editado') : null, t.enabled ? null : h('span', { class: 'pill s-no_continua' }, 'Desactivado'), h('div', { class: 'muted' }, t.when)),
      h('button', { class: 'mini', onclick: () => open(t) }, 'Editar')))),
  ]));
  list();
  box.replaceChildren(schedule, editor, listBox);
}

// ---------- Estructura ----------
async function boot() {
  try { me = await api('/me'); } catch { return; }
  if (!me?.id) return;
  const tabs = [['apps', me.role === 'bases' ? 'Posible seguimiento (Bases)' : me.role === 'gc' ? 'Posible seguimiento (GC)' : 'Solicitudes', applicationsView]];
  if (me.role === 'admin') tabs.push(['teams', 'Equipos', teamsView], ['cities', 'Ciudades', citiesView], ['users', 'Líderes y voluntarios', usersView], ['emails', 'Emails', emailsView]);
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
