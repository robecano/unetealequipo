# Únete al equipo — equipos.hillsongspain.com

Escaparate de los equipos de Hillsong España y formulario para apuntarse a servir, conectado a Planning Center (PCO).

## Flujo
1. La persona rellena el formulario (nombre, email, teléfono, ciudad, equipo, tiempo en la iglesia, Bases 1 / Bases 2 / GC).
2. Si no llega al mínimo de antigüedad del equipo (p. ej. Kids, Cuidado Pastoral) → email explicativo; no se avisa al líder.
3. Se busca en PCO por email y teléfono (coincidencia y desduplicado). Si no existe → email para registrarse en Bases 1.
4. Se leen los campos **Bases 1**, **Bases 2** y **GC Asignado** de PCO (si la persona dice «Sí» y en PCO no consta, se cree el formulario: se avisa al líder con la marca «dato sin verificar» y se deja una nota aparte en su perfil de PCO: «La persona dice haber hecho Bases 2, pero no consta en Planning Center…») y se escribe la nota «Interesado en servir en X».
5. **Reparto entre líder y voluntarios** (lo que la persona dice tener en el formulario cuenta como hecho aunque en PCO no conste):

   | Bases 1 | Bases 2 | GC | Voluntario de Bases | Voluntario de GC | Líder |
   |:-:|:-:|:-:|:-:|:-:|:-:|
   | ✗ | ✗ | ✗ | ✔ | | |
   | ✔ | ✗ | ✗ | ✔ | ✔ | |
   | ✔ | ✗ | ✔ | ✔ | | |
   | ✔ | ✔ | ✗ | | ✔ | |
   | ✔ | ✔ | ✔ | | | ✔ |

   Los voluntarios reciben a quien ha solicitado servir y le falta algo como una **lista de posible seguimiento** (no hace falta que la persona lo tenga todo). Los voluntarios de **Bases** llaman a quien le falta algo de Bases para invitarle a apuntarse en `hillsong.es/bases`, y los de **GC** a quien le falta GC para invitarle en `hillsong.es/gc`. Los de Bases cuentan cómo funciona (horarios, agenda…) y los de GC explican la importancia de los Grupos de Conexión, qué son y cómo funcionan. Cada voluntario es de la ciudad de la persona (reparto equilibrado). Si no hay ninguno, se avisa al admin y no se le promete nada a la persona. **El líder solo recibe el aviso inmediato cuando la persona tiene Bases 1, Bases 2 y GC** (llamar esta semana, invitar el domingo); seguimiento a los 7 días. Si a alguien le falta algo, en su **resumen semanal** recibe un listado aparte y opcional con los interesados que aún no tienen Bases 1, Bases 2 o GC (o ni siquiera ficha en Planning Center), indicando qué le falta a cada uno.
6. Cada semana (por defecto lunes 8:00) resumen por email a líderes y voluntarios de Bases, y se vuelve a comprobar en PCO a los pendientes: si ya tienen Bases 2 pasan a «para llamar».

## Equipos: áreas y subequipos
La web muestra **12 áreas** (tarjetas cuadradas con foto o emoji); al pulsar una se abre un desplegable con sus **subequipos**, cada uno con su descripción y su botón «Quiero unirme». En el formulario se elige un subequipo. Los líderes se asignan a subequipos. Un área sin subequipos se comporta como un equipo. `node scripts/seed-equipos.js [--ciudades]` carga el listado completo (idempotente, no pisa lo editado).

## Emails
Todos los textos se editan en **Panel → Emails** (solo admin): asunto, título y cuerpo con marcadores (`{{nombre}}`, `{{equipo}}`, `{{persona}}`…), condicionales (`{{#gc}}…{{/gc}}`), vista previa, email de prueba a tu correo y «Restaurar el original». No deja guardar un email al que le falte información imprescindible o con marcadores inexistentes. Los originales están en `src/email-templates.js`. El día y la hora del resumen semanal también se cambian ahí.

Envíos: al procesar el formulario (inmediatos, reintento cada 5 min si Planning Center falla) y un resumen semanal (por defecto lunes 8:00, hora de `APP_TZ`; un planificador interno lo comprueba cada 15 min y lo envía una sola vez por semana).

## Panel (`/panel`) — solicitudes
Cada solicitud tiene **Borrar** (administración y líderes, solo dentro de lo suyo; los voluntarios de Bases no) y la lista se puede **exportar a CSV** con el estado y la búsqueda que estés viendo (separador `;`, UTF-8 con BOM para Excel, fechas en hora local). Líderes y voluntarios de Bases tienen **teléfono**, que el admin edita en «Líderes y Bases» y que se muestra en las solicitudes.

## Panel (`/panel`)
Acceso por email + contraseña común (`PANEL_PASSWORD`). Roles: **admin**, **líder** (sus equipos y ciudades) y **voluntario de Bases** (sus ciudades). El admin gestiona equipos, ciudades y personas. Cada equipo lleva un **emoji** o una **imagen** (se sube desde el panel, PNG/JPG/WebP hasta 3 MB, y se guarda en `/app/data/uploads`); si hay imagen se muestra la imagen.

## Desarrollo
```bash
npm install
cp .env.example .env   # rellenar; SEED_DEMO=1 crea equipos y ciudades de ejemplo
npm test
npm start
```
Despliegue: ver `deploy/COOLIFY.md`.
