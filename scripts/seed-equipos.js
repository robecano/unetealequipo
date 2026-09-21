// Carga las 12 áreas y sus subequipos. Es idempotente: crea lo que falta y NO pisa lo que ya editaste en el panel.
//   node scripts/seed-equipos.js [--ciudades]     (--ciudades añade Madrid, Barcelona y Valencia)
const { db } = require('../src/db');

const KIDS_NOTE = 'Este equipo requiere una entrevista larga antes de empezar. Te contactaremos para explicarte el proceso.';
// Aviso de las áreas donde el servicio consiste en ayudar a organizar y gestionar (no en la actividad en sí)
const ORGANIZA_NOTE = 'El servicio en esta área sería ayudando en el equipo de organización y gestión de las actividades y eventos.';
const PASTORAL_NOTE = 'Requiere una entrevista y acompañamiento previo del equipo pastoral.';

// [nombre, descripción, [subequipos: nombre, descripción, meses mínimos, aviso]]
const AREAS = [
  { name: 'Domingo', image: '/img/areas/domingo.jpg', icon: '⛪', desc: 'Equipos que hacen posible cada reunión de domingo.', teams: [
    ['Eventos', 'Organización y coordinación de los domingos y eventos especiales.'],
    ['Mantenimiento', 'Cuidado y mantenimiento de instalaciones y espacios.'],
    ['Recursos', 'Venta de merchandising, libros y recursos de la iglesia.'] ] },
  { name: 'Locales', image: '/img/areas/locales.jpg', icon: '🏛️', desc: 'Equipos que cuidan los espacios y la operativa de los domingos.', teams: [
    ['Ujieres', 'Bienvenida, orientación y atención en el auditorio.'],
    ['Excelencia', 'Limpieza, orden y excelencia en cada detalle.'],
    ['Seguridad', 'Vela por la seguridad y el bienestar de cada persona que asiste a nuestras reuniones.'],
    ['Primeros Auxilios', 'Primera atención ante incidencias sanitarias.'],
    ['Logística', 'Transporte de materiales y recursos para las reuniones.'],
    ['Cafetería', 'Sirve café y comida, creando un espacio acogedor para conectar.'],
    ['Guardarropa', 'Custodia de prendas y pertenencias, disponible solo en algunos campus.'] ] },
  { name: 'Creativos', image: '/img/areas/creativos.jpg', icon: '🎨', desc: 'Equipos que comunican y expresan creativamente la visión de la iglesia.', teams: [
    ['Comunicaciones', 'Redes sociales, diseño, vídeo y fotografía que reflejan la vida de la iglesia.'],
    ['Diseño Creativo', 'Diseño visual de espacios de bienvenida, campañas y proyectos especiales.'],
    ['Alabanza', 'Voces y músicos que lideran a la iglesia en adoración.'],
    ['Producción', 'Sonido, iluminación, vídeo, televisión, escenario y producción técnica.'],
    ['Baile', 'Danza para eventos y producciones especiales.'] ] },
  { name: 'Conexiones', image: '/img/areas/conexiones.jpg', icon: '🤝', desc: 'Ayuda a cada persona a sentirse bienvenida y encontrar su siguiente paso.', teams: [
    ['Nuevas Personas', 'Bienvenida y conexión de cada persona nueva.'],
    ['Interpretación', 'Interpretación de las reuniones a otros idiomas.'],
    ['Punto de Información', 'Información y orientación sobre la vida de la iglesia.'],
    ['Bienvenido a Casa', 'Acompañamiento de quienes toman la decisión de seguir a Jesús.'] ] },
  { name: 'Kids', image: '/img/areas/kids.jpg', icon: '🧒', desc: 'Comunidad para niños de 0 a 12 años, con reuniones cada domingo.', teams: [
    ['Sala de Familias', 'Espacio para bebés de 0 a 2 años junto a sus padres.', 12, KIDS_NOTE],
    ['Kids', 'Comunidad para niños de 3 a 8 años.', 12, KIDS_NOTE],
    ['Voltage', 'Comunidad para niños de 8 a 12 años.', 12, KIDS_NOTE] ] },
  { name: 'Comunidades', notice: ORGANIZA_NOTE, image: '/img/areas/comunidades.jpg', icon: '👥', desc: 'Espacios para conectar, pertenecer y crecer juntos entre semana.', teams: [
    ['Grupos de Conexión', 'Comunidad, estudio y crecimiento en grupos pequeños.'],
    ['Faith Mission Partner', 'Comunidad de personas generosas que impulsan la misión de la iglesia.'],
    ['Empresarios', 'Comunidad para empresarios, emprendedores, autónomos, profesionales y directivos.'],
    ['Men', 'Comunidad de hombres.'],
    ['+30', 'Comunidad para personas solteras mayores de 30 años.'],
    ['Generación +', 'Comunidad para personas mayores de 60 años.'] ] },
  { name: 'Sisterhood', notice: ORGANIZA_NOTE, image: '/img/areas/sisterhood.jpg', icon: '🌸', desc: 'Comunidad de mujeres de todas las generaciones.', teams: [
    ['Comunidad Sisterhood', 'Actividades y espacios de conexión dentro de la comunidad de mujeres.'],
    ['Madres Unidas para Orar', 'Madres que oran juntas por sus hijos y sus familias.'] ] },
  { name: 'Jóvenes', notice: ORGANIZA_NOTE, image: '/img/areas/jovenes.jpg', icon: '⚡', desc: 'Comunidades para adolescentes y jóvenes, incluyendo Grupos de Conexión y eventos.', teams: [
    ['Youth', 'Comunidad para adolescentes de 12 a 18 años.'],
    ['PowerHouse', 'Comunidad para jóvenes de 18 a 30 años.'] ] },
  { name: 'Cuidado Pastoral', image: '/img/areas/cuidado-pastoral.jpg', icon: '💛', desc: 'Acompañamiento espiritual en diferentes momentos de la vida.', teams: [
    ['Visitación', 'Acompañamiento a personas que necesitan cuidado especial.', 24, PASTORAL_NOTE],
    ['Prematrimonial', 'Preparación y formación antes del matrimonio.', 24, PASTORAL_NOTE],
    ['Ceremonias', 'Acompañamiento en bodas y otras ceremonias.', 24, PASTORAL_NOTE],
    ['Intercesión', 'Oración entre semana por personas y necesidades específicas.', 24, PASTORAL_NOTE] ] },
  { name: 'CityCare', notice: ORGANIZA_NOTE, image: '/img/areas/citycare.jpg', icon: '🏙️', desc: 'Engloba la acción social de nuestra iglesia.', teams: [
    ['Ayuda Integral', 'Apoyo práctico y seguimiento a familias en dificultad, incluyendo Kilo de Amor.'],
    ['Refuerzo Escolar', 'Apoyo educativo para niños.'],
    ['KitCat', 'Cursos de catalán e integración social y cultural.'],
    ['Invade las Calles', 'Ayuda y acompañamiento a personas sin hogar.'],
    ['Soñamos Juntos', 'Experiencias especiales para niños en situaciones difíciles.'],
    ['Campañas Especiales', 'Acciones solidarias ante necesidades concretas, como Vuelta al Cole, Navidad o situaciones de emergencia.'] ] },
  { name: 'Formaciones', image: '/img/areas/formaciones.jpg', icon: '📖', desc: 'Espacios para crecer en Biblia, fe y liderazgo.', teams: [
    ['Academia de Liderazgo', 'Formación teológica, ministerial y de liderazgo durante seis meses.'],
    ['Bases', 'Cursos gratuitos, los domingos o sábados, sobre fundamentos de fe, iglesia y próximos pasos.'],
    ['Escuela de Tarde', 'Cursos bíblicos y teológicos en profundidad cada dos martes, solo en algunos campus.'],
    ['Estudios de Grupos de Conexión', 'Creación de estudios bíblicos para los Grupos de Conexión.'] ] },
  { name: 'IT', image: '/img/areas/it.jpg', icon: '💻', desc: 'Tecnología y herramientas digitales para la vida de la iglesia.', teams: [
    ['Sistemas Informáticos', 'Soporte y gestión de sistemas tecnológicos.'],
    ['Web', 'Desarrollo y mantenimiento de páginas web.'],
    ['Formularios y Registros', 'Formularios, inscripciones y procesos digitales.'],
    ['Bases de Datos en Planning Center', 'Gestión de personas, datos y procesos.'] ] },
];

