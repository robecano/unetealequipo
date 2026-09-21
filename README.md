# Únete al equipo — equipos.hillsongspain.com

Escaparate de los equipos de Hillsong España y formulario para apuntarse a servir, conectado a Planning Center (PCO).

## Flujo
1. La persona rellena el formulario (nombre, email, teléfono, ciudad, equipo, tiempo en la iglesia, Bases 1 / Bases 2 / GC).
2. Si no llega al mínimo de antigüedad del equipo (p. ej. Kids, Cuidado Pastoral) → email explicativo; no se avisa al líder.
3. Se busca en PCO por email y teléfono (coincidencia y desduplicado). Si no existe → email para registrarse en Bases 1.
4. Se leen los campos **Bases 1**, **Bases 2** y **GC Asignado** de PCO (si la persona dice «Sí» y en PCO no consta, se cree el formulario: se avisa al líder con la marca «dato sin verificar» y se deja una nota aparte en su perfil de PCO: «La persona dice haber hecho Bases 2, pero no consta en Planning Center…») y se escribe la nota «Interesado en servir en X».
5. **Tiene Bases 1 y 2** → email al líder (llamar esta semana, invitar el domingo); seguimiento a los 7 días.
   **Falta Bases 2** → se asigna un voluntario de Bases de su ciudad (reparto equilibrado), email a la persona con lo que le falta y el líder lo ve en «pendientes».
6. Cada semana (por defecto lunes 8:00) resumen por email a líderes y voluntarios de Bases, y se vuelve a comprobar en PCO a los pendientes: si ya tienen Bases 2 pasan a «para llamar».

## Equipos: áreas y subequipos
La web muestra **12 áreas** (tarjetas cuadradas con foto o emoji); al pulsar una se abre un desplegable con sus **subequipos**, cada uno con su descripción y su botón «Quiero unirme». En el formulario se elige un subequipo. Los líderes se asignan a subequipos. Un área sin subequipos se comporta como un equipo. `node scripts/seed-equipos.js [--ciudades]` carga el listado completo (idempotente, no pisa lo editado).

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
