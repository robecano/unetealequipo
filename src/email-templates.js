const { db } = require('./db');
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

// ---------- Marcadores disponibles ----------
// block = se inserta como bloque HTML (lista de personas, avisos…) y debe ir solo en su párrafo.
const VARS = {
  nombre: { desc: 'Nombre de pila de la persona' },
  nombre_completo: { desc: 'Nombre y apellidos' },
  equipo: { desc: 'Equipo elegido (Área › Subequipo)' },
  ciudad: { desc: 'Ciudad' },
  url_panel: { desc: 'Enlace al panel' },
  enlace_bases1: { desc: 'Enlace para registrarse en Bases 1' },
  enlace_bases2: { desc: 'Enlace para registrarse en Bases 2' },
  enlace_gc: { desc: 'Enlace de Grupos de Conexión' },
  faltan: { desc: 'Lista de lo que le falta (Bases 1, Bases 2, GC) con sus enlaces', block: true },
  aviso_area: { desc: 'Aviso del área (p. ej. organización y gestión)', block: true },
  aviso_equipo: { desc: 'Aviso del subequipo (p. ej. entrevista previa)', block: true },
  persona: { desc: 'Datos de la persona: nombre, teléfono, email, ciudad y perfil', block: true },
  personas: { desc: 'Lista de personas con sus datos', block: true },
  sin_verificar: { desc: 'Aviso ⚠ si dice tener algo que no consta en Planning Center', block: true },
  seccion_llamar: { desc: 'Sección «Llamar esta semana» (solo si hay gente)', block: true },
  seccion_seguimiento: { desc: 'Sección «Llamada de seguimiento» (solo si hay gente)', block: true },
  seccion_pendientes: { desc: 'Sección «Por hacer Bases 2» (solo si hay gente)', block: true },
};
// Condicionales: {{#bases}}texto{{/bases}} solo se muestra si se cumple.
const FLAGS = {
  bases: 'Se le ha asignado un voluntario de Bases',
  gc: 'Se le ha asignado un voluntario de GC',
  sin_gc: 'Todavía no está en un GC',
  sin_bases1: 'Le falta Bases 1',
  sin_bases2: 'Le falta Bases 2',
};

const FOOT = `[[Abrir mi panel|{{url_panel}}]]`;
const HELLO = `Hola {{nombre}}, gracias por querer servir en **{{equipo}}**. Nos alegra mucho.`;
const NOTICES = `{{aviso_area}}\n\n{{aviso_equipo}}`;

