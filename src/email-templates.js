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
  telefono: { desc: 'Teléfono de la persona' },
  equipo: { desc: 'Equipo elegido (Área › Subequipo)' },
  ciudad: { desc: 'Ciudad' },
  cursos: { desc: 'Bases 1, Bases 2 y GC: «Bases 1: Sí · Bases 2: No · GC: Sí»' },
  url_panel: { desc: 'Enlace al panel' },
  enlace_bases: { desc: 'Enlace de Bases (hillsong.es/bases)' },
  enlace_gc: { desc: 'Enlace de Grupos de Conexión (hillsong.es/gc)' },
  faltan: { desc: 'Lista de lo que le falta (Bases 1, Bases 2, GC) con sus enlaces (vacío si no le falta nada)', block: true },
  contraste: { desc: 'Aviso si dice tener algo que Planning Center no confirma: que se pase por el punto de información el domingo (vacío si no hay diferencias)', block: true },
  aviso_area: { desc: 'Aviso del área (p. ej. organización y gestión)', block: true },
  aviso_equipo: { desc: 'Aviso del subequipo (p. ej. entrevista previa)', block: true },
  seccion_nuevas: { desc: 'Personas nuevas desde el último envío (solo si hay alguna)', block: true },
  seccion_seguimiento: { desc: 'A quien toca hacer una llamada de seguimiento (solo si hay alguien)', block: true },
  seccion_resto: { desc: 'El resto de la lista abierta (solo si hay alguien)', block: true },
};
// Condicionales: {{#bases}}texto{{/bases}} solo se muestra si se cumple.
const FLAGS = {
  encontrado: 'Se ha encontrado su ficha en Planning Center',
  no_encontrado: 'No se ha encontrado su ficha en Planning Center',
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
  applicant_received: {
    group: 'persona', title: 'Solicitud recibida', to: 'La persona que se apunta',
    when: 'En cuanto se apunta y llega al tiempo mínimo del equipo. Le dice lo que consta (o que no se encontró su ficha), lo que le falta si acaso, y que el líder la contactará esta semana.',
    vars: ['nombre', 'nombre_completo', 'equipo', 'ciudad', 'cursos', 'faltan', 'contraste', 'enlace_bases', 'enlace_gc', 'aviso_area', 'aviso_equipo'], flags: ['encontrado', 'no_encontrado'], required: [],
    subject: 'Tu solicitud para servir en {{equipo}}', heading: '¡Gracias por apuntarte!',
    body: `${HELLO}\n\n{{#no_encontrado}}No hemos encontrado tu ficha en nuestro sistema, así que no hemos podido comprobar tus pasos (Bases 1, Bases 2 y GC).{{/no_encontrado}}\n\n{{#encontrado}}Esto es lo que tenemos registrado: {{cursos}}.{{/encontrado}}\n\n{{faltan}}\n\n{{contraste}}\n\nEl líder de tu equipo revisará tu solicitud y te contactará esta semana.\n\n${NOTICES}`,
  },
  leader_digest: {
    group: 'lider', title: 'Tu lista', to: 'Cada líder, un email por equipo',
    when: 'Los días y horas configurados abajo (ahora mismo: %HORARIO%). Toda tu lista abierta de ese equipo, en tres partes: nuevas desde el último envío, a quien toca hacer seguimiento y el resto. Solo se envía si tienes alguna solicitud abierta.',
    vars: ['equipo', 'seccion_nuevas', 'seccion_seguimiento', 'seccion_resto', 'url_panel'], flags: [], required: ['seccion_nuevas', 'seccion_seguimiento', 'seccion_resto'],
    subject: 'Tu lista · {{equipo}}', heading: 'Tu equipo',
    body: `Esta es tu lista de **{{equipo}}**.\n\n{{seccion_nuevas}}\n\n{{seccion_seguimiento}}\n\n{{seccion_resto}}\n\n${FOOT}`,
  },
  admin_no_leader: {
    group: 'admin', title: 'Sin líder asignado', to: 'Administración',
    when: 'En cuanto llega una solicitud a un equipo y ciudad sin ningún líder asignado. Sin este aviso, nadie se enteraría de esa solicitud hasta que se asigne un líder.',
    vars: ['nombre_completo', 'telefono', 'equipo', 'ciudad', 'url_panel'], flags: [], required: ['nombre_completo', 'equipo', 'ciudad'],
    subject: 'Sin líder para {{equipo}} en {{ciudad}}', heading: 'Falta un líder',
    body: `**{{nombre_completo}}** ({{telefono}}) quiere servir en **{{equipo}}** en {{ciudad}} y no hay ningún líder asignado.\n\nAsigna un líder de equipo para que pueda contactar con esta persona.\n\n${FOOT}`,
  },
};
const GROUPS = { persona: 'A la persona que se apunta', lider: 'Al líder del equipo', admin: 'A la administración' };

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
    // Un botón puede apuntar a un enlace fijo o a un marcador de enlace ({{url_panel}}, {{enlace_bases}}…)
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
  const vars = { url_panel: `${config.appUrl}/panel`, enlace_bases: config.urls.bases, enlace_gc: config.urls.gc, ...(ctx.vars || {}) };
  const html = layout(plain(t.heading, vars), bodyToHtml(t.body, { ...ctx, vars }));
  return { subject: plain(t.subject, vars), html, text: htmlToText(html), enabled: t.enabled !== false };
}

