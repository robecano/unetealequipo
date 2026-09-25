const config = require('./config');

class PcoError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = 'PcoError';
    this.status = status;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeader() {
  const { appId, secret } = config.pco;
  if (!appId || !secret) throw new PcoError(0, 'Faltan PCO_APP_ID / PCO_SECRET en la configuración');
  return 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64');
}

function buildUrl(pathOrUrl, query) {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(config.pco.base + pathOrUrl);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url;
}

/**
 * Petición a la API de Planning Center (JSON:API).
 * Reintenta con espera si hay límite de peticiones (429) o errores 5xx transitorios.
 */
async function request(method, pathOrUrl, { query, body } = {}) {
  const url = buildUrl(pathOrUrl, query);
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader(),
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw new PcoError(0, `No se pudo conectar con Planning Center: ${err.message}`);
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 30);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < maxAttempts && method === 'GET') {
      await sleep(500 * attempt);
      continue;
    }

    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        /* respuesta no JSON */
      }
    }
    if (!res.ok) {
      const detail = json?.errors?.map((e) => e.detail || e.title).filter(Boolean).join('; ');
      throw new PcoError(res.status, `Planning Center respondió ${res.status}${detail ? `: ${detail}` : ''}`, json);
    }
    return json;
  }
}

/** Recorre todas las páginas siguiendo links.next. Devuelve { data, included }. */
async function getAll(path, query = {}) {
  const data = [];
  const included = [];
  let next = path;
  let q = { per_page: 100, ...query };
  for (let page = 0; next && page < 200; page++) {
    const json = await request('GET', next, { query: q });
    data.push(...(json?.data || []));
    included.push(...(json?.included || []));
    next = json?.links?.next || null;
    q = undefined; // la URL "next" ya lleva los parámetros
  }
  return { data, included };
}

const attrs = (r) => r?.attributes || {};
const norm = (s) => String(s || '').trim().toLowerCase();
/** Últimos 9 dígitos: iguala "+34 600 11 22 33", "600112233" y "0034600112233". */
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-9);

// ---------- Búsqueda y coincidencia de personas ----------

async function loadCandidate(person) {
  const json = await request('GET', `/people/v2/people/${person.id}`, { query: { include: 'emails,phone_numbers' } });
  const inc = json.included || [];
  return {
    id: String(json.data.id),
    name: attrs(json.data).name || '',
    created_at: attrs(json.data).created_at || '',
    url: json.data.links?.html || `https://people.planningcenteronline.com/people/${json.data.id}`,
    emails: inc.filter((i) => i.type === 'Email').map((i) => norm(attrs(i).address)),
    phones: inc.filter((i) => i.type === 'PhoneNumber').map((i) => phoneKey(attrs(i).number)).filter(Boolean),
  };
}

/**
 * Busca a la persona por email y por teléfono y elige la mejor coincidencia.
 * Puntúa: email igual (+2), teléfono igual (+2), nombre igual (+1). Con empate gana la ficha más antigua
 * (es la que suele tener el historial). Devuelve null si no hay ninguna que coincida en email o teléfono.
 */
