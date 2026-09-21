const config = require('./config');
const { db, logEvent } = require('./db');
const emails = require('./emails');
const { TEAM_LABEL } = require('./teams');

// El líder solo recibe el aviso inmediato cuando la persona tiene Bases 1, Bases 2 y GC. Si le falta algo, le llega en el listado opcional del resumen semanal.
const BLOCKING = ['bases1', 'bases2', 'gc'];
const FOLLOWUP_DAYS = 7;
const OPEN = ['recibida', 'pendiente_bases', 'listo', 'contactado', 'visito'];

const LABEL = { bases1: 'Bases 1', bases2: 'Bases 2', gc: 'GC' };
const CLAIM = { bases1: 'haber hecho Bases 1', bases2: 'haber hecho Bases 2', gc: 'tener un GC' };
const joinEs = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a.at(-1)}`);
const NOTA_FORM = 'Ya rellenó el formulario de Bases anteriormente pero no fue contactado';
const iso = (sqliteDate) => `${String(sqliteDate).replace(' ', 'T')}Z`; // SQLite guarda «aaaa-mm-dd hh:mm:ss» en UTC
const now = () => new Date().toISOString();
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

/** Ficha completa (con nombres de equipo y ciudad) lista para plantillas. */
function fullApp(id) {
  return db
    .prepare(`SELECT a.*, ${TEAM_LABEL} AS team_name, t.notice AS team_notice, p.notice AS area_notice, t.min_months, c.name AS city
              FROM applications a JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id
              JOIN cities c ON c.id = a.city_id WHERE a.id = ?`)
    .get(id);
}

const leadersFor = (teamId, cityId) =>
  db.prepare(`SELECT u.* FROM users u
              JOIN leader_teams lt ON lt.user_id = u.id AND lt.team_id = ?
              JOIN user_cities uc ON uc.user_id = u.id AND uc.city_id = ?
              WHERE u.role = 'leader' AND u.active = 1`).all(teamId, cityId);

/** Cuántas personas tiene ahora pendientes un voluntario (para repartir de forma equilibrada). */
const LOAD = {
  bases: "SELECT COUNT(*) FROM applications a WHERE a.bases_user_id = u.id AND a.needs_bases = 1 AND a.bases_removed = 0",
  gc: "SELECT COUNT(*) FROM applications a WHERE a.gc_user_id = u.id AND a.needs_gc = 1 AND a.gc_status != 'registrado' AND a.gc_removed = 0",
};

/** Voluntario (rol «bases» o «gc») de la ciudad con menos personas pendientes. */
function pickVolunteer(role, cityId) {
  return db.prepare(`SELECT u.*, (${LOAD[role]}) AS load
                     FROM users u JOIN user_cities uc ON uc.user_id = u.id AND uc.city_id = ?
                     WHERE u.role = ? AND u.active = 1 ORDER BY load ASC, u.id ASC LIMIT 1`).get(cityId, role);
}

/** Qué le falta a una solicitud, según Planning Center y lo que dijo la persona. */
function faltaDe(r) {
  if (r.status === 'sin_pco') return 'todo (no tiene ficha en Planning Center: Bases 1, Bases 2 y GC)'; // solicitudes anteriores a este cambio
  const falta = joinEs(Object.keys(LABEL).filter((k) => !r['pco_' + k] && !r['self_' + k]).map((k) => LABEL[k]));
  return r.pco_person_id ? falta : `${falta} (sin ficha en Planning Center)`;
}

/** Quién más va a contactar con la persona: solo los voluntarios que realmente tiene asignados (y a los que aún les toca). */
function contactoDe(r) {
  if (r.status === 'sin_pco') return 'Aún sin ficha: ningún voluntario le contacta todavía';
  const bases = r.needs_bases && r.bases_user_id && !r.bases_removed;
  const gc = r.needs_gc && r.gc_user_id && !r.gc_removed;
  if (bases && gc) return 'También le contactarán un voluntario de Bases y otro de GC';
  if (bases) return 'También le contactará un voluntario de Bases';
  if (gc) return 'También le contactará un voluntario de GC';
  return '';
}

/** Datos de la persona para las listas de Bases: incluye el aviso si ya rellenó el formulario antes y no llegó a ser contactada. */
const forBases = (a, pcoUrl) => ({ ...forTemplate(a, pcoUrl), nota: a.needs_bases && a.bases_form_before ? NOTA_FORM : '' });

const forTemplate = (a, pcoUrl) => ({ name: a.name, email: a.email, phone: a.phone, city: a.city, team: a.team_name, pco_url: pcoUrl });

/** Notas para el perfil de PCO: siempre el interés en servir y, si dice tener algo que no consta, otra nota aparte. */
function noteTexts(a) {
  const date = a.created_at.slice(0, 10);
  const texts = [`Interesado en servir en ${a.team_name} (${a.city}) · solicitud web ${date}`];
  const claimed = Object.keys(CLAIM).filter((k) => a['self_' + k] && !a['pco_' + k]);
  if (claimed.length) {
    texts.push(`La persona dice ${joinEs(claimed.map((k) => CLAIM[k]))}, pero no consta en Planning Center. Se acepta lo indicado en el formulario web (${date}).`);
  }
  return texts;
}

function createFlow({ pco, mail }) {
  const safeMail = async (id, label, msg, to) => {
    if (msg.enabled === false) return logEvent(id, null, 'email_desactivado', label); // desactivado por el admin en el panel
    try {
      await mail.sendMail({ to, ...msg });
      logEvent(id, null, 'email', label);
    } catch (e) {
      logEvent(id, null, 'email_error', `${label}: ${e.message}`);
      console.error(`Email "${label}" falló:`, e.message);
    }
  };
  /** Envíos de la persona a los formularios de Bases. Si Planning Center falla no se bloquea el flujo: solo se anota. */
  async function safeForms(id, personId) {
    try {
      return (await pco.getBasesFormSubmissions?.(personId)) || [];
    } catch (e) {
      logEvent(id, null, 'pco_error', `Formularios de Bases: ${e.message}`);
      return [];
    }
  }

  const alertAdmin = (id, subject, detail) => safeMail(id, `aviso admin: ${subject}`, emails.adminAlertEmail(subject, detail), config.adminNotifyEmail);

  /** Escribe las notas pendientes; si una falla, se reanuda por la que faltaba sin duplicar las anteriores. */
  async function writeNotes(id) {
    const a = fullApp(id);
    if (!a?.pco_person_id) return;
    const texts = noteTexts(a);
    try {
      for (let i = a.notes_done; i < texts.length; i++) {
        await pco.addNote(a.pco_person_id, texts[i], config.noteCategoryName);
        db.prepare('UPDATE applications SET notes_done=? WHERE id=?').run(i + 1, id);
      }
      db.prepare('UPDATE applications SET note_synced=1 WHERE id=?').run(id);
    } catch (e) {
      logEvent(id, null, 'nota_error', e.message);
    }
  }

  async function markReady(id) {
    const a = fullApp(id);
    db.prepare("UPDATE applications SET status='listo', ready_at=?, followup_at=?, updated_at=? WHERE id=?").run(now(), inDays(FOLLOWUP_DAYS), now(), id);
    logEvent(id, null, 'listo', 'Tiene Bases 1, Bases 2 y GC: pendiente de llamada del líder');
    const leaders = leadersFor(a.team_id, a.city_id);
    if (!leaders.length) return alertAdmin(id, `Sin líder para ${a.team_name} en ${a.city}`, `${a.name} (${a.phone}) quiere servir en ${a.team_name} en ${a.city} y no hay ningún líder asignado.`);
    // Cursos que la persona dice tener y que no constan en Planning Center: se aceptan, pero el líder debe confirmarlos al llamar
    const unverified = Object.keys(LABEL).filter((k) => a['self_' + k] && !a['pco_' + k]).map((k) => LABEL[k]);
    const msg = emails.leaderReadyEmail({ app: forTemplate(a), team: { name: a.team_name }, unverified });
    return safeMail(id, 'aviso al líder', msg, leaders.map((l) => l.email));
  }

  async function process(id) {
    let a = fullApp(id);
    if (!a || a.status !== 'recibida') return a?.status;
    const team = { name: a.team_name, notice: a.team_notice };
    const setStatus = (status, extra = {}) => {
      const cols = { status, updated_at: now(), error: null, ...extra };
      db.prepare(`UPDATE applications SET ${Object.keys(cols).map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(cols), id);
    };

    if (a.tenure_months < a.min_months) {
      setStatus('no_apto_aun');
      logEvent(id, null, 'no_apto_aun', `Antigüedad ${a.tenure_months} m < ${a.min_months} m`);
      await safeMail(id, 'aviso a la persona (antigüedad)', emails.applicantEmail({ app: a, team, missing: [], tenureShort: true }), a.email);
      return 'no_apto_aun';
    }

    let person;
    let course;
    try {
      person = await pco.findPerson({ email: a.email, phone: a.phone, name: a.name });
      // Sin ficha en Planning Center se trata como si no tuviera nada (ni Bases 1, ni Bases 2, ni GC)
      course = person ? await pco.getCourseStatus(person.id, { fields: config.fields, required: config.required }) : { bases1: false, bases2: false, gc: false };
    } catch (e) {
      db.prepare('UPDATE applications SET error=?, updated_at=? WHERE id=?').run(String(e.message).slice(0, 300), now(), id);
      logEvent(id, null, 'pco_error', e.message);
      return 'recibida'; // el planificador lo reintenta
    }

    // ¿Rellenó ya el formulario de Bases 1 o 2? Si fue antes de apuntarse a servir, se avisa al voluntario de Bases en su lista.
    const forms = person ? await safeForms(id, person.id) : [];
    const createdIso = iso(a.created_at);

    // Si la persona dice que sí y en Planning Center no consta, se cree el formulario
    const declared = { bases1: !!a.self_bases1, bases2: !!a.self_bases2, gc: !!a.self_gc };
    const unverifiedKeys = Object.keys(LABEL).filter((k) => !course[k] && declared[k]);
    const missing = Object.keys(LABEL).filter((k) => !course[k] && !declared[k]);
    const has = (k) => !missing.includes(k);
    // Reparto: sin Bases 1 o sin Bases 2 → voluntario de Bases. Con Bases 1 y sin GC → voluntario de GC.
    // (nada → Bases; solo Bases 1 → Bases y GC; Bases 1 + GC → Bases; Bases 1 + Bases 2 → GC)
    const needsBases = !has('bases1') || !has('bases2');
    const needsGc = has('bases1') && !has('gc');
    const blocked = missing.filter((k) => BLOCKING.includes(k));
    setStatus(blocked.length ? 'pendiente_bases' : 'recibida', {
      pco_person_id: person?.id ?? null,
      pco_bases1: person ? +course.bases1 : null, // null = no se sabe (no hay ficha)
      pco_bases2: person ? +course.bases2 : null,
      pco_gc: person ? +course.gc : null,
      needs_gc: +needsGc,
      needs_bases: +needsBases,
      bases_form_before: +(needsBases && forms.some((f) => f.created_at <= createdIso)),
      bases_form_at: forms[0]?.created_at || null,
    });
    logEvent(id, null, 'pco_match', `${person ? `Persona ${person.id}` : 'Sin ficha en Planning Center: se trata como si no tuviera nada'} · faltan: ${missing.join(', ') || 'nada'}${unverifiedKeys.length ? ` · declarado sin constar en PCO: ${unverifiedKeys.join(', ')}` : ''}`);

    await writeNotes(id);

    // Se asignan los voluntarios antes del email a la persona, para prometerle solo lo que va a pasar de verdad
    const volunteers = {};
    for (const [role, needed, label] of [['bases', needsBases, 'Bases'], ['gc', needsGc, 'GC']]) {
      if (!needed) continue;
      const vol = pickVolunteer(role, a.city_id);
      if (vol) {
        db.prepare(`UPDATE applications SET ${role}_user_id=? WHERE id=?`).run(vol.id, id);
        logEvent(id, null, `${role}_asignado`, vol.email);
        volunteers[role] = vol;
      } else {
        await alertAdmin(id, `Sin voluntario de ${label} en ${a.city}`, `${a.name} (${a.phone}) necesita un voluntario de ${label} en ${a.city} y no hay ninguno asignado.`);
      }
    }

    await safeMail(id, 'aviso a la persona', emails.applicantEmail({ app: a, team, missing, notFoundInPco: !person, assign: { bases: !!volunteers.bases, gc: !!volunteers.gc } }), a.email);
    if (volunteers.bases) {
      const fresh = fullApp(id); // con las marcas recién calculadas
      await safeMail(id, 'aviso al voluntario de Bases', emails.basesEmail({ items: [{ app: forBases(fresh, person?.url) }], missing }), volunteers.bases.email);
    }
    if (volunteers.gc) await safeMail(id, 'aviso al voluntario de GC', emails.gcEmail({ items: [{ app: forTemplate(a, person?.url) }] }), volunteers.gc.email);

    if (!blocked.length) {
      await markReady(id);
      return 'listo';
    }
    return 'pendiente_bases';
  }

  /** Reintenta solicitudes que no se pudieron procesar (p. ej. Planning Center no respondía). */
  async function retryReceived() {
    const ids = db.prepare("SELECT id FROM applications WHERE status='recibida' AND created_at < ? ORDER BY id LIMIT 20").all(new Date(Date.now() - 2 * 60000).toISOString().replace('T', ' ').slice(0, 19));
    for (const { id } of ids) await process(id);
  }

  /** Asigna un voluntario de GC (y le avisa) si a la persona ya le toca uno y todavía no lo tiene. */
  async function ensureGcVolunteer(id) {
    const a = fullApp(id);
    if (!a || a.gc_user_id) return;
    const vol = pickVolunteer('gc', a.city_id);
    if (!vol) return;
    db.prepare('UPDATE applications SET gc_user_id = ? WHERE id = ?').run(vol.id, id);
    logEvent(id, null, 'gc_asignado', vol.email);
    await safeMail(id, 'aviso al voluntario de GC', emails.gcEmail({ items: [{ app: forTemplate(a, a.pco_person_id ? `https://people.planningcenteronline.com/people/${a.pco_person_id}` : undefined) }] }), vol.email);
  }

  /**
   * Vuelve a mirar en Planning Center a los pendientes (de Bases o de GC).
   * Si ya tienen Bases 1, Bases 2 y GC se avisa al líder; si acaban Bases 1 y les falta GC, se asigna un voluntario de GC.
   */
  async function recheckPending() {
    const rows = db.prepare("SELECT id, status, created_at, name, email, phone, pco_person_id, self_bases1, self_bases2, self_gc, bases_removed FROM applications WHERE (status = 'pendiente_bases' OR needs_gc = 1 OR needs_bases = 1)").all();
    let promoted = 0;
    for (const r of rows) {
      try {
        // Sin ficha al apuntarse: si ya ha aparecido en Planning Center (p. ej. porque se registró en Bases), se enlaza y se anotan sus notas
        if (!r.pco_person_id) {
          const found = await pco.findPerson({ email: r.email, phone: r.phone, name: r.name });
          if (!found) continue;
          db.prepare('UPDATE applications SET pco_person_id = ?, note_synced = 0, notes_done = 0, updated_at = ? WHERE id = ?').run(found.id, now(), r.id);
          logEvent(r.id, null, 'pco_enlazada', `Ya tiene ficha en Planning Center (${found.id})`);
          r.pco_person_id = found.id;
          await writeNotes(r.id);
        }
        const c = await pco.getCourseStatus(r.pco_person_id, { fields: config.fields, required: config.required });
        const has = (k) => !!c[k] || !!r['self_' + k];
        const needsGc = has('bases1') && !has('gc');
        const needsBases = !has('bases1') || !has('bases2');
        db.prepare('UPDATE applications SET pco_bases1=?, pco_bases2=?, pco_gc=?, needs_gc=?, needs_bases=? WHERE id=?').run(+c.bases1, +c.bases2, +c.gc, +needsGc, +needsBases, r.id);
        // Si rellenó el formulario de Bases DESPUÉS de apuntarse a servir, sale de la lista del voluntario de Bases
        if (needsBases && !r.bases_removed) {
          const forms = await safeForms(r.id, r.pco_person_id);
          db.prepare('UPDATE applications SET bases_form_at = ? WHERE id = ?').run(forms[0]?.created_at || null, r.id);
          const despues = forms.find((f) => f.created_at > iso(r.created_at));
          if (despues) {
            db.prepare('UPDATE applications SET bases_removed = 1, updated_at = ? WHERE id = ?').run(now(), r.id);
            logEvent(r.id, null, 'bases_formulario', `Rellenó el formulario de Bases el ${despues.created_at.slice(0, 10)}: sale de la lista del voluntario de Bases`);
          }
        }
        if (needsGc) await ensureGcVolunteer(r.id);
        if (r.status === 'pendiente_bases' && BLOCKING.every(has)) {
          await markReady(r.id);
          promoted++;
        }
      } catch (e) {
        logEvent(r.id, null, 'pco_error', e.message);
      }
    }
    return promoted;
  }

  async function retryNotes() {
    const rows = db.prepare('SELECT id FROM applications WHERE note_synced=0 AND pco_person_id IS NOT NULL LIMIT 20').all();
    for (const r of rows) await writeNotes(r.id);
  }

  /** Resumen semanal a líderes y voluntarios de Bases. Devuelve cuántos emails se enviaron. */
  async function sendDigests() {
    let sent = 0;
    const deliver = async (to, msg, label) => {
      if (msg.enabled === false) return; // desactivado por el admin en el panel
      await mail.sendMail({ to, ...msg }).then(() => sent++).catch((e) => console.error(`${label}:`, e.message));
    };
    const scoped = (userId, statusList) =>
      db.prepare(`SELECT a.*, ${TEAM_LABEL} AS team_name, c.name AS city FROM applications a
                  JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id JOIN cities c ON c.id = a.city_id
                  WHERE a.status IN (${statusList.map(() => '?').join(',')})
                    AND a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)
                    AND NOT (a.status = 'sin_pco' AND EXISTS (SELECT 1 FROM applications b WHERE lower(b.email) = lower(a.email) AND b.team_id = a.team_id AND b.id > a.id))`).all(...statusList, userId); // quien no tenía ficha y volvió a apuntarse: solo cuenta la última

    for (const l of db.prepare("SELECT * FROM users WHERE role='leader' AND active=1").all()) {
      const myTeams = db.prepare(`SELECT t.id, ${TEAM_LABEL} AS name FROM teams t LEFT JOIN teams p ON p.id = t.parent_id JOIN leader_teams lt ON lt.team_id = t.id WHERE lt.user_id = ?`).all(l.id);
      const rows = scoped(l.id, ['pendiente_bases', 'sin_pco', 'listo', 'contactado', 'visito']).filter((r) => !r.leader_hidden); // lo que el líder quitó de su listado no se le vuelve a enviar
      for (const team of myTeams) {
        const mine = rows.filter((r) => r.team_id === team.id);
        const ready = mine.filter((r) => r.status === 'listo').map((r) => forTemplate(r));
        const followups = mine.filter((r) => ['contactado', 'visito'].includes(r.status) && r.followup_at && r.followup_at <= inDays(1)).map((r) => forTemplate(r));
        // Listado aparte y opcional: interesados que aún no tienen Bases 1, Bases 2 o GC (o ni siquiera ficha en Planning Center)
        const pending = mine.filter((r) => ['pendiente_bases', 'sin_pco'].includes(r.status)).map((r) => ({ ...forTemplate(r), falta: faltaDe(r), contacto: contactoDe(r) }));
        if (!ready.length && !followups.length && !pending.length) continue;
        await deliver(l.email, emails.leaderDigestEmail({ team, ready, followups, pending }), 'Resumen líder');
      }
    }
    for (const v of db.prepare("SELECT * FROM users WHERE role='bases' AND active=1").all()) {
      const items = scoped(v.id, ['pendiente_bases'])
        .filter((r) => r.needs_bases && !r.bases_removed && (r.bases_user_id === v.id || !r.bases_user_id) && r.bases_status !== 'registrado')
        .map((r) => ({ app: forBases(r) }));
      if (!items.length) continue;
      await deliver(v.email, emails.basesEmail({ items, digest: true }), 'Resumen Bases');
    }
    // Voluntarios de GC: personas con Bases 1 que aún no están en un Grupo de Conexión
    for (const v of db.prepare("SELECT * FROM users WHERE role='gc' AND active=1").all()) {
      const items = scoped(v.id, ['recibida', 'pendiente_bases', 'listo', 'contactado', 'visito'])
        .filter((r) => r.needs_gc && !r.gc_removed && (r.gc_user_id === v.id || !r.gc_user_id) && r.gc_status !== 'registrado')
        .map((r) => ({ app: forTemplate(r) }));
      if (!items.length) continue;
      await deliver(v.email, emails.gcEmail({ items, digest: true }), 'Resumen GC');
    }
    return sent;
  }

  return { process, retryReceived, recheckPending, retryNotes, sendDigests, markReady };
}

module.exports = { createFlow, fullApp, FOLLOWUP_DAYS, OPEN, inDays, now };
