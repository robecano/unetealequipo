# Únete al equipo — equipos.hillsongspain.com

Escaparate de los equipos de Hillsong España y formulario para apuntarse a servir, conectado a Planning Center (PCO).

## Flujo
1. La persona rellena el formulario (nombre, email, teléfono, ciudad, equipo, tiempo en la iglesia, Bases 1 / GC / Bases 2).
2. Si no llega al mínimo de antigüedad del equipo (p. ej. Kids, Cuidado Pastoral) → email explicativo; no se avisa al líder.
3. Se busca en PCO por email y teléfono (coincidencia y desduplicado). **Quien no está en Planning Center se trata como si no tuviera nada** (ni Bases 1, ni Bases 2, ni GC).
4. Se leen los campos **Bases 1**, **Bases 2** y **GC Asignado** de PCO. Lo que la persona dice tener en el formulario cuenta como hecho aunque en PCO no conste; si hay diferencia, se deja una nota aparte en su perfil de PCO («La persona dice haber hecho Bases 2, pero no consta en Planning Center…») y se escribe la nota «Interesado en servir en X».
5. **Aviso inmediato a la persona:** lo que consta (o que no se encontró su ficha), lo que le falta si acaso, y que el líder de su equipo la contactará esta semana. Si dice tener algo que PCO no confirma, se le avisa que pase por el punto de información el domingo (solo si sí tiene ficha). **El líder no recibe un email por cada solicitud** — ya no hay reparto previo por voluntarios de Bases o GC ni bloqueo alguno, pero tampoco aviso inmediato: la ve en el panel y en su próxima lista programada.
   - Si no hay ningún líder asignado a ese equipo y ciudad, se avisa a administración.
6. **Lista completa por email, dos veces por semana** (por defecto domingo a las 22:00 y jueves a las 8:00, configurable desde el panel), a cada líder: toda su lista abierta, separada en nuevas desde el último envío, a quien toca hacer seguimiento (pasados 7 días) y el resto, con sus datos, sus cursos y si está **contrastado con Planning Center** (ver más abajo) de cada persona. Antes de cada envío se actualiza en Planning Center a quien no tenía ficha o le faltaba algo. Es la única vía por email para el líder, junto con el panel (siempre al día).

## «Contrastado con Planning Center»
Columna del panel y del email al líder:
- **Sí:** hay ficha en PCO y no hay contradicción entre lo declarado y lo que consta.
- **No, sin ficha:** no se encontró a la persona en PCO. Se aconseja preguntarle si hay algún fallo (email/teléfono distinto) o si aún no se ha registrado.
- **No, con mezcla:** dice tener algo que no consta en PCO. Se aconseja contactar con el equipo de PCO del campus para revisarlo.

## Equipos: áreas y subequipos
La web muestra **12 áreas** (tarjetas cuadradas con foto o emoji); al pulsar una se abre un desplegable con sus **subequipos**, cada uno con su descripción y su botón «Quiero unirme». En el formulario se elige un subequipo. Los líderes se asignan a subequipos. Un área sin subequipos se comporta como un equipo. `node scripts/seed-equipos.js [--ciudades]` carga el listado completo (idempotente, no pisa lo editado).

## Emails
Todos los textos se editan en **Panel → Emails** (solo admin): asunto, título y cuerpo con marcadores (`{{nombre}}`, `{{equipo}}`, `{{seccion_nuevas}}`…), condicionales (`{{#encontrado}}…{{/encontrado}}`), vista previa, email de prueba a tu correo y «Restaurar el original». No deja guardar un email al que le falte información imprescindible o con marcadores inexistentes. Los originales están en `src/email-templates.js`. Los días y horas de la lista completa también se cambian ahí (varias franjas, p. ej. lunes y jueves).

Envíos: a la persona al procesar el formulario (inmediato, reintento cada 5 min si Planning Center falla) y la lista completa al líder en las franjas configuradas (hora de `APP_TZ`; un planificador interno lo comprueba cada 15 min y no repite un envío ya hecho esa semana).

## Panel (`/panel`)
Acceso por email + contraseña común (`PANEL_PASSWORD`). Roles: **admin** y **líder de equipo** (ve y toca solo las solicitudes de sus equipos y ciudades). El admin gestiona ciudades, equipos y líderes (alta, edición y borrado, con teléfono). Cada equipo lleva un **emoji** o una **imagen** (se sube desde el panel, PNG/JPG/WebP hasta 3 MB, y se guarda en `/app/data/uploads`); si hay imagen se muestra la imagen.

Cada solicitud tiene **Borrar** (administración y líderes, solo dentro de lo suyo) y la lista se puede **exportar a CSV** con el estado y la búsqueda que estés viendo (separador `;`, UTF-8 con BOM para Excel, fechas en hora local, incluye «Contrastado con PCO» y el motivo si no).

## Desarrollo
```bash
npm install
cp .env.example .env   # rellenar; SEED_DEMO=1 crea equipos y ciudades de ejemplo
npm test
npm start
```
Despliegue: ver `deploy/COOLIFY.md`.