/** Datos de ejemplo para la vista previa y el email de prueba del panel. */
function sampleContext(key) {
  const contrastadoOk = { ok: true, label: 'Sí' };
  const contrastadoNo = { ok: false, label: 'No', guidance: 'Dice tener Bases 2, pero no consta en Planning Center. Contacta con el equipo de PCO de tu campus para corregirlo.', reminder: 'Recuerda que es importante que haga el paso que le falta antes de empezar a servir.' };
  const person = { name: 'Ana Ruiz', email: 'ana@ejemplo.es', phone: '+34 600 111 222', city: 'Madrid', pco_url: 'https://people.planningcenteronline.com/people/1', cursos: 'Bases 1: Sí · Bases 2: No · GC: Sí', contrastado: contrastadoNo };
  const persona2 = { ...person, name: 'Luis Pérez', phone: '+34 611 222 333', email: 'luis@ejemplo.es', cursos: 'Bases 1: Sí · Bases 2: Sí · GC: Sí', contrastado: contrastadoOk };
  const line = (a) => {
    let l = `<b>${esc(a.name)}</b> · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a> · ${esc(a.city)} · <a href="${esc(a.pco_url)}">Perfil</a>`;
    if (a.cursos) l += `<br><span style="color:#71717a">${esc(a.cursos)} · Contrastado con PCO: ${esc(a.contrastado.label)}</span>`;
    if (!a.contrastado.ok) l += `<br><span style="color:#b45309">⚠ ${esc(a.contrastado.guidance)}</span>`;
    if (a.contrastado.reminder) l += `<br><span style="color:#b45309">${esc(a.contrastado.reminder)}</span>`;
    return l;
  };
  const list = `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px"><li>${line(person)}</li><li>${line(persona2)}</li></ul>`;
  const h = (t) => `<h2 style="font-size:16px">${t}</h2>`;
  return {
    vars: { nombre: 'Ana', nombre_completo: 'Ana Ruiz', telefono: person.phone, equipo: 'Locales › Cafetería', ciudad: 'Madrid', cursos: person.cursos },
    flags: { encontrado: true, no_encontrado: false },
    blocks: {
      faltan: `<ul style="line-height:1.7;margin:0 0 14px"><li><b>Bases 2</b> — <a href="${esc(config.urls.bases)}">${esc(config.urls.bases)}</a></li><li><b>un Grupo de Conexión (GC)</b> — <a href="${esc(config.urls.gc)}">${esc(config.urls.gc)}</a></li></ul>`,
      contraste: p(esc('Contrastando con Planning Center, todavía no consta que hayas hecho Bases 1. Si ya lo hiciste, pásate por el punto de información este domingo para que actualicemos tus datos.')),
      aviso_area: p('<i>El servicio en esta área sería ayudando en el equipo de organización y gestión de las actividades y eventos.</i>'),
      aviso_equipo: p('<i>Este equipo requiere una entrevista larga antes de empezar.</i>'),
      seccion_nuevas: h('🆕 Nuevas desde el último resumen') + list,
      seccion_seguimiento: h('🔁 Toca hacer seguimiento') + `<ul style="line-height:1.8;margin:0 0 16px;padding-left:20px"><li>${line(persona2)}</li></ul>`,
      seccion_resto: h('📋 Resto de tu lista') + list,
    },
  };
}

module.exports = { TEMPLATES, GROUPS, VARS, FLAGS, getTemplate, validate, render, sampleContext, esc, layout, btn, p };
