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

// Aviso flotante con un botón de «Deshacer» (p. ej. tras borrar una solicitud). Vive fuera de #root para
// sobrevivir a que se repinte la vista al recargar la lista.
const toastBox = h('div', { class: 'toast-box' });
document.body.append(toastBox);
function toast(msg, { actionLabel, onAction, timeout = 8000 } = {}) {
  const el = h('div', { class: 'toast' }, h('span', {}, msg),
    actionLabel ? h('button', { class: 'mini', onclick: guard(async () => { await onAction(); el.remove(); }) }, actionLabel) : null);
  toastBox.append(el);
  setTimeout(() => el.remove(), timeout);
}

const STATUS = { recibida: 'Recibida', no_apto_aun: 'Aún sin antigüedad', listo: 'Para contactar', contactado: 'Contactado', visito: 'Visitó el equipo', confirmado: 'Confirmado', no_continua: 'No continúa' };
const ROLE = { admin: 'Administración total', city_admin: 'Admin de ciudad', leader: 'Seguimiento de Equipos', bases: 'Seguimiento de Bases', gc: 'Seguimiento de GC' };
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
// Se acepta como hecho lo que diga Planning Center o, si no lo tiene, lo que declaró la persona (misma regla que usa el sistema para decidir).
const accepted = (pco, self) => !!pco || !!self;
const mark = (ok) => h('span', { class: ok ? 'ok' : 'no' }, ok ? '✓' : '✗');
/**
 * B1/GC/B2: el ✓/✗ del curso y, debajo, si ya envió el formulario de registro — pero solo cuando de verdad le
 * falta ese curso (si ya lo tiene, el formulario es irrelevante) y el rol que mira puede necesitarlo (Bases ve
 * las suyas, GC la suya, Equipos/administración las tres). Así no hacen falta columnas aparte para esto.
 */
function course(pco, self, isGap, formSubmitted, showForm) {
  return h('td', {}, mark(accepted(pco, self)),
    showForm && isGap && formSubmitted != null ? h('div', { class: 'form-hint' }, formSubmitted ? h('span', { class: 'ok' }, 'Formulario ✓') : h('span', { class: 'muted' }, 'Sin formulario')) : null);
}
// A quién le toca contactar (misma regla que el servidor): a Bases si Planning Center no confirma B1 o B2 (aunque
// la persona lo declarase); a GC si ya tiene B1 (declarado cuenta) y Planning Center no confirma el GC.
const needsBases = (a) => !a.pco_bases1 || !a.pco_bases2;
const needsGc = (a) => accepted(a.pco_bases1, a.self_bases1) && !a.pco_gc;

const CATEGORY = { falta_bases1: 'Falta Bases 1', falta_bases2: 'Falta Bases 2', falta_gc: 'Falta GC', completo: 'Completo' };

/** «Verificado en PCO»: si no cuadra, el motivo y el consejo (preguntar a la persona, o avisar al equipo de PCO del campus); si le falta algo de verdad, el recordatorio, aunque esté contrastado. */
function contrastado(c) {
  if (!c) return h('td', {}, '—');
  return h('td', {}, h('span', { class: c.ok ? 'ok' : 'no' }, c.label), !c.ok ? h('div', { class: 'warn-mini' }, c.guidance) : null, c.reminder ? h('div', { class: 'warn-mini' }, c.reminder) : null);
}

/** Lo que le falta a esta persona según Planning Center, para la vista propia de seguimiento de Bases o de GC: cada curso pendiente, y si es autodeclarado sin confirmar (aviso de actualizar PCO) o falta de verdad. */
function roleGaps(gaps) {
  if (!gaps?.length) return h('td', {}, h('span', { class: 'ok' }, 'Nada pendiente'));
  return h('td', {}, gaps.map((g) => h('div', {},
    g.mismatch
      ? h('span', { class: 'no' }, `${g.label}: actualizar información en PCO contrastándola${g.key === 'gc' ? '' : '. Es posible que le haya faltado marcar la asistencia.'}`)
      : h('span', { class: 'muted' }, `${g.label}: no lo tiene hecho`))));
}
/** «Contactada 3 veces: 12 sept, 15 sept, 20 sept» o «Aún no contactada», para Bases/GC: todas las fechas, no solo la última. */
const contactSummary = (dates) => (dates?.length ? `Contactada ${dates.length} ${dates.length === 1 ? 'vez' : 'veces'}: ${dates.map(fmtDate).join(', ')}` : 'Aún no contactada');

