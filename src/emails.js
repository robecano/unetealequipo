const config = require('./config');
const courses = require('./courses');
const { render, esc, layout, btn, p } = require('./email-templates');

const COURSES = {
  bases1: { label: 'Bases 1', url: () => config.urls.bases1 },
  bases2: { label: 'Bases 2', url: () => config.urls.bases2 },
  gc: { label: 'un Grupo de Conexión (GC)', url: () => config.urls.gc },
};

/** Una persona en una lista para el líder: sus datos, sus cursos y, si algo no cuadra, el aviso de «contrastado con PCO». */
const person = (a) => {
  const bits = [`<b>${esc(a.name)}</b>`, `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>`, `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>`];
  if (a.city) bits.push(esc(a.city));
  if (a.pco_url) bits.push(`<a href="${esc(a.pco_url)}">Perfil</a>`);
  let line = bits.join(' · ');
  if (a.cursos) line += `<br><span style="color:#71717a">${esc(a.cursos)} · Contrastado con PCO: ${esc(a.contrastado?.label ?? '')}</span>`;
  if (a.contrastado && !a.contrastado.ok) line += `<br><span style="color:#b45309">⚠ ${esc(a.contrastado.guidance)}</span>`;
  return line;
};
const list = (items) => `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px">${items.map((a) => `<li>${person(a)}</li>`).join('')}</ul>`;
const section = (title, items) => (items.length ? `<h2 style="font-size:16px">${title}</h2>${list(items)}` : '');
const italic = (t) => (t ? p(`<i>${esc(t)}</i>`) : '');

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
const first = (name) => String(name || '').split(' ')[0];

/**
 * Email a la persona que se apunta. Si aún no cumple el tiempo mínimo, aviso aparte (no se avisa al líder).
 * En cualquier otro caso recibe un único email: lo que consta (o que no se encontró su ficha), lo que le falta
 * si acaso, y que el líder del equipo la contactará esta semana.
 */
function applicantEmail({ app, team, missing = [], notFoundInPco, tenureShort }) {
  if (tenureShort) {
    return render('applicant_tenure', {
      vars: { nombre: first(app.name), nombre_completo: app.name, equipo: team.name, ciudad: app.city || '' },
      blocks: { aviso_equipo: italic(team.notice) },
    });
  }
  return render('applicant_received', {
    vars: { nombre: first(app.name), nombre_completo: app.name, equipo: team.name, ciudad: app.city || '', cursos: courses.courseLine(app) },
    flags: { encontrado: !notFoundInPco, no_encontrado: !!notFoundInPco },
    blocks: { faltan: faltanHtml(missing), aviso_area: italic(app.area_notice), aviso_equipo: italic(team.notice) },
  });
}

/** Aviso inmediato al líder por cada solicitud, tenga o no completados Bases 1, Bases 2 y GC. */
function leaderNoticeEmail({ app }) {
  return render('leader_notice', {
    vars: { nombre: first(app.name), nombre_completo: app.name, equipo: app.team, ciudad: app.city || '' },
    blocks: { persona: list([app]) },
  });
}

/** Lista de un líder: nuevas desde el último envío, a quien toca hacer seguimiento y el resto de su lista abierta. */
function leaderDigestEmail({ team, nuevas, seguimiento, resto }) {
  return render('leader_digest', {
    vars: { equipo: team.name },
    blocks: {
      seccion_nuevas: section('🆕 Nuevas desde el último resumen', nuevas),
      seccion_seguimiento: section('🔁 Toca hacer seguimiento', seguimiento),
      seccion_resto: section('📋 Resto de tu lista', resto),
    },
  });
}

function adminAlertEmail(subject, detail) {
  return { subject, html: layout(subject, p(esc(detail)) + btn(`${config.appUrl}/panel`, 'Abrir el panel')), text: detail, enabled: true };
}

module.exports = { applicantEmail, leaderNoticeEmail, leaderDigestEmail, adminAlertEmail };