// ---------- Textos originales ----------
const TEMPLATES = {
  applicant_tenure: {
    group: 'persona', title: 'Aún no cumple el tiempo mínimo en la iglesia', to: 'La persona que se apunta',
    when: 'En cuanto se apunta a un equipo que pide más tiempo del que lleva (p. ej. Kids, Cuidado Pastoral). No se avisa al líder.',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'aviso_equipo'], flags: [], required: [],
    subject: 'Tu solicitud para servir en {{equipo}}', heading: '¡Gracias por apuntarte!',
    body: `${HELLO}\n\nPara servir en este equipo necesitamos que lleves algo más de tiempo en la iglesia. Por ahora no avisaremos al líder, pero te invitamos a seguir creciendo y conectando; puedes elegir otro equipo o volver a apuntarte más adelante.\n\n{{aviso_equipo}}`,
  },
  applicant_no_pco: {
    group: 'persona', title: 'No aparece en Planning Center', to: 'La persona que se apunta',
    when: 'En cuanto se apunta y no hay ninguna ficha con su email o teléfono en Planning Center. Se le pide hacer Bases 1.',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'enlace_bases1', 'aviso_area', 'aviso_equipo'], flags: [], required: ['enlace_bases1'],
    subject: 'Tu solicitud para servir en {{equipo}}', heading: '¡Gracias por apuntarte!',
    body: `${HELLO}\n\nNo hemos encontrado tu ficha en nuestro sistema. El primer paso es hacer **Bases 1**; en cuanto lo tengas, vuelve a apuntarte y seguiremos.\n\n[[Registrarme en Bases 1|{{enlace_bases1}}]]\n\n${NOTICES}`,
  },
  applicant_missing: {
    group: 'persona', title: 'Le falta Bases 1 o Bases 2', to: 'La persona que se apunta',
    when: 'En cuanto se apunta y le falta Bases 1 o Bases 2 (según Planning Center y lo que dijo en el formulario).',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'faltan', 'enlace_bases1', 'enlace_bases2', 'enlace_gc', 'aviso_area', 'aviso_equipo'], flags: ['bases', 'gc'], required: ['faltan'],
    subject: 'Tu solicitud para servir en {{equipo}}', heading: '¡Gracias por apuntarte!',
    body: `${HELLO}\n\nPara poder servir necesitas completar estos pasos:\n\n{{faltan}}\n\n{{#bases}}Un voluntario de Bases de tu ciudad se pondrá en contacto contigo para informarte y ayudarte a registrarte.{{/bases}}\n\n{{#gc}}Un voluntario de Grupos de Conexión de tu ciudad también te llamará para ayudarte a encontrar tu GC.{{/gc}}\n\nCuando termines, el líder del equipo te llamará.\n\n${NOTICES}`,
  },
  applicant_ready: {
    group: 'persona', title: 'Lo tiene todo hecho (Bases 1 y 2)', to: 'La persona que se apunta',
    when: 'En cuanto se apunta y ya tiene Bases 1 y Bases 2. El líder recibe su aviso a la vez.',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'enlace_gc', 'aviso_area', 'aviso_equipo'], flags: ['gc'], required: [],
    subject: 'Tu solicitud para servir en {{equipo}}', heading: '¡Gracias por apuntarte!',
    body: `${HELLO}\n\nTienes todos los pasos hechos. El líder del equipo te llamará esta semana y te invitará a visitar el equipo el próximo domingo.\n\n{{#gc}}Todavía no estás en un Grupo de Conexión: un voluntario de GC te llamará para ayudarte a encontrar el tuyo ({{enlace_gc}}).{{/gc}}\n\n${NOTICES}`,
  },
  leader_ready: {
    group: 'lider', title: 'Persona lista para llamar', to: 'Los líderes de ese equipo y ciudad',
    when: 'En cuanto alguien con Bases 1 y 2 se apunta a su equipo. También cuando una persona pendiente completa Bases 2 (se comprueba con el resumen semanal).',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'persona', 'sin_verificar', 'url_panel'], flags: ['sin_gc'], required: ['persona'],
    subject: 'Para llamar esta semana: {{nombre_completo}} ({{equipo}})', heading: 'Nueva persona para tu equipo: {{equipo}}',
    body: `Esta persona ha hecho Bases 2 y quiere servir en **{{equipo}}**:\n\n{{persona}}\n\n{{sin_verificar}}\n\n{{#sin_gc}}Todavía no está en un Grupo de Conexión; un voluntario de GC le está ayudando.{{/sin_gc}}\n\n**Qué debes hacer:** llámala **esta semana** e invítala a visitar el equipo **este domingo**. La semana siguiente haz una llamada de seguimiento para consolidar que ya es parte del equipo.\n\n${FOOT}`,
  },
  leader_digest: {
    group: 'lider', title: 'Resumen semanal', to: 'Cada líder, un email por equipo',
    when: 'Una vez por semana (día y hora en «Cuándo se envían»). Solo si hay alguien en alguna sección.',
    vars: ['equipo', 'seccion_llamar', 'seccion_seguimiento', 'seccion_pendientes', 'url_panel'], flags: [], required: ['seccion_llamar', 'seccion_seguimiento', 'seccion_pendientes'],
    subject: 'Resumen semanal · {{equipo}}', heading: 'Tu equipo esta semana',
    body: `Resumen semanal de **{{equipo}}**.\n\n{{seccion_llamar}}\n\n{{seccion_seguimiento}}\n\n{{seccion_pendientes}}\n\n${FOOT}`,
  },
  bases_assigned: {
    group: 'bases', title: 'Persona asignada a un voluntario de Bases', to: 'El voluntario de Bases asignado (reparto entre los de su ciudad)',
    when: 'En cuanto alguien se apunta sin Bases 1 o sin Bases 2.',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'personas', 'enlace_bases1', 'enlace_bases2', 'url_panel'], flags: ['sin_bases1', 'sin_bases2'], required: ['personas'],
    subject: 'Nueva persona para Bases: {{nombre_completo}}', heading: 'Seguimiento de Bases',
    body: `Se te ha asignado a esta persona:\n\n{{personas}}\n\n{{#sin_bases1}}Todavía no ha hecho **Bases 1**: ayúdale a registrarse en {{enlace_bases1}}.{{/sin_bases1}}\n\n{{#sin_bases2}}Llámala para informarle y ayúdale a registrarse en **Bases 2**: {{enlace_bases2}}{{/sin_bases2}}\n\n${FOOT}`,
  },
  bases_digest: {
    group: 'bases', title: 'Resumen semanal de Bases', to: 'Cada voluntario de Bases',
    when: 'Una vez por semana. Solo si tiene personas pendientes.',
    vars: ['personas', 'enlace_bases1', 'enlace_bases2', 'url_panel'], flags: [], required: ['personas'],
    subject: 'Pendientes de Bases esta semana', heading: 'Seguimiento de Bases',
    body: `Estas personas siguen pendientes de completar Bases:\n\n{{personas}}\n\nLlámalas para informarles y ayúdales a registrarse: Bases 1 ({{enlace_bases1}}) y Bases 2 ({{enlace_bases2}}).\n\n${FOOT}`,
  },
  gc_assigned: {
    group: 'gc', title: 'Persona asignada a un voluntario de GC', to: 'El voluntario de GC asignado (reparto entre los de su ciudad)',
    when: 'En cuanto alguien con Bases 1 se apunta sin estar en un Grupo de Conexión.',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'personas', 'enlace_gc', 'url_panel'], flags: [], required: ['personas'],
    subject: 'Nueva persona para un GC: {{nombre_completo}}', heading: 'Seguimiento de Grupos de Conexión',
    body: `Se te ha asignado a esta persona, que quiere servir en **{{equipo}}** y todavía no está en un Grupo de Conexión:\n\n{{personas}}\n\nLlámala e invítala a unirse a un GC de su zona: {{enlace_gc}}\n\n${FOOT}`,
  },
  gc_digest: {
    group: 'gc', title: 'Resumen semanal de GC', to: 'Cada voluntario de GC',
    when: 'Una vez por semana. Solo si tiene personas pendientes.',
    vars: ['personas', 'enlace_gc', 'url_panel'], flags: [], required: ['personas'],
    subject: 'Pendientes de Grupo de Conexión esta semana', heading: 'Seguimiento de Grupos de Conexión',
    body: `Estas personas siguen sin estar en un Grupo de Conexión:\n\n{{personas}}\n\nLlámalas e invítalas a unirse a un GC: {{enlace_gc}}\n\n${FOOT}`,
  },
};
const GROUPS = { persona: 'A la persona que se apunta', lider: 'Al líder del equipo', bases: 'A los voluntarios de Bases', gc: 'A los voluntarios de GC' };

