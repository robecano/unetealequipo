const config = require('./config');
const courses = require('./courses');
const { render, esc, p } = require('./email-templates');

const COURSES = {
  bases1: { label: 'Bases 1', url: () => config.urls.bases1 },
  bases2: { label: 'Bases 2', url: () => config.urls.bases2 },
  gc: { label: 'un Grupo de Conexión (GC)', url: () => config.urls.gc },
};

/** Una persona en una lista para el líder: sus datos, sus cursos y, si algo no cuadra, el aviso de «OK con PCO». */
const person = (a) => {
  const bits = [`<b>${esc(a.name)}</b>`, `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>`, `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>`];
  if (a.city) bits.push(esc(a.city));
  if (a.team) bits.push(esc(a.team));
  if (a.pco_url) bits.push(`<a href="${esc(a.pco_url)}">Perfil</a>`);
  let line = bits.join(' · ');
  if (a.cursos) line += `<br><span style="color:#71717a">${esc(a.cursos)} · OK con PCO: ${esc(a.contrastado?.label ?? '')}</span>`;
  if (a.contrastado && !a.contrastado.ok) line += `<br><span style="color:#b45309">⚠ ${esc(a.contrastado.guidance)}</span>`;
  if (a.contrastado?.reminder) line += `<br><span style="color:#b45309">${esc(a.contrastado.reminder)}</span>`;
  return line;
};
const list = (items) => `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px">${items.map((a) => `<li>${person(a)}</li>`).join('')}</ul>`;
const section = (title, items) => (items.length ? `<h2 style="font-size:16px">${title}</h2>${list(items)}` : '');
const italic = (t) => (t ? p(`<i>${esc(t)}</i>`) : '');

/**
 * Una persona en la lista propia del líder de Bases o de GC: sus datos y, curso a curso, lo que le falta según
 * Planning Center — si de verdad no lo tiene, o si lo autodeclaró y Planning Center no lo confirma (hay que
 * revisar y actualizar el dato, posiblemente le faltó marcar la asistencia).
 */
const roleLine = (a, gaps) => {
  const bits = [`<b>${esc(a.name)}</b>`, `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>`, `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>`];
  if (a.city) bits.push(esc(a.city));
  if (a.team) bits.push(esc(a.team));
  if (a.pco_url) bits.push(`<a href="${esc(a.pco_url)}">Perfil</a>`);
  let line = bits.join(' · ');
  for (const g of gaps) {
    line += g.mismatch
      ? `<br><span style="color:#b45309">⚠ ${esc(g.label)}: dice tenerlo, pero no consta en Planning Center. Actualizar información en PCO contrastándola${g.key === 'gc' ? '' : '. Es posible que le haya faltado marcar la asistencia.'}</span>`
      : `<br><span style="color:#71717a">${esc(g.label)}: no lo tiene hecho</span>`;
  }
  return line;
};
const roleList = (items, gapsKey) => `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px">${items.map((a) => `<li>${roleLine(a, a[gapsKey] || [])}</li>`).join('')}</ul>`;
const roleSection = (title, items, gapsKey) => (items.length ? `<h2 style="font-size:16px">${title}</h2>${roleList(items, gapsKey)}` : '');

/** Lista de lo que falta. Si le faltan Bases 1 y Bases 2 y comparten enlace, van en una sola línea. */
function faltanHtml(missing) {
  if (!missing.length) return '';
  const items = [];
  const both = missing.includes('bases1') && missing.includes('bases2') && COURSES.bases1.url() === COURSES.bases2.url();
  for (const m of missing) {
    if (both && m === 'bases2') continue;
    const label = both && m === 'bases1' ? 'Bases 1 y Bases 2' : COURSES[m].label;
    items.push(`<li><b>${esc(label)}</b> — <a href="${esc(COURSES[m].url())}">${esc(COURSES[m].url())}</a></li>`);
  }
  return `<ul style="line-height:1.7;margin:0 0 14px">${items.join('')}</ul>`;
}

/** Aviso si dice tener algo que Planning Center no confirma: que se pase por el punto de información el domingo. */
function contrasteHtml(mismatched) {
  if (!mismatched.length) return '';
  return p(esc(`Contrastando con Planning Center, todavía no consta que hayas hecho ${courses.joinEs(mismatched.map((k) => courses.LABEL[k]))}. Si ya lo hiciste, pásate por el punto de información este domingo para que actualicemos tus datos.`));
}
const first = (name) => String(name || '').split(' ')[0];

