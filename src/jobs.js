const config = require('./config');
const { db, getSetting, setSetting } = require('./db');
const { joinEs } = require('./courses');

/** Devuelve el identificador de la semana local (año + número ISO), para no repetir un envío dentro de la misma semana. */
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

const DEFAULT_SLOTS = [{ day: 0, hour: 22 }, { day: 4, hour: 8 }]; // domingo 22:00 y jueves 8:00

/** Los envíos configurados por esa ciudad, o domingo 22:00 y jueves 8:00 por defecto. Siempre al menos uno. */
function digestSchedule(cityId) {
  const raw = getSetting(`digest_schedule:${cityId}`);
  if (!raw) return DEFAULT_SLOTS;
  try {
    const slots = JSON.parse(raw).filter((s) => Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 && Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23);
    return slots.length ? slots : DEFAULT_SLOTS;
  } catch {
    return DEFAULT_SLOTS;
  }
}

function setDigestSchedule(cityId, slots) {
  setSetting(`digest_schedule:${cityId}`, JSON.stringify(slots));
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** Texto legible del horario configurado (para mostrarlo en el panel), p. ej. «domingo a las 22:00 y jueves a las 8:00». */
function describeSchedule(slots = digestSchedule()) {
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  if (slots.every((s) => s.hour === slots[0].hour)) return `${joinEs(slots.map((s) => DAY_NAMES[s.day]))} a las ${hh(slots[0].hour)}`;
  return joinEs(slots.map((s) => `${DAY_NAMES[s.day]} a las ${hh(s.hour)}`));
}

/** ¿Toca enviar el resumen ahora en esa ciudad? Cada franja (día + hora) se envía como mucho una vez por semana. */
function dueSlot(cityId, d = new Date()) {
  const { day, hour } = localDayHour(d);
  const week = weekKey(d);
  const fired = new Set(JSON.parse(getSetting(`digest_fired:${cityId}`) || '{}')[week] || []);
  return digestSchedule(cityId).find((s) => s.day === day && hour >= s.hour && !fired.has(`${s.day}-${s.hour}`)) || null;
}

function markSlotFired(cityId, slot, d = new Date()) {
  const week = weekKey(d);
  const all = JSON.parse(getSetting(`digest_fired:${cityId}`) || '{}');
  // Solo se conserva la semana actual: al cambiar de semana, las franjas anteriores dejan de contar solas.
  const fired = new Set(all[week] || []);
  fired.add(`${slot.day}-${slot.hour}`);
  setSetting(`digest_fired:${cityId}`, JSON.stringify({ [week]: [...fired] }));
}

function start(flow) {
  const guard = (name, fn) => () => fn().catch((e) => console.error(`Tarea ${name}:`, e.message));
  const tick = guard('reintentos', async () => {
    await flow.retryReceived();
    await flow.retryNotes();
  });
  const hourly = guard('resumen', async () => {
    const cities = db.prepare('SELECT id FROM cities').all();
    const due = cities.map((c) => ({ city: c, slot: dueSlot(c.id) })).filter((x) => x.slot);
    if (!due.length) return;
    await flow.refreshCourses(); // una sola vez para todas las ciudades que tocan ahora
    for (const { city, slot } of due) {
      markSlotFired(city.id, slot); // primero marcar: si falla algo, no se duplica el envío
      const sent = await flow.sendDigestsForCity(city.id);
      console.log(`Resumen ciudad ${city.id} (día ${slot.day}, ${slot.hour}:00): ${sent} emails`);
    }
  });
  setInterval(tick, 5 * 60 * 1000).unref();
  setInterval(hourly, 15 * 60 * 1000).unref();
  setTimeout(tick, 15000).unref();
  setTimeout(hourly, 30000).unref();
}

module.exports = { start, weekKey, dueSlot, digestSchedule, setDigestSchedule, describeSchedule, markSlotFired, DEFAULT_SLOTS };
