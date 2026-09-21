const config = require('./config');
const { render, esc, layout, btn, p } = require('./email-templates');

const COURSES = {
  bases1: { label: 'Bases 1', url: () => config.urls.bases1 },
  bases2: { label: 'Bases 2', url: () => config.urls.bases2 },
  gc: { label: 'un Grupo de Conexión (GC)', url: () => config.urls.gc },
};

const person = (a) =>
  `<b>${esc(a.name)}</b> · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a>${a.city ? ` · ${esc(a.city)}` : ''}${a.pco_url ? ` · <a href="${esc(a.pco_url)}">Perfil</a>` : ''}${a.falta ? ` · <i>Le falta: ${esc(a.falta)}</i>` : ''}`;
const list = (items) => `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px">${items.map((a) => `<li>${person(a)}</li>`).join('')}</ul>`;
const italic = (t) => (t ? p(`<i>${esc(t)}</i>`) : '');
const first = (name) => String(name || '').split(' ')[0];

/**
 * Email a la persona. Según su caso se usa una de estas plantillas (editables en el panel):
 * aún sin tiempo mínimo · sin ficha en PCO · le falta Bases 1/2 · lo tiene todo.
 * `assign` indica qué voluntarios se le han asignado (Bases / GC) para el texto condicional.
 */
function applicantEmail({ app, team, missing = [], notFoundInPco, tenureShort, assign }) {
  const blocking = missing.filter((m) => m !== 'gc');
  const key = tenureShort ? 'applicant_tenure' : notFoundInPco ? 'applicant_no_pco' : blocking.length ? 'applicant_missing' : 'applicant_ready';
  return render(key, {
    vars: { nombre: first(app.name), nombre_completo: app.name, equipo: team.name, ciudad: app.city || '' },
    flags: { bases: assign?.bases ?? blocking.length > 0, gc: assign?.gc ?? false },
    blocks: {
      faltan: missing.length ? `<ul style="line-height:1.7;margin:0 0 14px">${missing.map((m) => `<li><b>${COURSES[m].label}</b> — <a href="${esc(COURSES[m].url())}">${esc(COURSES[m].url())}</a></li>`).join('')}</ul>` : '',
      aviso_area: tenureShort ? '' : italic(app.area_notice),
      aviso_equipo: italic(team.notice),
    },
  });
}

const ctxFor = (a, team) => ({ nombre: first(a.name), nombre_completo: a.name, equipo: team || a.team || '', ciudad: a.city || '' });

/** Aviso inmediato al líder por una persona lista para llamar. */
function leaderReadyEmail({ app, team, unverified = [], sinGc = false }) {
  return render('leader_ready', {
    vars: ctxFor(app, team.name),
    flags: { sin_gc: sinGc },
    blocks: {
      persona: list([app]),
      sin_verificar: unverified.length ? p(`⚠ <b>Dato sin verificar:</b> dice haber hecho ${esc(unverified.join(', '))}, pero no consta en Planning Center. Confírmalo al llamarla.`) : '',
    },
  });
}

/** Resumen semanal al líder. Cada sección solo aparece si tiene personas. */
function leaderDigestEmail({ team, ready, followups, pending }) {
  const h = (t) => `<h2 style="font-size:16px">${t}</h2>`;
  return render('leader_digest', {
    vars: { equipo: team.name },
    blocks: {
      seccion_llamar: ready.length ? h('📞 Llamar esta semana e invitar el domingo') + list(ready) : '',
      seccion_seguimiento: followups.length ? h('🔁 Llamada de seguimiento (consolidar en el equipo)') + list(followups) : '',
      seccion_pendientes: pending.length
        ? h('⏳ Interesados que aún no tienen Bases 1, Bases 2 o GC (seguimiento opcional)') + list(pending) +
          p('Es opcional: si quieres, puedes llamarles para darles la bienvenida y animarles a completar lo que les falta. Los voluntarios de Bases y de GC les ayudan cuando corresponde.')
        : '',
    },
  });
}

/** Aviso a un voluntario de Bases (asignación o resumen semanal). */
function basesEmail({ items, digest, missing = [] }) {
  const a = items[0].app;
  return render(digest ? 'bases_digest' : 'bases_assigned', {
    vars: ctxFor(a),
    flags: { sin_bases1: missing.includes('bases1'), sin_bases2: missing.includes('bases2') || !missing.includes('bases1') },
    blocks: { personas: list(items.map((i) => i.app)) },
  });
}

/** Aviso a un voluntario de Grupos de Conexión (asignación o resumen semanal). */
function gcEmail({ items, digest }) {
  return render(digest ? 'gc_digest' : 'gc_assigned', { vars: ctxFor(items[0].app), blocks: { personas: list(items.map((i) => i.app)) } });
}

function adminAlertEmail(subject, detail) {
  return { subject, html: layout(subject, p(esc(detail)) + btn(`${config.appUrl}/panel`, 'Abrir el panel')), text: detail, enabled: true };
}

module.exports = { applicantEmail, leaderReadyEmail, leaderDigestEmail, basesEmail, gcEmail, adminAlertEmail };