function seed({ cities = false } = {}) {
  const findArea = db.prepare('SELECT id FROM teams WHERE parent_id IS NULL AND name = ?');
  const findSub = db.prepare('SELECT id FROM teams WHERE parent_id = ? AND name = ?');
  const insArea = db.prepare('INSERT INTO teams (name, description, icon, image_url, notice, sort) VALUES (?,?,?,?,?,?)');
  const insSub = db.prepare('INSERT INTO teams (parent_id, name, description, min_months, notice, sort) VALUES (?,?,?,?,?,?)');
  let created = 0;
  AREAS.forEach((a, i) => {
    let area = findArea.get(a.name);
    if (!area) { area = { id: Number(insArea.run(a.name, a.desc, a.icon, a.image || '', a.notice || '', i + 1).lastInsertRowid) }; created++; }
    else {
      // Solo rellena lo que está vacío: no pisa lo que se haya editado en el panel
      if (a.image) db.prepare("UPDATE teams SET image_url = ? WHERE id = ? AND image_url = ''").run(a.image, area.id);
      if (a.notice) db.prepare("UPDATE teams SET notice = ? WHERE id = ? AND notice = ''").run(a.notice, area.id);
    }
    a.teams.forEach(([name, desc, months = 0, notice = ''], j) => {
      if (!findSub.get(area.id, name)) { insSub.run(area.id, name, desc, months, notice, j + 1); created++; }
    });
  });
  if (cities) for (const c of ['Madrid', 'Barcelona', 'Valencia']) db.prepare('INSERT OR IGNORE INTO cities (name) VALUES (?)').run(c);
  return created;
}

if (require.main === module) {
  const n = seed({ cities: process.argv.includes('--ciudades') });
  console.log(`Áreas y subequipos creados: ${n}`);
}
module.exports = { seed, AREAS };
