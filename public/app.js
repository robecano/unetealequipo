const $ = (s, r = document) => r.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

let data = { areas: [], cities: [] };
const allTeams = () => data.areas.flatMap((a) => a.teams);
const plural = (n) => `${n} equipo${n === 1 ? '' : 's'}`;

/** Tarjeta cuadrada de un área: foto (o degradado con emoji), nombre, descripción y nº de equipos. */
function areaCard(area, i) {
  const visual = area.image_url
    ? h('img', { src: area.image_url, alt: '', loading: 'lazy' })
    : h('span', { class: 'icon', 'aria-hidden': 'true' }, area.icon || area.name.slice(0, 1));
  return h('button', { class: `area g${i % 6}`, type: 'button', onclick: () => openArea(area), 'aria-label': `${area.name}: ver equipos` },
    h('div', { class: 'area-visual' }, visual),
    h('div', { class: 'area-body' },
      h('h3', {}, area.name),
      h('p', {}, area.description),
      h('span', { class: 'more' }, `${plural(area.teams.length)} ▾`)));
}

function renderAreas() {
  const q = $('#search').value.trim().toLowerCase();
  const list = data.areas.filter((a) => !q || `${a.name} ${a.description} ${a.teams.map((t) => t.name).join(' ')}`.toLowerCase().includes(q));
  $('#areas').replaceChildren(...(list.length ? list.map(areaCard) : [h('p', { class: 'muted' }, data.areas.length ? 'Ningún equipo coincide con tu búsqueda.' : 'Pronto verás aquí los equipos.')]));
}

/** Ventana del área: cabecera y un desplegable por subequipo con su información y el botón para apuntarse. */
function openArea(area) {
  const join = (team) => { selectTeam(team.id); $('#dlg').close(); location.hash = '#apuntate'; };
  const sub = (team) => h('details', { class: 'sub', open: area.teams.length === 1 },
    h('summary', {}, h('span', {}, team.name), team.notice ? h('span', { class: 'tag' }, 'Requisitos') : null),
    h('div', { class: 'sub-body' },
      h('p', {}, team.description),
      team.notice ? h('p', { class: 'alert' }, team.notice) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => join(team) }, 'Quiero unirme')));
  const list = h('div', { class: 'subs' }, area.teams.map(sub));
  // Al abrir uno se cierran los demás, para que la ventana no crezca sin fin
  list.addEventListener('toggle', (e) => { if (e.target.open) list.querySelectorAll('details[open]').forEach((d) => { if (d !== e.target) d.open = false; }); }, true);
  $('#dlg-body').replaceChildren(
    area.image_url ? h('img', { class: 'dlg-img', src: area.image_url, alt: '' }) : h('div', { class: 'dlg-icon' }, area.icon || ''),
    h('h3', {}, area.name),
    h('p', {}, area.description),
    area.teams.length > 1 && area.notice ? h('p', { class: 'info' }, area.notice) : null,
    area.teams.length > 1 ? h('p', { class: 'dlg-count' }, `${plural(area.teams.length)} · elige uno para saber más`) : null,
    list);
  $('#dlg').showModal();
}

function selectTeam(id) { $('[name=team_id]').value = String(id); updateNotice(); }

function updateNotice() {
  const team = allTeams().find((t) => String(t.id) === $('[name=team_id]').value);
  const tenure = $('[name=tenure]').value;
  const box = $('#team-notice');
  const lines = [];
  if (team?.area_notice) lines.push(team.area_notice);
  if (team?.notice) lines.push(team.notice);
  if (team && tenure !== '' && Number(tenure) < team.min_months) lines.push('Por ahora no llevas el tiempo mínimo en la iglesia para este equipo. Puedes apuntarte igualmente y te contaremos las opciones.');
  box.textContent = lines.join(' ');
  box.hidden = !lines.length;
}

async function init() {
  try {
    data = await (await fetch('/api/public')).json();
  } catch {
    $('#areas').replaceChildren(h('p', { class: 'error' }, 'No se han podido cargar los equipos. Recarga la página.'));
    return;
  }
  renderAreas();
  $('[name=city_id]').replaceChildren(h('option', { value: '' }, 'Elige tu ciudad…'), ...data.cities.map((c) => h('option', { value: c.id }, c.name)));
  $('[name=team_id]').replaceChildren(h('option', { value: '' }, 'Elige un equipo…'),
    ...data.areas.map((a) => h('optgroup', { label: a.name }, a.teams.map((t) => h('option', { value: t.id }, t.name)))));
}

$('#search').addEventListener('input', renderAreas);
$('[name=team_id]').addEventListener('change', updateNotice);
$('[name=tenure]').addEventListener('change', updateNotice);
$('#dlg-close').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg')) $('#dlg').close(); });
$('#again').addEventListener('click', () => { $('#form').reset(); $('#form').hidden = false; $('#done').hidden = true; updateNotice(); });

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  const err = $('#error');
  err.hidden = true;
  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const res = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, bases1: body.bases1 === 'si', bases2: body.bases2 === 'si', gc: body.gc === 'si' }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'No se pudo enviar. Inténtalo de nuevo.');
    e.target.hidden = true;
    $('#done').hidden = false;
    $('#done').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar';
  }
});

init();
