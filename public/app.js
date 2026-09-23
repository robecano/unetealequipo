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
let galleryCity = ''; // ciudad elegida para explorar el escaparate (independiente de la del formulario)
const allTeams = () => data.areas.flatMap((a) => a.teams);
const plural = (n) => `${n} equipo${n === 1 ? '' : 's'}`;
// Un equipo sin ciudades marcadas está disponible en todas; si tiene alguna, solo en esas.
const availableIn = (team, cityId) => !cityId || !team.city_ids.length || team.city_ids.includes(cityId);
/** Áreas con solo los equipos disponibles en cityId (o todos, si no se ha elegido ciudad); sin áreas vacías. */
const areasFor = (cityId) => data.areas.map((a) => ({ ...a, teams: a.teams.filter((t) => availableIn(t, cityId)) })).filter((a) => a.teams.length);

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
  const cityId = galleryCity ? Number(galleryCity) : null;
  const available = areasFor(cityId);
  const list = available.filter((a) => !q || `${a.name} ${a.description} ${a.teams.map((t) => t.name).join(' ')}`.toLowerCase().includes(q));
  const empty = q ? 'Ningún equipo coincide con tu búsqueda.' : cityId ? 'Todavía no hay equipos disponibles en esa ciudad.' : 'Pronto verás aquí los equipos.';
  $('#areas').replaceChildren(...(list.length ? list.map(areaCard) : [h('p', { class: 'muted' }, empty)]));
}

/** Ventana del área: cabecera y un desplegable por subequipo con su información y el botón para apuntarse. */
function openArea(area) {
  const join = (team) => { $('#dlg').close(); goToForm(team.id); };
  const sub = (team) => h('details', { class: 'sub', open: area.teams.length === 1 },
    h('summary', {}, h('span', {}, team.name), team.notice ? h('span', { class: 'tag' }, 'Requisitos') : null),
    h('div', { class: 'sub-body' },
      h('p', {}, team.description),
      team.notice ? h('p', { class: 'alert' }, team.notice) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => join(team) }, 'Quiero unirme')));
  const list = h('div', { class: 'subs' }, area.teams.map(sub));
  // Al abrir uno se cierran los demás, para que la ventana no crezca sin fin
  list.addEventListener('toggle', (e) => { if (e.target.open) list.querySelectorAll('details[open]').forEach((d) => { if (d !== e.target) d.open = false; }); }, true);
  // replaceChildren escribe «null» si le pasas null: se filtran los huecos de los elementos opcionales
  const photo = area.image_url ? h('img', { class: 'dlg-img', src: area.image_url, alt: '' }) : null;
  if (photo) photo.style.objectPosition = `50% ${area.image_pos ?? 30}%`; // enfoque vertical elegido para que no se corten las caras
  $('#dlg-body').replaceChildren(...[
    photo || h('div', { class: 'dlg-icon' }, area.icon || ''),
    h('h3', {}, area.name),
    h('p', {}, area.description),
    area.teams.length > 1 && area.notice ? h('p', { class: 'info' }, area.notice) : null,
    area.teams.length > 1 ? h('p', { class: 'dlg-count' }, `${plural(area.teams.length)} · elige uno para saber más`) : null,
    list,
  ].filter(Boolean));
  lockPage();
  $('#dlg').showModal();
  $('#dlg').scrollTop = 0; // siempre se abre desde el principio, no donde se quedó la vez anterior
}

/**
 * showModal() reinicia el scroll de la página en algunos navegadores (sobre todo en el móvil): al cerrar, la persona perdía el sitio.
 * Se congela el fondo mientras la ventana está abierta y se restaura su posición al cerrarla (por cualquier vía).
 */
let lockedAt = 0;
function lockPage() {
  lockedAt = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockedAt}px`, left: '0', right: '0' });
}
function unlockPage() {
  if (document.body.style.position !== 'fixed') return;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' });
  window.scrollTo({ top: lockedAt, behavior: 'instant' });
}

/**
 * Lleva al formulario con el equipo elegido. No usa location.hash: si ya estás en #apuntate
 * el navegador no se mueve, y al cerrar la ventana modal la página puede quedarse arriba del todo.
 */
function goToForm(teamId) {
  if ($('#form').hidden) $('#again').click(); // si ya enviaste uno, vuelve a mostrar el formulario
  // Si ya habías elegido ciudad en el escaparate y el formulario aún no tiene una, se rellena sola
  if (!$('[name=city_id]').value && galleryCity) { $('[name=city_id]').value = galleryCity; renderTeamOptions(); }
  selectTeam(teamId);
  const go = () => $('#form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  requestAnimationFrame(() => setTimeout(go, 60)); // espera a que se cierre la ventana y se recoloque la página
}

function selectTeam(id) { $('[name=team_id]').value = String(id); updateNotice(); }

/** Repuebla el desplegable «Equipo» con los disponibles en la ciudad elegida en el formulario; limpia la elección si ya no está disponible. */
function renderTeamOptions() {
  const cityId = $('[name=city_id]').value ? Number($('[name=city_id]').value) : null;
  const prev = $('[name=team_id]').value;
  const available = areasFor(cityId);
  $('[name=team_id]').replaceChildren(h('option', { value: '' }, 'Elige un equipo…'),
    ...available.map((a) => h('optgroup', { label: a.name }, a.teams.map((t) => h('option', { value: t.id }, t.name)))));
  $('[name=team_id]').value = available.some((a) => a.teams.some((t) => String(t.id) === prev)) ? prev : '';
  updateNotice();
}

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
  $('#gallery-city').replaceChildren(h('option', { value: '' }, 'Todas las ciudades'), ...data.cities.map((c) => h('option', { value: c.id }, c.name)));
  $('[name=city_id]').replaceChildren(h('option', { value: '' }, 'Elige tu ciudad…'), ...data.cities.map((c) => h('option', { value: c.id }, c.name)));
  renderAreas();
  renderTeamOptions();
}

$('#search').addEventListener('input', renderAreas);
$('#gallery-city').addEventListener('change', (e) => { galleryCity = e.target.value; renderAreas(); });
$('[name=city_id]').addEventListener('change', renderTeamOptions);
$('[name=team_id]').addEventListener('change', updateNotice);
$('[name=tenure]').addEventListener('change', updateNotice);
$('#dlg-close').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('close', unlockPage);
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