// ---------- Lectura y validación ----------
function getTemplate(key) {
  const base = TEMPLATES[key];
  if (!base) throw new Error(`Plantilla desconocida: ${key}`);
  const row = db.prepare('SELECT * FROM email_templates WHERE key = ?').get(key);
  return row ? { ...base, subject: row.subject, heading: row.heading, body: row.body, enabled: !!row.enabled, customized: true, updated_at: row.updated_at, updated_by: row.updated_by } : { ...base, enabled: true, customized: false };
}

const TAG = /\{\{\s*([#/]?)(\w+)\s*\}\}/g;

/** Devuelve la lista de problemas de un texto (vacía si es válido). */
function validate(key, { subject, heading, body }) {
  const t = TEMPLATES[key];
  const errors = [];
  if (!String(subject || '').trim()) errors.push('El asunto no puede estar vacío.');
  if (String(subject || '').length > 200) errors.push('El asunto es demasiado largo (máx. 200).');
  if (!String(heading || '').trim()) errors.push('El título no puede estar vacío.');
  if (!String(body || '').trim()) errors.push('El cuerpo no puede estar vacío.');
  if (String(body || '').length > 8000) errors.push('El cuerpo es demasiado largo (máx. 8000).');
  const all = `${subject}\n${heading}\n${body}`;
  const opened = [];
  for (const m of all.matchAll(TAG)) {
    const [, kind, name] = m;
    if (kind) {
      if (!t.flags.includes(name)) errors.push(`El condicional {{${kind}${name}}} no existe en este email.`);
    } else if (!t.vars.includes(name)) errors.push(`El marcador {{${name}}} no existe en este email.`);
    if (kind === '#') opened.push(name);
  }
  for (const name of opened) {
    const closes = [...all.matchAll(new RegExp(`\\{\\{\\s*/${name}\\s*\\}\\}`, 'g'))].length;
    if (closes !== [...all.matchAll(new RegExp(`\\{\\{\\s*#${name}\\s*\\}\\}`, 'g'))].length) errors.push(`Falta cerrar el condicional {{#${name}}} con {{/${name}}}.`);
  }
  for (const name of t.required) {
    if (!new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(body || '')) errors.push(`Falta {{${name}}} en el cuerpo: sin él el email no llevaría esa información.`);
  }
  // Los marcadores de bloque van solos en su párrafo
  const cleaned = String(body || '').replace(/\{\{\s*[#/]\w+\s*\}\}/g, '');
  for (const para of cleaned.split(/\n{2,}/)) {
    for (const m of para.matchAll(TAG)) {
      if (VARS[m[2]]?.block && para.trim() !== `{{${m[2]}}}`) errors.push(`{{${m[2]}}} debe ir solo, en su propio párrafo (con una línea en blanco antes y después).`);
    }
  }
  for (const m of String(body || '').matchAll(/\[\[([^\]|]*)\|([^\]]*)\]\]/g)) {
    const raw = m[2].trim();
    // Un botón puede apuntar a un enlace fijo o a un marcador de enlace ({{url_panel}}, {{enlace_bases1}}…)
    const ok = /^\{\{\s*(enlace_\w+|url_panel)\s*\}\}$/.test(raw) || /^(https?:\/\/|mailto:|tel:)\S+$/.test(raw.replace(TAG, 'x'));
    if (!ok) errors.push(`El botón «${m[1]}» tiene un enlace no válido (debe empezar por https://).`);
  }
  return [...new Set(errors)];
}

// ---------- Generación del email ----------
const inline = (text, vars) => {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  // Los marcadores de texto se sustituyen antes de escapar; el resultado siempre se escapa
  let t = String(text).replace(TAG, (_, kind, name) => (!kind && !VARS[name]?.block ? (vars[name] ?? '') : ''));
  t = esc(t);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)/g, (_, label, url) => keep(`<a href="${url}" style="color:#4f46e5">${label}</a>`));
  t = t.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u) => keep(`<a href="${u}" style="color:#4f46e5">${u}</a>`));
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s.,;:!?)]|$)/g, '$1<i>$2</i>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[i]);
};

