// Datos de ejemplo para probar la web (SEED_DEMO=1 npm start). No usar en producción real.
const { db } = require('../src/db');
if (!db.prepare('SELECT COUNT(*) n FROM teams').get().n) {
  const ins = db.prepare('INSERT INTO teams (name,description,icon,min_months,notice,sort) VALUES (?,?,?,?,?,?)');
  [
    ['Alabanza', 'Músicos y voces que guían a la iglesia a la presencia de Dios cada domingo.', '🎶', 0, '', 1],
    ['Producción y AV', 'Sonido, iluminación, vídeo y pantallas: lo que hace posible cada servicio.', '🎛️', 0, '', 2],
    ['Bienvenida', 'Somos la primera sonrisa: recibimos y cuidamos a cada persona que llega.', '🤝', 0, '', 3],
    ['Kids', 'Enseñamos a los niños que Dios les ama, en un entorno seguro y divertido.', '🧒', 12, 'Este equipo requiere una entrevista larga antes de empezar.', 4],
    ['Cuidado Pastoral', 'Acompañamos, escuchamos y oramos por las personas de nuestra iglesia.', '💛', 24, 'Requiere entrevista y acompañamiento previo del equipo pastoral.', 5],
  ].forEach((t) => ins.run(...t));
  ['Madrid', 'Barcelona', 'Valencia'].forEach((c) => db.prepare('INSERT OR IGNORE INTO cities (name) VALUES (?)').run(c));
}
