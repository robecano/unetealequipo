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
  role TEXT NOT NULL CHECK (role IN ('admin','leader')),
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
 * Migración: se retiran los roles «bases» y «gc» (ya no hay voluntarios aparte: todo pasa directo al líder de
 * equipo) y las columnas propias de aquel reparto. El CHECK de `users` no se puede alterar: se reconstruye.
 * Quien tuviera esos roles pasa a «leader» y queda desactivado (sin ciudades/equipos no verá nada, y el admin
 * puede reactivarlo y asignarle un equipo si de verdad debía ser líder).
 */
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
if (/'bases'|'gc'/.test(usersSql)) {
  const migrated = db.prepare("SELECT id, email, role FROM users WHERE role IN ('bases','gc')").all();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin','leader')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      phone TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users_new (id, email, name, role, active, created_at, phone)
      SELECT id, email, name, CASE WHEN role IN ('bases','gc') THEN 'leader' ELSE role END, CASE WHEN role IN ('bases','gc') THEN 0 ELSE active END, created_at, phone FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
  for (const u of migrated) console.warn(`Aviso: ${u.email} tenía el rol «${u.role}» (retirado); ahora es líder desactivado. Revísalo en el panel.`);
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

// Textos de los emails editados desde el panel. Si no hay fila, se usa el texto original del código.
db.exec(`CREATE TABLE IF NOT EXISTS email_templates (
  key TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT ''
)`);
// Las plantillas retiradas (bases_assigned, bases_digest, gc_assigned, gc_digest, applicant_no_pco, applicant_missing,
// applicant_ready, leader_notice) no se usan aunque el admin las hubiera editado antes; se limpian para no confundir en el panel.
db.exec(`DELETE FROM email_templates WHERE key IN ('bases_assigned','bases_digest','gc_assigned','gc_digest','applicant_no_pco','applicant_missing','applicant_ready','leader_notice')`);

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

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
