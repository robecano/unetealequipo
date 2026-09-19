const config = require('./config');
const { getSetting, setSetting } = require('./db');

/** Devuelve el identificador de la semana local (año + número ISO) para no enviar el resumen dos veces. */
function weekKey(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((p) => [p.type, p.value]));
  const t = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t - yearStart) / 86400000 + 1) / 7)}`;
}

function localDayHour(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hour: Number(p.hour) };
}

const isDigestDue = (d = new Date()) => {
  const { day, hour } = localDayHour(d);
  return day === config.digestDay && hour >= config.digestHour && getSetting('digest_week') !== weekKey(d);
};

function start(flow) {
  const guard = (name, fn) => () => fn().catch((e) => console.error(`Tarea ${name}:`, e.message));
  const tick = guard('reintentos', async () => {
    await flow.retryReceived();
    await flow.retryNotes();
  });
  const hourly = guard('resumen semanal', async () => {
    if (!isDigestDue()) return;
    setSetting('digest_week', weekKey()); // primero marcar: si falla algo, no se duplican los emails
    const promoted = await flow.recheckPending();
    const sent = await flow.sendDigests();
    console.log(`Resumen semanal: ${promoted} pasan a "listo", ${sent} emails`);
  });
  setInterval(tick, 5 * 60 * 1000).unref();
  setInterval(hourly, 15 * 60 * 1000).unref();
  setTimeout(tick, 15000).unref();
  setTimeout(hourly, 30000).unref();
}

module.exports = { start, weekKey, isDigestDue };
