const { db } = require('./db');

/**
 * Modelo: un ÁREA (tarjeta de la web) contiene SUBEQUIPOS (lo que se elige al apuntarse).
 * Un área sin subequipos activos se comporta como un equipo en sí misma.
 * Alias de SQL: t = equipo elegible, p = su área.
 */
const SELECTABLE = `(t.active = 1 AND (
  (t.parent_id IS NOT NULL AND p.active = 1)
  OR (t.parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM teams c WHERE c.parent_id = t.id AND c.active = 1))))`;

/** «Área › Subequipo», o solo el nombre si coinciden (Kids › Kids) o no hay área. */
const TEAM_LABEL = `(CASE WHEN p.id IS NULL OR p.name = t.name THEN t.name ELSE p.name || ' › ' || t.name END)`;

let cityIdsStmt;
/** Ciudades donde se puede elegir este equipo. Vacío = disponible en todas. */
const cityIdsOf = (teamId) => {
  cityIdsStmt ||= db.prepare('SELECT city_id FROM team_cities WHERE team_id = ?');
  return cityIdsStmt.all(teamId).map((r) => r.city_id);
};

const pick = (t, area) => ({ id: t.id, name: t.name, description: t.description, min_months: t.min_months, notice: t.notice, area_notice: area && area.id !== t.id ? area.notice : '', city_ids: cityIdsOf(t.id) });

/** Árbol para la web pública: áreas activas con sus subequipos activos. */
function publicTree() {
  const areas = db.prepare('SELECT * FROM teams WHERE parent_id IS NULL AND active = 1 ORDER BY sort, name').all();
  const kids = db.prepare('SELECT * FROM teams WHERE parent_id IS NOT NULL AND active = 1 ORDER BY sort, name').all();
  return areas.map((a) => {
    const children = kids.filter((k) => k.parent_id === a.id);
    return {
      id: a.id, name: a.name, description: a.description, icon: a.icon, image_url: a.image_url, image_pos: a.image_pos, notice: a.notice,
      teams: children.length ? children.map((c) => pick(c, a)) : [pick(a)],
    };
  });
}

/** ¿Se puede elegir este equipo en el formulario? Si tiene ciudades restringidas, además debe incluir cityId. */
function findSelectable(id, cityId) {
  const t = db.prepare(`SELECT t.* FROM teams t LEFT JOIN teams p ON p.id = t.parent_id WHERE t.id = ? AND ${SELECTABLE}`).get(id);
  if (!t) return t; // undefined: no encontrado (igual que antes)
  const cities = cityIdsOf(id);
  if (cities.length && !cities.includes(cityId)) return undefined; // no disponible en esa ciudad
  return t;
}

module.exports = { SELECTABLE, TEAM_LABEL, publicTree, findSelectable };