function bodyToHtml(body, { vars = {}, blocks = {}, flags = {} }) {
  const source = String(body).replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, f, inner) => (flags[f] ? inner : ''));
  const out = [];
  for (const raw of source.split(/\n{2,}/)) {
    const para = raw.trim();
    if (!para) continue;
    let m;
    if ((m = para.match(/^\{\{\s*(\w+)\s*\}\}$/)) && VARS[m[1]]?.block) {
      if (blocks[m[1]]) out.push(blocks[m[1]]);
    } else if ((m = para.match(/^\[\[([^|\]]+)\|([^\]]+)\]\]$/))) {
      const url = m[2].replace(TAG, (_, kind, name) => vars[name] ?? '');
      if (/^(https?:\/\/|mailto:|tel:)\S+$/.test(url)) out.push(btn(url, m[1].replace(TAG, (_, k, n) => vars[n] ?? '')));
    } else if (para.split('\n').every((l) => /^- /.test(l))) {
      out.push(`<ul style="line-height:1.7;margin:0 0 14px">${para.split('\n').map((l) => `<li>${inline(l.slice(2), vars)}</li>`).join('')}</ul>`);
    } else {
      const html = para.split('\n').map((l) => inline(l, vars)).join('<br>');
      if (html.replace(/<[^>]+>/g, '').trim()) out.push(p(html));
    }
  }
  return out.join('');
}

