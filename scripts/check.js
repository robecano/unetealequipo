// Diagnóstico de solo lectura contra Planning Center: `npm run check [email] [teléfono]`
const config = require('../src/config');
const pco = require('../src/pco');

(async () => {
  console.log('Campos configurados:', config.fields, '\nValores exigidos:', config.required);
  const [email, phone] = process.argv.slice(2);
  if (!email && !phone) return console.log('Añade un email o teléfono para probar la búsqueda de una persona.');
  const person = await pco.findPerson({ email, phone, name: '' });
  if (!person) return console.log('No se encontró ninguna persona.');
  console.log('Persona:', person.id, person.name, person.url);
  console.log('Cursos:', await pco.getCourseStatus(person.id, { fields: config.fields, required: config.required }));
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
