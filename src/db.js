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
  name TEXT NOT NULL UNIQUE,
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
  role TEXT NOT NULL CHECK (role IN ('admin','leader','bases')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  bases_user_id INTEGER REFERENCES users(id),
  bases_status TEXT NOT NULL DEFAULT 'sin_contactar',
  followup_at TEXT,
  ready_at TEXT,
  note_synced INTEGER NOT NULL DEFAULT 0,
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
