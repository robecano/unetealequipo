const config = require('./config');
const { db, logEvent } = require('./db');
const emails = require('./emails');
const { TEAM_LABEL } = require('./teams');

const BLOCKING = ['bases1', 'bases2']; // sin estos dos no se avisa al líder; GC se recomienda pero no bloquea
const FOLLOWUP_DAYS = 7;
const OPEN = ['recibida', 'pendiente_bases', 'listo', 'contactado', 'visito'];

const LABEL = { bases1: 'Bases 1', bases2: 'Bases 2', gc: 'GC' };
const CLAIM = { bases1: 'haber hecho Bases 1', bases2: 'haber hecho Bases 2', gc: 'tener un GC' };
const joinEs = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a.at(-1)}`);
const now = () => new Date().toISOString();
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

/** Ficha completa (con nombres de equipo y ciudad) lista para plantillas. */
function fullApp(id) {
  return db
    .prepare(`SELECT a.*, ${TEAM_LABEL} AS team_name, t.notice AS team_notice, t.min_months, c.name AS city
              FROM applications a JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id
              JOIN cities c ON c.id = a.city_id WHERE a.id = ?`)
    .get(id);
}

const leadersFor = (teamId, cityId) =>
  db.prepare(`SELECT u.* FROM users u
              JOIN leader_teams lt ON lt.user_id = u.id AND lt.team_id = ?
              JOIN user_cities uc ON uc.user_id = u.id AND uc.city_id = ?
              WHERE u.role = 'leader' AND u.active = 1`).all(teamId, cityId);

/** Voluntario de Bases de la ciudad con menos personas pendientes (reparto equilibrado). */
function pickBasesVolunteer(cityId) {
  return db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM applications a WHERE a.bases_user_id = u.id AND a.status = 'pendiente_bases') AS load
                     FROM users u JOIN user_cities uc ON uc.user_id = u.id AND uc.city_id = ?
                     WHERE u.role = 'bases' AND u.active = 1 ORDER BY load ASC, u.id ASC LIMIT 1`).get(cityId);
}