async function applicationsView(box) {
  const q = h('input', { type: 'search', placeholder: 'Buscar nombre, email, teléfono…' });
  const st = h('select', {}, h('option', { value: '' }, 'Todos los estados'), ...Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));
  const isAdminLike = ['admin', 'city_admin'].includes(me.role);
  const canManageStatus = ['admin', 'city_admin', 'leader'].includes(me.role);
  const cat = isAdminLike ? h('select', {}, h('option', { value: '' }, 'Todas las categorías'), ...Object.entries(CATEGORY).map(([k, v]) => h('option', { value: k }, v))) : null;
  const body = h('div');
  const isRoleLeader = ['bases', 'gc'].includes(me.role);
  const infoHeader = isRoleLeader ? 'Qué le falta' : 'Verificado en PCO';
  // Las columnas de formulario solo interesan a quien puede necesitar ese curso: Bases ve las suyas, GC la suya,
  // y seguimiento de Equipos/administración ven las tres (ellos ven a todos, tengan o no algo pendiente).
  const showFormBases = ['bases', 'leader', 'admin', 'city_admin'].includes(me.role);
  const showFormGc = ['gc', 'leader', 'admin', 'city_admin'].includes(me.role);
  let rows = [];
  let sortKey = null, sortDir = 1;
  const SORTERS = {
    persona: (a) => (a.name || '').toLowerCase(),
    equipo: (a) => `${a.team || ''} ${a.city || ''}`.toLowerCase(),
    estado: (a) => STATUS[a.status] || a.status,
    b1: (a) => (accepted(a.pco_bases1, a.self_bases1) ? 1 : 0),
    gc: (a) => (accepted(a.pco_gc, a.self_gc) ? 1 : 0),
    b2: (a) => (accepted(a.pco_bases2, a.self_bases2) ? 1 : 0),
    info: (a) => (isRoleLeader ? (a[me.role === 'bases' ? 'basesGaps' : 'gcGaps']?.length ? 1 : 0) : (a.contrastado?.ok ? 0 : 1)),
  };
  const sorted = () => {
    if (!sortKey) return rows;
    const f = SORTERS[sortKey];
    return [...rows].sort((x, y) => { const vx = f(x), vy = f(y); return (vx > vy ? 1 : vx < vy ? -1 : 0) * sortDir; });
  };
  // Descarga en CSV con los mismos filtros que estás viendo (estado, categoría y búsqueda)
  const exportLink = h('a', { class: 'mini export', download: '' }, '⬇ Exportar CSV');
  const setExport = (n) => {
    exportLink.href = `/api/panel/applications.csv?status=${encodeURIComponent(st.value)}&q=${encodeURIComponent(q.value)}${cat ? `&category=${encodeURIComponent(cat.value)}` : ''}`;
    exportLink.textContent = `⬇ Exportar CSV (${n})`;
  };
  const th = (key, label) => h('th', key ? { class: 'sortable', onclick: () => { sortDir = sortKey === key ? -sortDir : 1; sortKey = key; draw(); } } : {}, label, key && sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
  const draw = () => {
    const act = (id, patch, label) => h('button', { onclick: guard(async () => { await api(`/panel/applications/${id}`, { method: 'PATCH', body: patch }); load(); }) }, label);
    const list = sorted();
    body.replaceChildren(list.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, [th('persona', 'Persona'), th('equipo', 'Equipo'), th('estado', 'Estado'), th('b1', 'B1'), th('gc', 'GC'), th('b2', 'B2'),
        th('info', infoHeader), th(null, 'Acciones')].filter(Boolean))),
      h('tbody', {}, list.map((a) => h('tr', {},
        h('td', {}, h('b', {}, a.name), h('br'), h('a', { href: `tel:${a.phone}` }, a.phone), h('br'), h('a', { href: `mailto:${a.email}` }, a.email),
          a.pco_url ? h('br') : null, a.pco_url ? h('a', { href: a.pco_url, target: '_blank', rel: 'noopener' }, 'Perfil PCO') : null,
          a.gc_group_name ? h('br') : null, a.gc_group_name ? h('span', { class: 'muted' }, `GC: ${a.gc_group_name}`) : null,
          h('br'), h('span', { class: 'muted' }, `${fmtDate(a.created_at)} · ${TENURE[a.tenure_months] ?? ''}`)),
        h('td', {}, a.team, h('br'), h('span', { class: 'muted' }, a.city)),
        h('td', {}, h('span', { class: `pill s-${a.status}` }, STATUS[a.status] || a.status), a.followup_at && ['contactado', 'visito', 'listo'].includes(a.status) ? h('div', { class: 'muted' }, `Seguimiento: ${fmtDate(a.followup_at)}`) : null, a.error ? h('div', { class: 'error' }, a.error) : null,
          // Solo administración (total o de ciudad): si falta asignar seguimiento de Equipos, de Bases o de GC
          isAdminLike && a.leaders?.length === 0 ? h('div', { class: 'no' }, 'Sin seguimiento de Equipo asignado') : null,
          isAdminLike && a.basesLeaders?.length === 0 ? h('div', { class: 'no' }, 'Sin seguimiento de Bases asignado') : null,
          isAdminLike && a.gcLeaders?.length === 0 ? h('div', { class: 'no' }, 'Sin seguimiento de GC asignado') : null,
          // Para que quien hace seguimiento de Equipos vea si Bases o GC ya han contactado, sin tener que preguntarles
          needsBases(a) ? h('div', { class: 'muted' }, 'Bases: ', a.bases_contact_count ? h('span', { class: 'ok' }, contactSummary(a.bases_contact_dates)) : h('span', { class: 'no' }, 'aún no contactada')) : null,
          needsGc(a) ? h('div', { class: 'muted' }, 'GC: ', a.gc_contact_count ? h('span', { class: 'ok' }, contactSummary(a.gc_contact_dates)) : h('span', { class: 'no' }, 'aún no contactada')) : null),
        course(a.pco_bases1, a.self_bases1, a.basesGaps.some((g) => g.key === 'bases1'), a.form_bases1, showFormBases),
        course(a.pco_gc, a.self_gc, a.gcGaps.some((g) => g.key === 'gc'), a.form_gc, showFormGc),
        course(a.pco_bases2, a.self_bases2, a.basesGaps.some((g) => g.key === 'bases2'), a.form_bases2, showFormBases),
        isRoleLeader ? roleGaps(a[me.role === 'bases' ? 'basesGaps' : 'gcGaps']) : contrastado(a.contrastado),
        h('td', {}, h('div', { class: 'acts' },
          // Bases y GC marcan que han contactado (se ve en «Estado»): cada pulsación añade un contacto nuevo, y se puede deshacer el último
          isRoleLeader ? h('div', { class: 'stack' },
            h('div', { class: 'acts' }, act(a.id, { contact: true }, 'Contactar'),
              a[`${me.role}_contact_count`] ? h('button', { class: 'mini', onclick: guard(async () => { await api(`/panel/applications/${a.id}/undo-contact`, { method: 'POST' }); load(); }) }, 'Deshacer') : null),
            h('span', { class: 'muted' }, contactSummary(a[`${me.role}_contact_dates`]))) : null,
          // El estado (Contacté/Visitó/Resolver/No continúa) y Borrar los llevan administración y seguimiento de Equipos; Bases y GC solo ven su lista.
          canManageStatus && ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'contactado' }, 'Contacté') : null,
          canManageStatus && ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'visito' }, 'Visitó') : null,
          canManageStatus && ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'confirmado' }, 'Resolver') : null,
          canManageStatus && ['listo', 'contactado', 'visito'].includes(a.status) ? act(a.id, { status: 'no_continua' }, 'No continúa') : null,
          canManageStatus && ['contactado', 'visito', 'confirmado', 'no_continua'].includes(a.status) ? h('button', { class: 'mini', onclick: guard(async () => { await api(`/panel/applications/${a.id}/undo-status`, { method: 'POST' }); load(); }) }, 'Deshacer estado') : null,
          // Vuelve a comprobar Bases 1, Bases 2, GC y los formularios en Planning Center al momento, sin esperar al refresco periódico. Para cualquiera que vea la solicitud.
          !['recibida', 'no_apto_aun'].includes(a.status) ? h('button', { class: 'mini', onclick: guard(async () => { await api(`/panel/applications/${a.id}/refresh-pco`, { method: 'POST' }); load(); }) }, 'Actualizar Planning Center') : null,
          canManageStatus ? h('button', { class: 'danger', onclick: guard(async () => {
            if (!confirm(`¿Borrar la solicitud de ${a.name}?\n\nDeja de verse en el panel y en los resúmenes; se puede deshacer justo después con el aviso que aparece abajo.\n(La nota en su perfil de Planning Center no se borra.)`)) return;
            await api(`/panel/applications/${a.id}`, { method: 'DELETE' });
            load();
            toast(`Solicitud de ${a.name} borrada.`, { actionLabel: 'Deshacer', onAction: async () => { await api(`/panel/applications/${a.id}/restore`, { method: 'POST' }); load(); } });
          }) }, 'Borrar') : null,
          isAdminLike && a.status === 'recibida' ? h('button', { onclick: guard(async () => { await api(`/panel/admin/applications/${a.id}/reprocess`, { method: 'POST' }); load(); }) }, 'Reprocesar') : null)))))))
      : h('div', { class: 'empty card' }, 'No hay solicitudes con estos filtros.'));
  };
  // Evita que una respuesta lenta de un filtro anterior sobreescriba la de uno más reciente (dos load() casi seguidos, p. ej. al cambiar dos filtros a la vez)
  let loadSeq = 0;
  const load = guard(async () => {
    const seq = ++loadSeq;
    const fresh = await api(`/panel/applications?status=${encodeURIComponent(st.value)}&q=${encodeURIComponent(q.value)}${cat ? `&category=${encodeURIComponent(cat.value)}` : ''}`);
    if (seq !== loadSeq) return; // ya hay una petición más nueva en marcha: se descarta esta
    rows = fresh;
    setExport(rows.length);
    draw();
  });
  q.addEventListener('input', () => { clearTimeout(q.t); q.t = setTimeout(load, 250); });
  st.addEventListener('change', load);
  if (cat) cat.addEventListener('change', load);
  box.replaceChildren(h('div', { class: 'toolbar' }, q, st, cat, exportLink), body);
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
  // Enfoque de la foto en la ventana del área (marco 4:3): 0 = arriba, 100 = abajo. Sirve para que no se corten las caras.
  const pos = h('input', { type: 'range', name: 'image_pos', min: '0', max: '100', step: '1', value: String(t.image_pos ?? 30) });
  const framed = h('div', { class: 'frame-preview' });
  const draw = () => {
    preview.replaceChildren(image.value.trim() ? h('img', { src: image.value.trim(), alt: '' }) : h('span', { class: 'icon' }, icon.value.trim() || '🙂'));
    framed.replaceChildren(image.value.trim() ? h('img', { src: image.value.trim(), alt: '' }) : h('span', { class: 'muted' }, 'Sin foto'));
    const im = framed.querySelector('img');
    if (im) im.style.objectPosition = `50% ${pos.value}%`;
  };
  pos.addEventListener('input', draw);
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
      h('label', {}, 'Enfoque de la foto en la ventana (arriba ↔ abajo)', pos, framed),
      h('button', { type: 'button', class: 'mini', onclick: () => { image.value = ''; status.textContent = 'Imagen quitada. Pulsa Guardar.'; draw(); } }, 'Quitar imagen'),
      status));
}

