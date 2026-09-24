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
  console.log('Bases 1 / Bases 2:', await pco.getCourseStatus(person.id, { fields: config.fields, required: config.required }));
  console.log('GC (según Planning Center Groups, no el checkbox):', await pco.getGcInfo(person.id));
  console.log('Formularios enviados:', await pco.getFormStatus(person.id));
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