/**
 * Email a la persona que se apunta. Si aún no cumple el tiempo mínimo, aviso aparte (no se avisa al líder).
 * En cualquier otro caso recibe un único email: lo que consta (o que no se encontró su ficha), lo que le falta
 * de verdad si acaso, el aviso de contraste si dijo tener algo que Planning Center no confirma (solo si tiene
 * ficha: sin ficha ya se le dice que no se pudo comprobar nada), y que el líder del equipo la contactará esta semana.
 */
function applicantEmail({ app, team, missing = [], mismatched = [], notFoundInPco, tenureShort }, cityId) {
  if (tenureShort) {
    return render('applicant_tenure', {
      vars: { nombre: first(app.name), nombre_completo: app.name, equipo: team.name, ciudad: app.city || '' },
      blocks: { aviso_equipo: italic(team.notice) },
    }, undefined, cityId);
  }
  return render('applicant_received', {
    vars: { nombre: first(app.name), nombre_completo: app.name, equipo: team.name, ciudad: app.city || '', cursos: courses.courseLine(app) },
    flags: { encontrado: !notFoundInPco, no_encontrado: !!notFoundInPco },
    blocks: { faltan: faltanHtml(missing), contraste: notFoundInPco ? '' : contrasteHtml(mismatched), aviso_area: italic(app.area_notice), aviso_equipo: italic(team.notice) },
  }, undefined, cityId);
}

/** Lista de seguimiento de Equipos: nuevas desde el último envío, a quien toca hacer seguimiento y el resto de la ciudad. */
function leaderDigestEmail({ city, nuevas, seguimiento, resto }, cityId) {
  return render('leader_digest', {
    vars: { ciudad: city.name },
    blocks: {
      seccion_nuevas: section('🆕 Nuevas desde el último resumen', nuevas),
      seccion_seguimiento: section('🔁 Toca hacer seguimiento', seguimiento),
      seccion_resto: section('📋 Resto de tu lista', resto),
    },
  }, undefined, cityId);
}

/**
 * Lista del líder de Bases: quien tenga pendiente Bases 1 o Bases 2 según Planning Center en su ciudad (de
 * cualquier equipo), incluida la gente que lo autodeclaró pero Planning Center todavía no lo confirma.
 */
function basesDigestEmail({ city, nuevas, seguimiento, resto }, cityId) {
  return render('bases_digest', {
    vars: { ciudad: city.name },
    blocks: {
      seccion_nuevas: roleSection('🆕 Nuevas desde el último resumen', nuevas, 'basesGaps'),
      seccion_seguimiento: roleSection('🔁 Toca hacer seguimiento', seguimiento, 'basesGaps'),
      seccion_resto: roleSection('📋 Resto de tu lista', resto, 'basesGaps'),
    },
  }, undefined, cityId);
}

/**
 * Lista del líder de GC: quien ya tenga Bases 1 y le falte un GC según Planning Center en su ciudad (de
 * cualquier equipo), incluida la gente que dice estar en un GC pero Planning Center todavía no lo confirma.
 */
function gcDigestEmail({ city, nuevas, seguimiento, resto }, cityId) {
  return render('gc_digest', {
    vars: { ciudad: city.name },
    blocks: {
      seccion_nuevas: roleSection('🆕 Nuevas desde el último resumen', nuevas, 'gcGaps'),
      seccion_seguimiento: roleSection('🔁 Toca hacer seguimiento', seguimiento, 'gcGaps'),
      seccion_resto: roleSection('📋 Resto de tu lista', resto, 'gcGaps'),
    },
  }, undefined, cityId);
}

/** Aviso a administración cuando una ciudad se queda sin nadie de seguimiento de Equipos asignado. */
function adminNoLeaderEmail({ app }, cityId) {
  return render('admin_no_leader', {
    vars: { nombre_completo: app.name, telefono: app.phone, equipo: app.team, ciudad: app.city || '' },
  }, undefined, cityId);
}

/** Aviso a administración cuando una ciudad se queda sin líder de Bases o de GC. `tipo`: 'Bases' o 'GC'. */
function adminNoRoleLeaderEmail({ app, tipo }, cityId) {
  return render('admin_no_role_leader', {
    vars: { nombre_completo: app.name, telefono: app.phone, equipo: app.team, ciudad: app.city || '', tipo },
  }, undefined, cityId);
}

module.exports = { applicantEmail, leaderDigestEmail, basesDigestEmail, gcDigestEmail, adminNoLeaderEmail, adminNoRoleLeaderEmail };
