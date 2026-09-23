// Bases 1, Bases 2 y GC: lo que la persona declaró frente a lo que consta en Planning Center.
// Módulo aparte (sin depender de flow.js ni de emails.js) para que ambos lo puedan usar sin crear un ciclo.
const LABEL = { bases1: 'Bases 1', bases2: 'Bases 2', gc: 'GC' };
const KEYS = Object.keys(LABEL);

const joinEs = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a.at(-1)}`);

/** ¿Se acepta como hecho? Lo que dice Planning Center; si no hay ficha o no lo tiene, lo que declaró la persona. */
const accepted = (a, k) => !!a['pco_' + k] || !!a['self_' + k];

/** Cursos que la persona declaró tener y que Planning Center no confirma (aun así se aceptan). */
const mismatches = (a) => KEYS.filter((k) => a['self_' + k] && !a['pco_' + k]);

/** Cursos que a la persona le faltan de verdad (ni Planning Center ni ella misma los da por hechos). */
const missing = (a) => KEYS.filter((k) => !accepted(a, k));

/** Línea de texto plano «Bases 1: Sí · Bases 2: No · GC: Sí», con lo aceptado (Planning Center o autodeclarado). */
const courseLine = (a) => KEYS.map((k) => `${LABEL[k]}: ${accepted(a, k) ? 'Sí' : 'No'}`).join(' · ');

/** ¿Le toca al líder de Bases llamarla? Le falta Bases 1 o Bases 2 (con o sin GC: Bases siempre va primero). */
const needsBases = (a) => !accepted(a, 'bases1') || !accepted(a, 'bases2');

/** ¿Le toca al líder de GC llamarla? Ya tiene Bases 1 (mínimo para ofrecerle un GC) y le falta el GC. */
const needsGc = (a) => accepted(a, 'bases1') && !accepted(a, 'gc');

/** Recordatorio si de verdad le falta algo (independiente de si está contrastado con Planning Center o no). */
function reminderFor(a) {
  const falta = missing(a);
  if (!falta.length) return null;
  return `Recuerda que es importante que haga ${falta.length === 1 ? 'el paso que le falta' : 'los pasos que le faltan'} antes de empezar a servir.`;
}

/**
 * «Contrastado con PCO»: compara lo que dice la persona con lo que de verdad hay en Planning Center.
 * Si no aparece su ficha, puede ser un fallo de datos (email o teléfono distinto) o que aún no se haya
 * registrado. Si aparece pero declara tener algo que Planning Center no confirma, es el campus quien debe
 * corregir el registro. Además, si le falta algo de verdad (ni Planning Center ni ella misma lo dan por
 * hecho), se añade un recordatorio para el líder, esté o no contrastado con Planning Center.
 */
function contrastadoInfo(a) {
  const reminder = reminderFor(a);
  if (!a.pco_person_id) {
    return { ok: false, reason: 'sin_ficha', label: 'No', guidance: 'No encontramos su ficha en Planning Center. Pregúntale si hay algún fallo (por ejemplo, un email o teléfono distinto al que usó) o si aún no se ha registrado.', reminder };
  }
  const m = mismatches(a);
  if (m.length) {
    return { ok: false, reason: 'mismatch', label: 'No', mismatched: m.map((k) => LABEL[k]), guidance: `Dice tener ${joinEs(m.map((k) => LABEL[k]))}, pero no consta en Planning Center. Contacta con el equipo de PCO de tu campus para corregirlo.`, reminder };
  }
  return { ok: true, reason: 'ok', label: 'Sí', reminder };
}

module.exports = { LABEL, KEYS, joinEs, accepted, mismatches, missing, courseLine, needsBases, needsGc, contrastadoInfo };
