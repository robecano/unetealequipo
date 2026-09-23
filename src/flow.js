const config = require('./config');
const { db, logEvent, getSetting, setSetting } = require('./db');
const emails = require('./emails');
const { TEAM_LABEL } = require('./teams');
const courses = require('./courses');

const FOLLOWUP_DAYS = 7;
const OPEN = ['recibida', 'listo', 'contactado', 'visito'];
const CLAIM = { bases1: 'haber hecho Bases 1', bases2: 'haber hecho Bases 2', gc: 'tener un GC' };
const now = () => new Date().toISOString();
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
// SQLite CURRENT_TIMESTAMP guarda "AAAA-MM-DD HH:MM:SS" (sin T ni Z); lo pasamos a ISO para poder comparar con now()/inDays().
const iso = (sqliteDate) => `${String(sqliteDate).replace(' ', 'T')}Z`;

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

const forTemplate = (a, pcoUrl) => ({
  name: a.name, email: a.email, phone: a.phone, city: a.city, team: a.team_name, pco_url: pcoUrl,
  cursos: courses.courseLine(a), contrastado: courses.contrastadoInfo(a),
});

/** Notas para el perfil de PCO: siempre el interés en servir y, si dice tener algo que no consta, otra nota aparte. */
function noteTexts(a) {
  const date = a.created_at.slice(0, 10);
  const texts = [`Interesado en servir en ${a.team_name} (${a.city}) · solicitud web ${date}`];
  const claimed = courses.mismatches(a);
  if (claimed.length) {
    texts.push(`La persona dice ${courses.joinEs(claimed.map((k) => CLAIM[k]))}, pero no consta en Planning Center. Se acepta lo indicado en el formulario web (${date}).`);
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

  /**
   * Los líderes ya no reciben un email por cada solicitud: la ven en su lista programada (sendDigests) y en el
   * panel en todo momento. Si su equipo y ciudad no tienen ningún líder asignado, se avisa a administración
   * para que lo asigne (si no, nadie se enteraría de esa solicitud hasta que alguien mire el panel).
   */
  async function alertIfNoLeader(id) {
    const a = fullApp(id);
    if (leadersFor(a.team_id, a.city_id).length) return;
    const msg = emails.adminNoLeaderEmail({ app: forTemplate(a) });
    return safeMail(id, `aviso admin: sin líder para ${a.team_name} en ${a.city}`, msg, config.adminNotifyEmail);
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

    setStatus('listo', {
      ready_at: now(),
      followup_at: inDays(FOLLOWUP_DAYS),
      pco_person_id: person?.id ?? null,
      pco_bases1: person ? +course.bases1 : null, // null = no se sabe (no hay ficha)
      pco_bases2: person ? +course.bases2 : null,
      pco_gc: person ? +course.gc : null,
    });
    const after = fullApp(id); // con los datos recién calculados, para el resto del proceso
    const missing = courses.missing(after);
    const mismatched = courses.mismatches(after);
    logEvent(id, null, 'pco_match', `${person ? `Persona ${person.id}` : 'Sin ficha en Planning Center: se trata como si no tuviera nada'} · faltan: ${missing.map((k) => courses.LABEL[k]).join(', ') || 'nada'}${mismatched.length ? ` · declarado sin constar en PCO: ${mismatched.map((k) => courses.LABEL[k]).join(', ')}` : ''}`);

    await writeNotes(id);
    await safeMail(id, 'aviso a la persona', emails.applicantEmail({ app: after, team, missing, mismatched, notFoundInPco: !person }), a.email);
    await alertIfNoLeader(id);
    return 'listo';
  }

  /** Reintenta solicitudes que no se pudieron procesar (p. ej. Planning Center no respondía). */
  async function retryReceived() {
    const ids = db.prepare("SELECT id FROM applications WHERE status='recibida' AND created_at < ? ORDER BY id LIMIT 20").all(new Date(Date.now() - 2 * 60000).toISOString().replace('T', ' ').slice(0, 19));
    for (const { id } of ids) await process(id);
  }

  async function retryNotes() {
    const rows = db.prepare('SELECT id FROM applications WHERE note_synced=0 AND pco_person_id IS NOT NULL LIMIT 20').all();
    for (const r of rows) await writeNotes(r.id);
  }

  /**
   * Mantiene al día los cursos de las solicitudes abiertas (para el resumen y la columna «Contrastado con PCO»):
   * si a alguien sin ficha le aparece una después (p. ej. porque se registró en Bases), se enlaza y se anotan
   * sus notas; a quien ya tiene ficha se le refresca Bases 1, Bases 2 y GC. No reenvía ningún aviso: el líder ya
   * recibió el suyo al apuntarse, y los cambios se reflejan en el resumen y en el panel.
   */
  async function refreshCourses() {
    const rows = db.prepare("SELECT id, name, email, phone, pco_person_id FROM applications WHERE status IN ('listo','contactado','visito')").all();
    let refreshed = 0;
    for (const r of rows) {
      try {
        let personId = r.pco_person_id;
        if (!personId) {
          const found = await pco.findPerson({ email: r.email, phone: r.phone, name: r.name });
          if (!found) continue;
          personId = found.id;
          db.prepare('UPDATE applications SET pco_person_id=?, note_synced=0, notes_done=0, updated_at=? WHERE id=?').run(personId, now(), r.id);
          logEvent(r.id, null, 'pco_enlazada', `Ya tiene ficha en Planning Center (${personId})`);
          await writeNotes(r.id);
        }
        const c = await pco.getCourseStatus(personId, { fields: config.fields, required: config.required });
        db.prepare('UPDATE applications SET pco_bases1=?, pco_bases2=?, pco_gc=?, updated_at=? WHERE id=?').run(+c.bases1, +c.bases2, +c.gc, now(), r.id);
        refreshed++;
      } catch (e) {
        logEvent(r.id, null, 'pco_error', e.message);
      }
    }
    return refreshed;
  }

  /**
   * Resumen a cada líder (uno por equipo), con toda su lista abierta: nuevas desde el último resumen, a quien
   * toca hacer seguimiento y el resto. Se envía a la hora y los días configurados (por defecto domingo y jueves).
   */
  async function sendDigests() {
    let sent = 0;
    const prevRun = getSetting('digest_prev_run'); // marca de antes de esta tanda: lo posterior es «nuevo»
    await refreshCourses();
    for (const l of db.prepare("SELECT * FROM users WHERE role='leader' AND active=1").all()) {
      const myTeams = db.prepare(`SELECT t.id, ${TEAM_LABEL} AS name FROM teams t LEFT JOIN teams p ON p.id = t.parent_id JOIN leader_teams lt ON lt.team_id = t.id WHERE lt.user_id = ?`).all(l.id);
      const rows = db.prepare(`SELECT a.*, ${TEAM_LABEL} AS team_name, c.name AS city FROM applications a
                  JOIN teams t ON t.id = a.team_id LEFT JOIN teams p ON p.id = t.parent_id JOIN cities c ON c.id = a.city_id
                  WHERE a.status IN ('listo','contactado','visito') AND a.city_id IN (SELECT city_id FROM user_cities WHERE user_id = ?)`).all(l.id);
      for (const team of myTeams) {
        const mine = rows.filter((r) => r.team_id === team.id);
        if (!mine.length) continue;
        const nuevas = mine.filter((r) => prevRun && iso(r.created_at) > prevRun);
        const seguimiento = mine.filter((r) => !nuevas.includes(r) && r.followup_at && r.followup_at <= inDays(1));
        const resto = mine.filter((r) => !nuevas.includes(r) && !seguimiento.includes(r));
        const msg = emails.leaderDigestEmail({ team, nuevas: nuevas.map((r) => forTemplate(r)), seguimiento: seguimiento.map((r) => forTemplate(r)), resto: resto.map((r) => forTemplate(r)) });
        if (msg.enabled === false) continue;
        await mail.sendMail({ to: l.email, ...msg }).then(() => sent++).catch((e) => console.error('Resumen líder:', e.message));
      }
    }
    setSetting('digest_prev_run', now());
    return sent;
  }

  return { process, retryReceived, retryNotes, refreshCourses, sendDigests };
}

module.exports = { createFlow, fullApp, FOLLOWUP_DAYS, OPEN, inDays, now, noteTexts, forTemplate };