async function teamsView(box) {
  const [teams, cities] = await Promise.all([api('/panel/admin/teams'), api('/panel/admin/cities')]);
  const areas = teams.filter((t) => !t.parent_id);
  const subsOf = (id) => teams.filter((t) => t.parent_id === id);
  // El admin de ciudad ve todas las ciudades pero solo puede marcar o quitar la suya (las demás quedan bloqueadas)
  const lockedCityIds = me.role === 'city_admin' ? cities.filter((c) => !me.city_ids.includes(c.id)).map((c) => c.id) : [];
  const editor = h('div');
  const edit = (t = {}) => {
    const f = (name, label, type = 'text') => h('label', {}, label, h('input', { name, type, value: t[name] ?? '' }));
    const parent = h('select', { name: 'parent_id' }, h('option', { value: '' }, '— Es un área (aparece como tarjeta en la web) —'),
      ...areas.filter((a) => a.id !== t.id).map((a) => h('option', { value: a.id, selected: a.id === t.parent_id }, `Subequipo de: ${a.name}`)));
    const mediaBox = h('div', {}, media(t));
    const sync = () => { mediaBox.hidden = !!parent.value; };
    parent.addEventListener('change', sync);
    // Solo tiene sentido restringir por ciudad lo que de verdad se elige: un subequipo, o un área sin subequipos (que se comporta como equipo)
    const citiesBox = t.id && !t.parent_id && subsOf(t.id).length
      ? h('p', { class: 'muted' }, 'Esta área tiene subequipos: la disponibilidad por ciudad se marca en cada uno de ellos, no aquí.')
      : h('div', {}, h('p', { class: 'muted' }, lockedCityIds.length ? 'Ciudades donde se puede elegir (solo puedes cambiar la tuya)' : 'Ciudades donde se puede elegir (vacío = disponible en todas)'),
          checks('city_ids', cities, t.city_ids || [], lockedCityIds));
    editor.replaceChildren(h('form', { class: 'card form', onsubmit: guard(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const d = Object.fromEntries(fd.entries());
      d.active = e.target.active.checked;
      d.city_ids = fd.getAll('city_ids');
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
      citiesBox,
      h('label', { class: 'checks' }, h('input', { type: 'checkbox', name: 'active', checked: t.active !== 0 }), 'Visible en la web'),
      h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Guardar'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancelar'))));
    sync();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const cityName = (id) => cities.find((c) => c.id === id)?.name;
  const row = (t, sub) => h('div', { class: `li${sub ? ' li-sub' : ''}` },
    h('div', {}, t.image_url ? h('img', { class: 'thumb', src: t.image_url, alt: '' }) : (t.icon ? `${t.icon} ` : ''), h('b', {}, t.name), t.active ? '' : ' (oculto)', t.min_months ? h('span', { class: 'muted' }, ` · mín. ${t.min_months} meses`) : null,
      t.city_ids.length ? h('span', { class: 'muted' }, ` · solo en ${t.city_ids.map(cityName).join(', ')}`) : null),
    h('div', { class: 'acts' },
      h('button', { class: 'mini', onclick: () => edit(t) }, 'Editar'),
      h('button', { class: 'mini danger', onclick: guard(async () => {
        const subs = sub ? [] : subsOf(t.id);
        const msg = subs.length
          ? `¿Borrar «${t.name}» y sus ${subs.length} subequipo${subs.length > 1 ? 's' : ''}? No se puede deshacer.`
          : `¿Borrar «${t.name}»? No se puede deshacer.`;
        if (!confirm(msg)) return;
        await api(`/panel/admin/teams/${t.id}`, { method: 'DELETE' });
        teamsView(box);
      }) }, 'Borrar')));
  box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-sm', onclick: () => edit() }, '+ Nuevo equipo o área'), h('span', { class: 'muted' }, `${areas.length} áreas · ${teams.length - areas.length} subequipos`)), editor,
    ...(areas.length ? areas.map((a) => h('div', { class: 'card group' }, row(a, false), subsOf(a.id).map((t) => row(t, true)),
      h('button', { class: 'mini add-sub', onclick: () => edit({ parent_id: a.id }) }, `+ Subequipo en ${a.name}`))) : [h('p', { class: 'muted' }, 'Aún no hay equipos.')]));
}