const forTemplate = (a, pcoUrl) => ({ name: a.name, email: a.email, phone: a.phone, city: a.city, pco_url: pcoUrl });

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
    try {
      await mail.sendMail({ to, ...msg });
      logEvent(id, null, 'email', label);
    } catch (e) {
      logEvent(id, null, 'email_error', `${label}: ${e.message}`);
      console.error(`Email "${label}" falló:`, e.message);
    }
  };
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
    logEvent(id, null, 'listo', 'Tiene Bases 2: pendiente de llamada del líder');
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
      if (person) course = await pco.getCourseStatus(person.id, { fields: config.fields, required: config.required });
    } catch (e) {
      db.prepare('UPDATE applications SET error=?, updated_at=? WHERE id=?').run(String(e.message).slice(0, 300), now(), id);
      logEvent(id, null, 'pco_error', e.message);
      return 'recibida'; // el planificador lo reintenta
    }

    if (!person) {
      setStatus('sin_pco');
      logEvent(id, null, 'sin_pco', 'No existe en Planning Center: se le envía Bases 1');
      await safeMail(id, 'aviso a la persona (Bases 1)', emails.applicantEmail({ app: a, team, missing: [], notFoundInPco: true }), a.email);
      return 'sin_pco';
    }

    // Si la persona dice que sí y en Planning Center no consta, se cree el formulario
    const declared = { bases1: !!a.self_bases1, bases2: !!a.self_bases2, gc: !!a.self_gc };
    const unverifiedKeys = Object.keys(LABEL).filter((k) => !course[k] && declared[k]);
    const missing = Object.keys(LABEL).filter((k) => !course[k] && !declared[k]);
    const blocked = missing.filter((k) => BLOCKING.includes(k));
    setStatus(blocked.length ? 'pendiente_bases' : 'recibida', {
      pco_person_id: person.id,
      pco_bases1: +course.bases1,
      pco_bases2: +course.bases2,
      pco_gc: +course.gc,
    });
    logEvent(id, null, 'pco_match', `Persona ${person.id} · faltan: ${missing.join(', ') || 'nada'}${unverifiedKeys.length ? ` · declarado sin constar en PCO: ${unverifiedKeys.join(', ')}` : ''}`);

    await writeNotes(id);

    await safeMail(id, 'aviso a la persona', emails.applicantEmail({ app: a, team, missing }), a.email);

    if (!blocked.length) {
      await markReady(id);
      return 'listo';
    }
    if (blocked.includes('bases2')) {
      const vol = pickBasesVolunteer(a.city_id);
      if (vol) {
        db.prepare('UPDATE applications SET bases_user_id=? WHERE id=?').run(vol.id, id);
        logEvent(id, null, 'bases_asignado', vol.email);
        await safeMail(id, 'aviso al voluntario de Bases', emails.basesEmail({ items: [{ app: forTemplate(a, person.url) }] }), vol.email);
      } else {
        await alertAdmin(id, `Sin voluntario de Bases en ${a.city}`, `${a.name} (${a.phone}) necesita Bases 2 en ${a.city} y no hay voluntarios asignados.`);
      }
    }
    return 'pendiente_bases';
  }

  /** Reintenta solicitudes que no se pudieron procesar (p. ej. Planning Center no respondía). */
  async function retryReceived() {
    const ids = db.prepare("SELECT id FROM applications WHERE status='recibida' AND created_at < ? ORDER BY id LIMIT 20").all(new Date(Date.now() - 2 * 60000).toISOString().replace('T', ' ').slice(0, 19));
    for (const { id } of ids) await process(id);
  }

  /** Vuelve a mirar en Planning Center a los pendientes: si ya tienen Bases 2, se avisa al líder. */
  async function recheckPending() {
    const rows = db.prepare("SELECT id, pco_person_id, self_bases1, self_bases2 FROM applications WHERE status='pendiente_bases' AND pco_person_id IS NOT NULL").all();
    let promoted = 0;
    for (const r of rows) {
      try {
        const c = await pco.getCourseStatus(r.pco_person_id, { fields: config.fields, required: config.required });
        db.prepare('UPDATE applications SET pco_bases1=?, pco_bases2=?, pco_gc=? WHERE id=?').run(+c.bases1, +c.bases2, +c.gc, r.id);
        if (BLOCKING.every((k) => c[k] || r['self_' + k])) {
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
    const scoped = (userId, statusList) =>
      db.prepare(`SELECT a.*, ${TEAM_LABEL} AS team_name, c.name AS city FROM applications a
                  JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id JOIN cities c ON c.id = a.city_id
                  WHERE a.status IN (${statusList.map(() => '?').join(',')})
                    AND a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)`).all(...statusList, userId);

    for (const l of db.prepare("SELECT * FROM users WHERE role='leader' AND active=1").all()) {
      const myTeams = db.prepare(`SELECT t.id, ${TEAM_LABEL} AS name FROM teams t LEFT JOIN teams p ON p.id = t.parent_id JOIN leader_teams lt ON lt.team_id = t.id WHERE lt.user_id = ?`).all(l.id);
      const rows = scoped(l.id, ['pendiente_bases', 'listo', 'contactado', 'visito']);
      for (const team of myTeams) {
        const mine = rows.filter((r) => r.team_id === team.id).map((r) => ({ ...r, tpl: forTemplate(r) }));
        const ready = mine.filter((r) => r.status === 'listo').map((r) => r.tpl);
        const followups = mine.filter((r) => ['contactado', 'visito'].includes(r.status) && r.followup_at && r.followup_at <= inDays(1)).map((r) => r.tpl);
        const pending = mine.filter((r) => r.status === 'pendiente_bases').map((r) => r.tpl);
        if (!ready.length && !followups.length && !pending.length) continue;
        await mail.sendMail({ to: l.email, ...emails.leaderDigestEmail({ team, ready, followups, pending }) }).then(() => sent++).catch((e) => console.error('Resumen líder:', e.message));
      }
    }
    for (const v of db.prepare("SELECT * FROM users WHERE role='bases' AND active=1").all()) {
      const items = scoped(v.id, ['pendiente_bases'])
        .filter((r) => (r.bases_user_id === v.id || !r.bases_user_id) && r.bases_status !== 'registrado')
        .map((r) => ({ app: forTemplate(r) }));
      if (!items.length) continue;
      await mail.sendMail({ to: v.email, ...emails.basesEmail({ items, digest: true }) }).then(() => sent++).catch((e) => console.error('Resumen Bases:', e.message));
    }
    return sent;
  }

  return { process, retryReceived, recheckPending, retryNotes, sendDigests, markReady };
}

module.exports = { createFlow, fullApp, FOLLOWUP_DAYS, OPEN, inDays, now };
