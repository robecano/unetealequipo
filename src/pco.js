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

async function getCourseStatus(personId, { fields, required }) {
  const ids = {};
  for (const k of ['bases1', 'bases2', 'gc']) ids[k] = String(await fieldDefinitionId(fields[k]));
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

module.exports = { PcoError, request, getAll, findPerson, getCourseStatus, addNote, fieldDone, phoneKey };
