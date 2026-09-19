const config = require('./config');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Plantilla común. Los emails necesitan estilos en línea (no aplican las reglas CSP de la web). */
function layout(title, bodyHtml) {
  return `<div style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#000;color:#fff;padding:22px 26px;font-size:13px;letter-spacing:.18em;text-transform:uppercase">Hillsong España · Únete al equipo</div>
<div style="padding:26px"><h1 style="font-size:22px;margin:0 0 14px">${esc(title)}</h1>${bodyHtml}</div>
</div></div>`;
}
const p = (t) => `<p style="line-height:1.55;margin:0 0 14px">${t}</p>`;
const btn = (href, label) =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="background:#000;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block;font-weight:600">${esc(label)}</a></p>`;

const COURSES = {
  bases1: { label: 'Bases 1', url: () => config.urls.bases1 },
  bases2: { label: 'Bases 2', url: () => config.urls.bases2 },
  gc: { label: 'un Grupo de Conexión (GC)', url: () => config.urls.gc },
};

/** Email a la persona: confirmación + lo que le falta, o aviso si aún no cumple los requisitos del equipo. */
function applicantEmail({ app, team, missing, notFoundInPco, tenureShort }) {
  const parts = [p(`Hola ${esc(app.name.split(' ')[0])}, gracias por querer servir en <b>${esc(team.name)}</b>. Nos alegra mucho.`)];
  if (tenureShort) {
    parts.push(p(`Para servir en este equipo necesitamos que lleves algo más de tiempo en la iglesia. Por ahora no avisaremos al líder, pero te invitamos a seguir creciendo y conectando; puedes elegir otro equipo o volver a apuntarte más adelante.`));
    if (team.notice) parts.push(p(esc(team.notice)));
  } else if (notFoundInPco) {
    parts.push(p('No hemos encontrado tu ficha en nuestro sistema. El primer paso es hacer <b>Bases 1</b>; en cuanto lo tengas, vuelve a apuntarte y seguiremos.'));
    parts.push(btn(config.urls.bases1, 'Registrarme en Bases 1'));
  } else if (missing.length) {
    parts.push(p('Para poder servir necesitas completar estos pasos:'));
    parts.push(`<ul style="line-height:1.7;margin:0 0 14px">${missing.map((m) => `<li><b>${COURSES[m].label}</b> — <a href="${esc(COURSES[m].url())}">${esc(COURSES[m].url())}</a></li>`).join('')}</ul>`);
    const claimed = missing.filter((m) => app['self_' + m]);
    if (claimed.length) parts.push(p(`Nos indicaste que ya tienes ${claimed.map((m) => COURSES[m].label).join(', ')}, pero no lo vemos registrado en nuestro sistema. Si es un error, díselo a quien te contacte y lo revisará.`));
    if (missing.includes('bases2')) parts.push(p('Un voluntario de Bases de tu ciudad se pondrá en contacto contigo para informarte y ayudarte a registrarte.'));
    parts.push(p('Cuando termines, el líder del equipo te llamará.'));
  } else {
    parts.push(p('Tienes todos los pasos hechos. El líder del equipo te llamará esta semana y te invitará a visitar el equipo el próximo domingo.'));
  }
  if (team.notice && !tenureShort) parts.push(p(`<i>${esc(team.notice)}</i>`));
  return { subject: `Tu solicitud para servir en ${team.name}`, html: layout('¡Gracias por apuntarte!', parts.join('')), text: `Gracias por apuntarte a ${team.name}.` };
}

const person = (a) =>
  `<b>${esc(a.name)}</b> · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a>${a.city ? ` · ${esc(a.city)}` : ''}${a.pco_url ? ` · <a href="${esc(a.pco_url)}">Perfil</a>` : ''}`;
const list = (items) => `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px">${items.map((a) => `<li>${person(a)}</li>`).join('')}</ul>`;

/** Aviso inmediato al líder por una persona lista para llamar. */
function leaderReadyEmail({ app, team }) {
  const html = layout(`Nueva persona para tu equipo: ${team.name}`,
    p(`Esta persona ha hecho Bases 2 y quiere servir en <b>${esc(team.name)}</b>:`) + list([app]) +
    p('<b>Qué debes hacer:</b> llámala <b>esta semana</b> e invítala a visitar el equipo <b>este domingo</b>. La semana siguiente haz una llamada de seguimiento para consolidar que ya es parte del equipo.') +
    btn(`${config.appUrl}/panel`, 'Abrir mi panel'));
  return { subject: `Para llamar esta semana: ${app.name} (${team.name})`, html, text: `${app.name} ${app.phone} quiere servir en ${team.name}` };
}

/** Resumen semanal al líder. Cada sección solo aparece si tiene personas. */
function leaderDigestEmail({ team, ready, followups, pending }) {
  let body = p(`Resumen semanal de <b>${esc(team.name)}</b>.`);
  if (ready.length) body += `<h2 style="font-size:16px">📞 Llamar esta semana e invitar el domingo</h2>` + list(ready);
  if (followups.length) body += `<h2 style="font-size:16px">🔁 Llamada de seguimiento (consolidar en el equipo)</h2>` + list(followups);
  if (pending.length) body += `<h2 style="font-size:16px">⏳ Interesados en servir en tu equipo, pero por hacer Bases 2</h2>` + list(pending) + p('Un voluntario de Bases les está haciendo seguimiento. Cuando terminen, te avisaremos.');
  body += btn(`${config.appUrl}/panel`, 'Abrir mi panel');
  return { subject: `Resumen semanal · ${team.name}`, html: layout('Tu equipo esta semana', body), text: `Resumen semanal de ${team.name}` };
}

/** Aviso a un voluntario de Bases: personas asignadas para informar y llamar. */
function basesEmail({ items, digest }) {
  const body = p(digest ? 'Estas personas siguen pendientes de hacer Bases 2:' : 'Se te ha asignado a esta persona:') + list(items.map((i) => i.app)) +
    p('Llámala para informarle y ayúdale a registrarse en Bases 2: <a href="' + esc(config.urls.bases2) + '">' + esc(config.urls.bases2) + '</a>') +
    btn(`${config.appUrl}/panel`, 'Abrir mi panel');
  return { subject: digest ? 'Pendientes de Bases 2 esta semana' : `Nueva persona para Bases 2: ${items[0].app.name}`, html: layout('Seguimiento de Bases 2', body), text: 'Personas pendientes de Bases 2' };
}

function adminAlertEmail(subject, detail) {
  return { subject, html: layout(subject, p(esc(detail)) + btn(`${config.appUrl}/panel`, 'Abrir el panel')), text: detail };
}

module.exports = { applicantEmail, leaderReadyEmail, leaderDigestEmail, basesEmail, adminAlertEmail };
