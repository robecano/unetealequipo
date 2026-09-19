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

let data = { teams: [], cities: [] };

function card(team, i) {
  const visual = team.image_url
    ? h('img', { src: team.image_url, alt: '', loading: 'lazy' })
    : h('span', { class: 'icon', 'aria-hidden': 'true' }, team.icon || team.name.slice(0, 1));
  return h('button', { class: `team g${i % 6}`, type: 'button', onclick: () => openTeam(team) },
    h('div', { class: 'team-visual' }, visual),
    h('div', { class: 'team-body' },
      h('h3', {}, team.name),
      h('p', {}, team.description),
      team.notice ? h('span', { class: 'tag' }, 'Requisitos previos') : null,
      h('span', { class: 'more' }, 'Saber más →')));
}

function renderTeams() {
  const q = $('#search').value.trim().toLowerCase();
  const list = data.teams.filter((t) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q));
  $('#teams').replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'muted' }, data.teams.length ? 'Ningún equipo coincide con tu búsqueda.' : 'Pronto verás aquí los equipos.')]));
}

function openTeam(team) {
  $('#dlg-body').replaceChildren(
    team.image_url ? h('img', { class: 'dlg-img', src: team.image_url, alt: '' }) : h('div', { class: 'dlg-icon' }, team.icon || ''),
    h('h3', {}, team.name),
    h('p', {}, team.description),
    team.notice ? h('p', { class: 'alert' }, team.notice) : null,
    h('button', { class: 'btn', type: 'button', onclick: () => { selectTeam(team.id); $('#dlg').close(); location.hash = '#apuntate'; } }, 'Quiero unirme a este equipo'));
  $('#dlg').showModal();
}

function selectTeam(id) { $('[name=team_id]').value = String(id); updateNotice(); }

function updateNotice() {
  const team = data.teams.find((t) => String(t.id) === $('[name=team_id]').value);
  const tenure = $('[name=tenure]').value;
  const box = $('#team-notice');
  const lines = [];
  if (team?.notice) lines.push(team.notice);
  if (team && tenure !== '' && Number(tenure) < team.min_months) lines.push('Por ahora no llevas el tiempo mínimo en la iglesia para este equipo. Puedes apuntarte igualmente y te contaremos las opciones.');
  box.textContent = lines.join(' ');
  box.hidden = !lines.length;
}

async function init() {
  try {
    data = await (await fetch('/api/public')).json();
  } catch {
    $('#teams').replaceChildren(h('p', { class: 'error' }, 'No se han podido cargar los equipos. Recarga la página.'));
    return;
  }
  renderTeams();
  $('[name=city_id]').replaceChildren(h('option', { value: '' }, 'Elige tu ciudad…'), ...data.cities.map((c) => h('option', { value: c.id }, c.name)));
  $('[name=team_id]').replaceChildren(h('option', { value: '' }, 'Elige un equipo…'), ...data.teams.map((t) => h('option', { value: t.id }, t.name)));
}

$('#search').addEventListener('input', renderTeams);
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