const checks = (name, items, selected, disabledIds = []) => h('div', { class: 'checks' }, items.map((i) => h('label', {}, h('input', { type: 'checkbox', name, value: i.id, checked: selected.includes(i.id), disabled: disabledIds.includes(i.id) }), i.name)));

async function citiesView(box) {
  const cities = await api('/panel/admin/cities');
  const input = h('input', { placeholder: 'Nueva ciudad' });
  box.replaceChildren(h('form', { class: 'toolbar', onsubmit: guard(async (e) => { e.preventDefault(); await api('/panel/admin/cities', { method: 'POST', body: { name: input.value } }); citiesView(box); }) }, input, h('button', { class: 'btn btn-sm' }, 'Añadir')),
    h('div', { class: 'card' }, cities.map((c) => h('div', { class: 'li' }, h('span', {}, c.name, c.active ? '' : ' (oculta)'), h('button', { class: 'mini', onclick: guard(async () => { await api(`/panel/admin/cities/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); citiesView(box); }) }, c.active ? 'Ocultar' : 'Mostrar')))));
}

async function usersView(box) {
  const [users, cities] = await Promise.all([api('/panel/admin/users'), api('/panel/admin/cities')]);
  // El admin de ciudad solo puede asignar su(s) propia(s) ciudad(es); el total, cualquiera. Y solo el total da de alta a otros admin de ciudad.
  const assignableCities = me.role === 'city_admin' ? cities.filter((c) => me.city_ids.includes(c.id)) : cities;
  const assignableRoles = me.role === 'admin' ? ['city_admin', 'leader', 'bases', 'gc'] : ['leader', 'bases', 'gc'];
  const editor = h('div');
  const edit = (u = { role: assignableRoles[0], city_ids: [], active: 1 }) => {
    const role = h('select', { name: 'role' }, assignableRoles.map((k) => h('option', { value: k, selected: k === u.role }, ROLE[k])));
    editor.replaceChildren(h('form', { class: 'card form', onsubmit: guard(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { email: f.get('email'), name: f.get('name'), phone: f.get('phone'), role: f.get('role'), active: e.target.active.checked, city_ids: f.getAll('city_ids') };
      await api(u.id ? `/panel/admin/users/${u.id}` : '/panel/admin/users', { method: u.id ? 'PUT' : 'POST', body });
      usersView(box);
    }) },
      h('h3', {}, u.id ? `Editar a ${u.name || u.email}` : 'Nuevo usuario'),
      h('div', { class: 'row2' }, h('label', {}, 'Nombre', h('input', { name: 'name', value: u.name || '' })), h('label', {}, 'Email', h('input', { name: 'email', type: 'email', value: u.email || '', required: true }))),
      h('label', {}, 'Rol', role),
      h('label', {}, 'Teléfono (para que puedan contactarle)', h('input', { name: 'phone', type: 'tel', value: u.phone || '', placeholder: '+34 600 000 000', autocomplete: 'off' })),
      h('div', {}, h('p', { class: 'muted' }, 'Ciudades'), checks('city_ids', assignableCities, u.city_ids)),
      h('label', { class: 'checks' }, h('input', { type: 'checkbox', name: 'active', checked: !!u.active }), 'Activo'),
      h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Guardar'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancelar'),
        u.id ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => { if (confirm(`¿Eliminar a ${u.email}?`)) { await api(`/panel/admin/users/${u.id}`, { method: 'DELETE' }); usersView(box); } }) }, 'Eliminar') : null)));
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const cityName = (id) => cities.find((c) => c.id === id)?.name;
  box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-sm', onclick: () => edit() }, '+ Añadir')), editor,
    h('div', { class: 'card' }, users.filter((u) => u.role !== 'admin').map((u) => h('div', { class: 'li' },
      h('div', {}, h('b', {}, u.name || u.email), ' ', h('span', { class: 'pill s-listo' }, ROLE[u.role] || u.role), u.active ? '' : ' (inactivo)', h('div', { class: 'muted' }, u.email), u.phone ? h('div', {}, '📞 ', h('a', { href: `tel:${u.phone}` }, u.phone)) : h('div', { class: 'muted' }, 'Sin teléfono'), h('div', { class: 'muted' }, u.city_ids.map(cityName).join(', '))),
      h('button', { class: 'mini', onclick: () => edit(u) }, 'Editar')))));
}


// ---------- Emails (administración total o de ciudad: un texto por ciudad) ----------
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const GROUP_ICON = { persona: '🙋', lider: '📞', bases: '📚', gc: '🤝', admin: '🛠️' };

async function emailsView(box) {
  let data = await api('/panel/admin/emails');
  let cityId = data.city_id;
  const canEditSchedule = ['admin', 'city_admin'].includes(me.role);
  const editor = h('div');
  const listBox = h('div');

  const citySelect = h('select', {}, data.cities.map((c) => h('option', { value: c.id, selected: c.id === cityId }, c.name)));
  citySelect.addEventListener('change', guard(async () => {
    cityId = Number(citySelect.value);
    data = await api(`/panel/admin/emails?city_id=${cityId}`);
    editor.replaceChildren();
    renderSchedule();
    list();
  }));

  const slotsBox = h('div', { class: 'stack' });
  let slots = [];
  const scheduleCard = h('div', { class: 'card stack' });
  const drawSlots = () => {
    slotsBox.replaceChildren(...slots.map((s, i) => h('div', { class: 'toolbar' },
      h('select', { onchange: (e) => { slots[i].day = Number(e.target.value); } }, DAYS.map((d, di) => h('option', { value: di, selected: di === s.day }, d))),
      h('select', { onchange: (e) => { slots[i].hour = Number(e.target.value); } }, Array.from({ length: 24 }, (_, hh) => h('option', { value: hh, selected: hh === s.hour }, `${String(hh).padStart(2, '0')}:00`))),
      slots.length > 1 ? h('button', { class: 'mini', type: 'button', onclick: () => { slots.splice(i, 1); drawSlots(); } }, 'Quitar') : null)),
      h('button', {
        class: 'mini', type: 'button', onclick: () => {
          // Evita proponer un día y hora que ya esté en la lista (si no, el guardado falla por «envíos repetidos»)
          let day = 1, hour = 8;
          while (slots.some((s) => s.day === day && s.hour === hour)) { hour = (hour + 1) % 24; if (hour === 8) day = (day + 1) % 7; }
          slots.push({ day, hour }); drawSlots();
        },
      }, '+ Añadir otro envío'));
  };
  // El horario también es por ciudad: al cambiar de ciudad se vuelve a pintar con el horario de la que toque ahora.
  function renderSchedule() {
    slots = data.schedule.slots.map((s) => ({ ...s }));
    if (canEditSchedule) drawSlots();
    scheduleCard.replaceChildren(
      h('h3', {}, 'Cuándo se envían'),
      h('p', { class: 'muted' }, 'Inmediato: en cuanto alguien se apunta, a la persona. Si Planning Center no responde, se reintenta cada 5 minutos. Nadie recibe un email por cada solicitud: se ve en la lista programada (abajo) y en el panel en todo momento.'),
      h('p', { class: 'muted' }, `Lista de seguimiento: en los días y horas de abajo, en hora de ${data.schedule.tz}. Cada ciudad tiene su propio horario. Solo se envía a quien tenga alguna solicitud abierta en esa ciudad. Antes de cada envío se actualizan sus cursos con Planning Center.`),
      canEditSchedule ? slotsBox : h('p', {}, slots.map((s) => `${DAYS[s.day]} a las ${String(s.hour).padStart(2, '0')}:00`).join(' · ')),
      canEditSchedule ? h('button', {
        class: 'btn btn-sm', onclick: guard(async () => {
          const out = await api(`/panel/admin/email-schedule?city_id=${cityId}`, { method: 'PUT', body: { slots } });
          slots = out.slots.map((s) => ({ ...s })); drawSlots();
          say('Horario guardado.');
        }),
      }, 'Guardar horario') : null);
  }
  renderSchedule();

  const open = (t) => {
    const subject = h('input', { name: 'subject', value: t.subject });
    const heading = h('input', { name: 'heading', value: t.heading });
    const body = h('textarea', { name: 'body', rows: 16, class: 'mono' }, t.body);
    const enabled = h('input', { type: 'checkbox', name: 'enabled', checked: t.enabled });
    const status = h('span', { class: 'muted' });
    const frame = h('iframe', { name: 'pv-' + t.key, class: 'preview', title: 'Vista previa' });
    const insert = (text) => { const a = body.selectionStart, b = body.selectionEnd; body.setRangeText(text, a, b, 'end'); body.focus(); };
    const values = () => ({ subject: subject.value, heading: heading.value, body: body.value, enabled: enabled.checked });
    const form = h('form', { method: 'post', action: `/api/panel/admin/emails/${t.key}/preview?city_id=${cityId}`, target: frame.name, class: 'hidden' },
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
          const out = await api(`/panel/admin/emails/${t.key}?city_id=${cityId}`, { method: 'PUT', body: values() });
          status.textContent = 'Guardado ✓'; Object.assign(t, out); preview();
          list(); // refresca las etiquetas «Personalizado / Desactivado»
        }) }, 'Guardar'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: preview }, 'Vista previa'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => {
          const out = await api(`/panel/admin/emails/${t.key}/test?city_id=${cityId}`, { method: 'POST', body: values() });
          say(out.sent ? `Prueba enviada a ${out.to}.` : 'Sin SMTP configurado: la prueba solo se ha escrito en el registro del servidor.');
        }) }, 'Enviarme una prueba'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: guard(async () => {
          if (!confirm('¿Volver al texto original de este email para esta ciudad? Se pierde lo que hayas escrito.')) return;
          const out = await api(`/panel/admin/emails/${t.key}?city_id=${cityId}`, { method: 'DELETE' });
          Object.assign(t, out); open(t); list();
        }) }, 'Restaurar el original'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editor.replaceChildren() }, 'Cerrar'), status),
      form, frame));
    preview();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const list = () => listBox.replaceChildren(...Object.entries(data.groups).flatMap(([g, label]) => [
    h('h3', { class: 'group-title' }, `${GROUP_ICON[g]} ${label}`),
    h('div', { class: 'card' }, data.templates.filter((t) => t.group === g).map((t) => h('div', { class: 'li' },
      h('div', {}, h('b', {}, t.title), t.customized ? h('span', { class: 'pill s-listo' }, 'Editado') : null, t.enabled ? null : h('span', { class: 'pill s-no_continua' }, 'Desactivado'), h('div', { class: 'muted' }, t.when)),
      h('button', { class: 'mini', onclick: () => open(t) }, 'Editar')))),
  ]));
  list();
  box.replaceChildren(h('div', { class: 'toolbar' }, h('label', {}, 'Ciudad', citySelect)), scheduleCard, editor, listBox);
}

// ---------- Estructura ----------
async function boot() {
  try { me = await api('/me'); } catch { return; }
  if (!me?.id) return;
  const tabs = [['apps', 'Solicitudes', applicationsView]];
  if (['admin', 'city_admin'].includes(me.role)) tabs.push(['teams', 'Equipos', teamsView]);
  if (me.role === 'admin') tabs.push(['cities', 'Ciudades', citiesView]);
  if (['admin', 'city_admin'].includes(me.role)) tabs.push(['users', 'Usuarios', usersView], ['emails', 'Emails', emailsView]);
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
