const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const list = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const int = (raw, fallback) => (Number.isInteger(Number(raw)) && String(raw).trim() !== '' ? Number(raw) : fallback);

const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || undefined,
  production: process.env.NODE_ENV === 'production',
  tz: process.env.APP_TZ || 'Europe/Madrid',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || '',
  dbPath: process.env.DB_PATH ? path.resolve(root, process.env.DB_PATH) : path.join(root, 'data', 'app.db'),
  // Imágenes de los equipos: junto a la base de datos, así se conservan entre despliegues (volumen /app/data)
  uploadsDir: path.join(path.dirname(process.env.DB_PATH ? path.resolve(root, process.env.DB_PATH) : path.join(root, 'data', 'app.db')), 'uploads'),
  panelPassword: process.env.PANEL_PASSWORD || '',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || '',
  digestDay: int(process.env.DIGEST_DAY, 1),
  digestHour: int(process.env.DIGEST_HOUR, 8),
  noteCategoryName: process.env.NOTE_CATEGORY_NAME || 'Interesado en servir',
  fields: {
    bases1: process.env.FIELD_BASES1 || 'Bases 1',
    bases2: process.env.FIELD_BASES2 || 'Bases 2',
    gc: process.env.FIELD_GC || 'GC Asignado',
  },
  required: {
    bases1: list(process.env.BASES1_REQUIRED),
    bases2: process.env.BASES2_REQUIRED === undefined ? ['Asistencia Sesión 1', 'Asistencia Sesión 2'] : list(process.env.BASES2_REQUIRED),
    gc: [],
  },
  urls: {
    // Bases y GC tienen una única página cada uno (hillsong.es/bases y hillsong.es/gc). BASES1_URL / BASES2_URL siguen aceptándose por compatibilidad.
    bases: process.env.BASES_URL || 'https://hillsong.es/bases',
    bases1: process.env.BASES1_URL || process.env.BASES_URL || 'https://hillsong.es/bases',
    bases2: process.env.BASES2_URL || process.env.BASES_URL || 'https://hillsong.es/bases',
    gc: process.env.GC_URL || 'https://hillsong.es/gc',
  },
  pco: {
    base: (process.env.PCO_BASE_URL || 'https://api.planningcenteronline.com').replace(/\/$/, ''),
    appId: process.env.PCO_APP_ID || '',
    secret: process.env.PCO_SECRET || '',
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Únete al equipo <equipos@hillsongspain.com>',
  },
};

module.exports = config;