const plain = (s, vars) => String(s).replace(TAG, (_, kind, name) => (!kind && !VARS[name]?.block ? (vars[name] ?? '') : '')).replace(/\s+/g, ' ').trim();

function htmlToText(html) {
  return html
    .replace(/<\/(p|li|h1|h2|div|ul)>|<br\s*\/?>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, label) => (label.replace(/<[^>]+>/g, '') === href ? href : `${label.replace(/<[^>]+>/g, '')} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Genera el email de una plantilla. `override` permite previsualizar un texto sin guardarlo. */
function render(key, ctx, override) {
  const t = { ...getTemplate(key), ...(override || {}) };
  const vars = { url_panel: `${config.appUrl}/panel`, enlace_bases1: config.urls.bases1, enlace_bases2: config.urls.bases2, enlace_gc: config.urls.gc, ...(ctx.vars || {}) };
  const html = layout(plain(t.heading, vars), bodyToHtml(t.body, { ...ctx, vars }));
  return { subject: plain(t.subject, vars), html, text: htmlToText(html), enabled: t.enabled !== false };
}

/** Datos de ejemplo para la vista previa y el email de prueba del panel. */
function sampleContext(key) {
  const person = { name: 'Ana Ruiz', email: 'ana@ejemplo.es', phone: '+34 600 111 222', city: 'Madrid', pco_url: 'https://people.planningcenteronline.com/people/1' };
  const line = (a) => `<b>${esc(a.name)}</b> · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a> · ${esc(a.city)} · <a href="${esc(a.pco_url)}">Perfil</a>`;
  const list = `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px"><li>${line(person)}</li><li>${line({ ...person, name: 'Luis Pérez', phone: '+34 611 222 333', email: 'luis@ejemplo.es' })}</li></ul>`;
  const h = (t) => `<h2 style="font-size:16px">${t}</h2>`;
  return {
    vars: { nombre: 'Ana', nombre_completo: 'Ana Ruiz', equipo: 'Locales › Cafetería', ciudad: 'Madrid' },
    flags: { bases: true, gc: true, sin_gc: true, sin_bases1: true, sin_bases2: true },
    blocks: {
      faltan: `<ul style="line-height:1.7;margin:0 0 14px"><li><b>Bases 2</b> — <a href="${esc(config.urls.bases2)}">${esc(config.urls.bases2)}</a></li><li><b>un Grupo de Conexión (GC)</b> — <a href="${esc(config.urls.gc)}">${esc(config.urls.gc)}</a></li></ul>`,
      aviso_area: p('<i>El servicio en esta área sería ayudando en el equipo de organización y gestión de las actividades y eventos.</i>'),
      aviso_equipo: p('<i>Este equipo requiere una entrevista larga antes de empezar.</i>'),
      persona: `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px"><li>${line(person)}</li></ul>`,
      personas: list,
      sin_verificar: p('⚠ <b>Dato sin verificar:</b> dice haber hecho Bases 2, pero no consta en Planning Center. Confírmalo al llamarla.'),
      seccion_llamar: h('📞 Llamar esta semana e invitar el domingo') + list,
      seccion_seguimiento: h('🔁 Llamada de seguimiento (consolidar en el equipo)') + list,
      seccion_pendientes: h('⏳ Interesados en servir en tu equipo, pero por hacer Bases 2') + list + p('Un voluntario de Bases les está haciendo seguimiento. Cuando terminen, te avisaremos.'),
    },
  };
}

module.exports = { TEMPLATES, GROUPS, VARS, FLAGS, getTemplate, validate, render, sampleContext, esc, layout, btn, p };
