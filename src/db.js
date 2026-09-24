const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  min_months INTEGER NOT NULL DEFAULT 0,
  notice TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','city_admin','leader','bases','gc')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  phone TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS user_cities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, city_id)
);
CREATE TABLE IF NOT EXISTS leader_teams (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, team_id)
);
-- Ciudades donde se puede elegir un equipo. Sin filas = disponible en todas (para no tener que marcar los que ya existían).
CREATE TABLE IF NOT EXISTS team_cities (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, city_id)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  tenure_months INTEGER NOT NULL DEFAULT 0,
  self_bases1 INTEGER NOT NULL DEFAULT 0,
  self_bases2 INTEGER NOT NULL DEFAULT 0,
  self_gc INTEGER NOT NULL DEFAULT 0,
  pco_person_id TEXT,
  pco_bases1 INTEGER,
  pco_bases2 INTEGER,
  pco_gc INTEGER,
  status TEXT NOT NULL DEFAULT 'recibida',
  followup_at TEXT,
  ready_at TEXT,
  note_synced INTEGER NOT NULL DEFAULT 0,
  notes_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bases_contacted_at TEXT,
  gc_contacted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_app_email ON applications(email);
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id INTEGER,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// Migración: las bases anteriores tenían teams sin parent_id y con nombre único global.
// Un área («Kids») y un subequipo («Kids») pueden llamarse igual, así que se reconstruye la tabla.
if (!db.prepare("SELECT 1 FROM pragma_table_info('teams') WHERE name = 'parent_id'").get()) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE teams_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES teams_new(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      min_months INTEGER NOT NULL DEFAULT 0,
      notice TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO teams_new (id, name, description, icon, image_url, min_months, notice, active, sort)
      SELECT id, name, description, icon, image_url, min_months, notice, active, sort FROM teams;
    DROP TABLE teams;
    ALTER TABLE teams_new RENAME TO teams;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_team_name ON teams (COALESCE(parent_id, 0), name)');

try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''"); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE applications ADD COLUMN notes_done INTEGER NOT NULL DEFAULT 0'); } catch { /* ya existe */ }
// Enfoque vertical de la foto del área en su ventana (0 = arriba, 100 = abajo), para que no se corten las caras.
try { db.exec('ALTER TABLE teams ADD COLUMN image_pos INTEGER NOT NULL DEFAULT 30'); } catch { /* ya existe */ }

/**
 * Migración: se vuelve a permitir el rol «bases» y «gc» (líder de Bases y líder de GC, uno por ciudad, que
 * llaman a quien le falte ese paso). El CHECK de `users` no se puede alterar: se reconstruye si hace falta
 * (bases de datos que se quedaron con el CHECK antiguo, solo admin/leader). No toca ningún dato.
 */
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
if (!/'bases'/.test(usersSql)) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin','city_admin','leader','bases','gc')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      phone TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users_new SELECT * FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}

/**
 * Migración: se añade el rol «city_admin» (administración de una ciudad). El CHECK no se puede ampliar con
 * ALTER, así que se reconstruye si hace falta (bases que se quedaron en admin/leader/bases/gc). No toca datos.
 */
const usersSql2 = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
if (!/'city_admin'/.test(usersSql2)) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin','city_admin','leader','bases','gc')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      phone TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users_new SELECT * FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}

/**
 * Migración: se retira el reparto entre voluntarios de Bases y de GC. El líder de equipo recibe ahora aviso
 * inmediato de todas las solicitudes de su equipo, tenga o no completados Bases 1, Bases 2 y GC.
 */
const appCols = db.prepare("SELECT name FROM pragma_table_info('applications')").all().map((c) => c.name);
if (appCols.includes('bases_user_id')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE applications_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      city_id INTEGER NOT NULL REFERENCES cities(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      tenure_months INTEGER NOT NULL DEFAULT 0,
      self_bases1 INTEGER NOT NULL DEFAULT 0,
      self_bases2 INTEGER NOT NULL DEFAULT 0,
      self_gc INTEGER NOT NULL DEFAULT 0,
      pco_person_id TEXT,
      pco_bases1 INTEGER,
      pco_bases2 INTEGER,
      pco_gc INTEGER,
      status TEXT NOT NULL DEFAULT 'recibida',
      followup_at TEXT,
      ready_at TEXT,
      note_synced INTEGER NOT NULL DEFAULT 0,
      notes_done INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO applications_new (id, created_at, name, email, phone, city_id, team_id, tenure_months, self_bases1, self_bases2, self_gc,
      pco_person_id, pco_bases1, pco_bases2, pco_gc, status, followup_at, ready_at, note_synced, notes_done, error, updated_at)
      SELECT id, created_at, name, email, phone, city_id, team_id, tenure_months, self_bases1, self_bases2, self_gc,
      pco_person_id, pco_bases1, pco_bases2, pco_gc,
      CASE WHEN status IN ('pendiente_bases','sin_pco') THEN 'listo' ELSE status END,
      followup_at, ready_at, note_synced, notes_done, error, updated_at FROM applications;
    DROP TABLE applications;
    ALTER TABLE applications_new RENAME TO applications;
    CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_app_email ON applications(email);
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}

// Cuándo llamó el líder de Bases o el de GC (null = aún no): así el líder de equipo ve si ya le han contactado.
try { db.exec('ALTER TABLE applications ADD COLUMN bases_contacted_at TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE applications ADD COLUMN gc_contacted_at TEXT'); } catch { /* ya existe */ }
// Nombre real del Grupo de Conexión en Planning Center (si se encuentra), y borrado blando (para poder deshacerlo).
try { db.exec('ALTER TABLE applications ADD COLUMN gc_group_name TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE applications ADD COLUMN deleted_at TEXT'); } catch { /* ya existe */ }

// El área «Domingo» (o «Operativo», si ya se había renombrado a mano en el panel) pasa a llamarse «Operativos».
db.exec("UPDATE teams SET name = 'Operativos' WHERE parent_id IS NULL AND name IN ('Domingo', 'Operativo')");

// Textos de los emails editados desde el panel, uno por ciudad. Si no hay fila para esa ciudad, se usa el texto original del código.
db.exec(`CREATE TABLE IF NOT EXISTS email_templates (
  key TEXT NOT NULL,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (key, city_id)
)`);
/**
 * Migración: los emails pasan de un único texto global a uno por ciudad. Lo que ya estuviera editado se
 * copia a todas las ciudades existentes (así cada una empieza igual que estaba, sin perder nada) y a partir
 * de ahí cada ciudad puede divergir. No se borra ninguna personalización previa.
 */
const etCols = db.prepare("SELECT name FROM pragma_table_info('email_templates')").all().map((c) => c.name);
if (etCols.length && !etCols.includes('city_id')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE email_templates_new (
      key TEXT NOT NULL,
      city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      heading TEXT NOT NULL,
      body TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (key, city_id)
    );
    INSERT INTO email_templates_new (key, city_id, subject, heading, body, enabled, updated_at, updated_by)
      SELECT e.key, c.id,
        CASE WHEN e.key = 'leader_digest' THEN REPLACE(e.subject, '{{equipo}}', '{{ciudad}}') ELSE e.subject END,
        CASE WHEN e.key = 'leader_digest' THEN REPLACE(e.heading, '{{equipo}}', '{{ciudad}}') ELSE e.heading END,
        CASE WHEN e.key = 'leader_digest' THEN REPLACE(e.body, '{{equipo}}', '{{ciudad}}') ELSE e.body END,
        e.enabled, e.updated_at, e.updated_by
      FROM email_templates e, cities c;
    DROP TABLE email_templates;
    ALTER TABLE email_templates_new RENAME TO email_templates;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}
// Las plantillas retiradas (bases_assigned, gc_assigned, applicant_no_pco, applicant_missing, applicant_ready,
// leader_notice) no se usan aunque el admin las hubiera editado antes; se limpian para no confundir en el panel.
// bases_digest y gc_digest se reutilizan (misma idea: la lista del líder de Bases o de GC), así que no se tocan.
db.exec(`DELETE FROM email_templates WHERE key IN ('bases_assigned','gc_assigned','applicant_no_pco','applicant_missing','applicant_ready','leader_notice')`);

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

/**
 * Migración: el horario de envío de la lista completa pasa de ser único y global a configurable por ciudad.
 * Si ya había un horario global (`digest_schedule`) se copia a cada ciudad existente (`digest_schedule:<id>`),
 * así cada una sigue enviando en el mismo horario que tenía hasta ahora; a partir de ahí puede divergir.
 * Lo mismo con `digest_fired` (para no repetir un envío ya hecho esa semana). No se borra nada sin copiarlo antes.
 */
const globalSchedule = getSetting('digest_schedule');
if (globalSchedule !== null) {
  for (const c of db.prepare('SELECT id FROM cities').all()) {
    if (getSetting(`digest_schedule:${c.id}`) === null) setSetting(`digest_schedule:${c.id}`, globalSchedule);
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run('digest_schedule');
}
const globalFired = getSetting('digest_fired');
if (globalFired !== null) {
  for (const c of db.prepare('SELECT id FROM cities').all()) {
    if (getSetting(`digest_fired:${c.id}`) === null) setSetting(`digest_fired:${c.id}`, globalFired);
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run('digest_fired');
}
// Igual con `digest_prev_run` (qué es «nuevo desde el último envío»): se copia para que el primer envío tras
// esta migración no trate de golpe a todo el mundo como nuevo.
const globalPrevRun = getSetting('digest_prev_run');
if (globalPrevRun !== null) {
  for (const c of db.prepare('SELECT id FROM cities').all()) {
    if (getSetting(`digest_prev_run:${c.id}`) === null) setSetting(`digest_prev_run:${c.id}`, globalPrevRun);
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run('digest_prev_run');
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function logEvent(applicationId, userId, event, detail = '') {
  db.prepare('INSERT INTO application_events (application_id, user_id, event, detail) VALUES (?,?,?,?)').run(applicationId, userId ?? null, event, detail);
}

module.exports = { db, tx, getSetting, setSetting, logEvent };