async function findPerson({ email, phone, name }) {
  const found = new Map();
  for (const term of [email, phone].filter(Boolean)) {
    const { data } = await getAll('/people/v2/people', { 'where[search_name_or_email_or_phone_number]': term, per_page: 25 });
    for (const p of data) found.set(String(p.id), p);
  }
  const wantEmail = norm(email);
  const wantPhone = phoneKey(phone);
  const wantName = norm(name);
  const scored = [];
  for (const p of found.values()) {
    const c = await loadCandidate(p);
    const byEmail = wantEmail && c.emails.includes(wantEmail);
    const byPhone = wantPhone.length >= 6 && c.phones.includes(wantPhone);
    if (!byEmail && !byPhone) continue;
    scored.push({ ...c, score: (byEmail ? 2 : 0) + (byPhone ? 2 : 0) + (norm(c.name) === wantName ? 1 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at));
  return scored[0] || null;
}

// ---------- Campos de Bases 1 / Bases 2 / GC ----------

const defCache = new Map(); // nombre -> id
async function fieldDefinitionId(name) {
  if (defCache.has(name)) return defCache.get(name);
  const { data } = await getAll('/people/v2/field_definitions');
  const def = data.find((f) => norm(attrs(f).name) === norm(name) && !attrs(f).deleted_at);
  if (!def) throw new PcoError(0, `No existe el campo personalizado "${name}" en Planning Center`);
  defCache.set(name, def.id);
  return def.id;
}

/** ¿Tiene marcado el campo? Con `required` hay que tener todos esos valores; sin él, basta cualquier valor. */
function fieldDone(values, required) {
  if (!required.length) return values.length > 0;
  const have = new Set(values.map(norm));
  return required.every((r) => have.has(norm(r)));
}

/**
 * Bases 1 y Bases 2: se leen de los campos personalizados de la ficha (asistencia real a las sesiones). El GC
 * ya NO se lee de aquí (del checkbox «GC Asignado»): ver getGcInfo, que comprueba la membresía real en
 * Planning Center Groups, porque el checkbox se puede quedar desactualizado.
 */
async function getCourseStatus(personId, { fields, required }) {
  const ids = {};
  for (const k of ['bases1', 'bases2']) ids[k] = String(await fieldDefinitionId(fields[k]));
  const { data } = await getAll(`/people/v2/people/${personId}/field_data`);
  const out = {};
  for (const k of Object.keys(ids)) {
    const values = data.filter((d) => String(d.relationships?.field_definition?.data?.id) === ids[k]).map((d) => attrs(d).value);
    out[k] = fieldDone(values, required[k] || []);
  }
  return out;
}

// ---------- Notas ----------

let categoryId = null;
async function noteCategory(name) {
  if (categoryId) return categoryId;
  const { data } = await getAll('/people/v2/note_categories');
  let cat = data.find((c) => norm(attrs(c).name) === norm(name));
  if (!cat) {
    const json = await request('POST', '/people/v2/note_categories', { body: { data: { type: 'NoteCategory', attributes: { name } } } });
    cat = json.data;
  }
  return (categoryId = cat.id);
}

async function addNote(personId, text, categoryName) {
  const id = await noteCategory(categoryName);
  const json = await request('POST', `/people/v2/people/${personId}/notes`, {
    body: { data: { type: 'Note', attributes: { note: text, note_category_id: Number(id) } } },
  });
  return json.data.id;
}

/** Borra una nota de la ficha de la persona (comprobado contra producción: DELETE /people/v2/notes/{id} funciona). */
async function deleteNote(noteId) {
  await request('DELETE', `/people/v2/notes/${noteId}`);
}

// ---------- Formularios de registro (Bases 1, Bases 2 y GC) ----------
// «Registro Bases 1 …», «Registro Bases 2 …» y «Registro a Grupos de Conexión …» (uno por ciudad cada uno).
// Se excluyen los de Bases 3 (liderazgo, no es un paso de este flujo) y los ya archivados.
const FORM_PATTERNS = {
  bases1: /^\s*Registro Bases 1\b/i,
  bases2: /^\s*Registro Bases 2\b/i,
  gc: /^\s*Registro a Grupos? de Conexi[oó]n\b/i,
};
let formIdCache = { at: 0, ids: null };

async function formIdsByCourse() {
  if (formIdCache.ids && Date.now() - formIdCache.at < 6 * 3600 * 1000) return formIdCache.ids;
  const { data } = await getAll('/people/v2/forms', { per_page: 100 });
  const active = data.filter((f) => !attrs(f).archived_at);
  const ids = {};
  for (const k of Object.keys(FORM_PATTERNS)) ids[k] = new Set(active.filter((f) => FORM_PATTERNS[k].test(attrs(f).name || '')).map((f) => String(f.id)));
  formIdCache = { at: Date.now(), ids };
  return ids;
}

// «Asistencia Bloques 1,2 y 3 (Sesión 1) de Bases 1» y «… (Sesión 2) de Bases 1»: dos formularios únicos (no
// por ciudad), uno por sesión. Si la persona envió los dos, ha asistido a Bases 1 aunque el campo de casillas
// de su ficha todavía no lo tenga marcado (alguien tiene que marcarlo a mano, y puede quedarse desactualizado).
const BASES1_ATTENDANCE_PATTERNS = [
  /^\s*Asistencia Bloques 1,?\s*2 y\s*3 \(Sesi[oó]n 1\) de Bases 1\b/i,
  /^\s*Asistencia Bloques 4,?\s*5 y\s*6 \(Sesi[oó]n 2\) de Bases 1\b/i,
];
let bases1AttFormIdsCache = null;

async function bases1AttendanceFormIds() {
  if (bases1AttFormIdsCache) return bases1AttFormIdsCache;
  const { data } = await getAll('/people/v2/forms', { per_page: 100 });
  const active = data.filter((f) => !attrs(f).archived_at);
  bases1AttFormIdsCache = BASES1_ATTENDANCE_PATTERNS
    .map((re) => active.find((f) => re.test(attrs(f).name || '')))
    .map((f) => f && String(f.id))
    .filter(Boolean);
  return bases1AttFormIdsCache;
}

/**
 * ¿Ha enviado la persona el formulario de registro de Bases 1, Bases 2 y/o GC? Independiente de si Planning
 * Center ya ha confirmado el curso (eso tarda: alguien tiene que pasar asistencia o marcar el GC) — sirve para
 * ver, mientras se espera esa confirmación, si la persona ya se está apuntando por su cuenta. También devuelve
 * `bases1Attendance`: si envió los dos formularios de asistencia de Bases 1 (ver bases1AttendanceFormIds),
 * una vía alternativa a que el campo de casillas de su ficha esté marcado.
 *
 * Usa /people/v2/people/{id}/form_submissions (comprobado contra producción: existe y responde bien). La
 * alternativa de recorrer cada formulario entero para construir un índice se probó y se descartó: en un
 * formulario activo (con envíos nuevos entrando mientras se pagina) la paginación puede saltarse registros —
 * comprobado también contra producción, donde así faltaba un envío real que sí existía.
 */
async function getFormStatus(personId) {
  const [ids, attIds] = await Promise.all([formIdsByCourse(), bases1AttendanceFormIds()]);
  const { data } = await getAll(`/people/v2/people/${personId}/form_submissions`, { per_page: 100 });
  const submitted = new Set(data.map((d) => String(d.relationships?.form?.data?.id || '')));
  const has = (k) => [...ids[k]].some((id) => submitted.has(id));
  const bases1Attendance = attIds.length === 2 && attIds.every((id) => submitted.has(id));
  return { bases1: has('bases1'), bases2: has('bases2'), gc: has('gc'), bases1Attendance };
}

// ---------- Grupo de Conexión (Planning Center Groups) ----------
// Cada campus tiene su propio GroupType "Grupo de Conexión <ciudad>" (los GC reales no llevan "GC" ni
// "Conexión" en el nombre del grupo en sí, p. ej. "Pablo y Carolina": se identifican por su categoría, no por
// el nombre). El checkbox "GC Asignado" de la ficha de la persona no siempre está sincronizado con esto, así
// que se busca la membresía real en vez de fiarse solo del checkbox.
const GC_GROUP_TYPE_RE = /^Grupo de Conexi[oó]n\b/i;
let gcTypeCache = null;

/** IDs de los GroupType "Grupo de Conexión <ciudad>" (uno por campus). Se cachean: no cambian en caliente. */
async function gcGroupTypeIds() {
  if (gcTypeCache) return gcTypeCache;
  const { data } = await getAll('/groups/v2/group_types');
  gcTypeCache = new Set(data.filter((t) => GC_GROUP_TYPE_RE.test(attrs(t).name || '')).map((t) => String(t.id)));
  return gcTypeCache;
}

/**
 * ¿Está la persona en un Grupo de Conexión de verdad, según Planning Center Groups (no el checkbox "GC
 * Asignado" de su ficha, que se puede quedar desactualizado)? Recorre sus membresías y busca una de un grupo de
 * tipo "Grupo de Conexión <ciudad>" que siga activo (no archivado) — así es como se comprueba a mano en
 * groups.planningcenteronline.com. Si solo encuentra una membresía en un grupo ya archivado, no cuenta como
 * "en GC" pero se devuelve igualmente su nombre (por si sirve de referencia). Nunca lanza: si algo falla (API
 * caída, sin permisos…) se traga el error y devuelve que no está en ningún GC, para no bloquear el resto del
 * proceso por esto.
 */
async function getGcInfo(personId) {
  if (!personId) return { inGc: false, groupName: null };
  try {
    const typeIds = await gcGroupTypeIds();
    if (!typeIds.size) return { inGc: false, groupName: null };
    const { data: memberships } = await getAll(`/groups/v2/people/${personId}/memberships`);
    let archivedName = null;
    for (const m of memberships) {
      const groupId = m.relationships?.group?.data?.id;
      if (!groupId) continue;
      const json = await request('GET', `/groups/v2/groups/${groupId}`, { query: { include: 'group_type' } });
      const group = json.data;
      const typeId = String(group?.relationships?.group_type?.data?.id || '');
      if (!typeIds.has(typeId)) continue;
      if (!attrs(group).archived_at) return { inGc: true, groupName: attrs(group).name || null };
      archivedName ??= attrs(group).name || null;
    }
    return { inGc: false, groupName: archivedName };
  } catch {
    return { inGc: false, groupName: null };
  }
}

module.exports = {
  PcoError, request, getAll, findPerson, getCourseStatus, addNote, deleteNote, fieldDone, phoneKey,
  getGcInfo, gcGroupTypeIds, getFormStatus };
