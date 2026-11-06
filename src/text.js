/** Nombre para comparar: sin tildes, en minúsculas y con los espacios normalizados («María  García» = «maria garcia»). */
const normName = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = { normName };
