# Únete al equipo — equipos.hillsongspain.com

Escaparate de los equipos de Hillsong España y formulario para apuntarse a servir, conectado a Planning Center (PCO).

## Flujo
1. La persona rellena el formulario (nombre, email, teléfono, ciudad, equipo, tiempo en la iglesia, Bases 1 / GC / Bases 2).
2. Si no llega al mínimo de antigüedad del equipo (p. ej. Kids, Cuidado Pastoral) → email explicativo; no se avisa al líder.
3. Se busca en PCO por email y teléfono (coincidencia y desduplicado). **Quien no está en Planning Center se trata como si no tuviera nada** (ni Bases 1, ni Bases 2, ni GC).
4. Se leen los campos **Bases 1**, **Bases 2** y **GC Asignado** de PCO. Lo que la persona dice tener en el formulario cuenta como hecho aunque en PCO no conste; si hay diferencia, se deja una nota aparte en su perfil de PCO («La persona dice haber hecho Bases 2, pero no consta en Planning Center…») y se escribe la nota «Interesado en servir en X».
5. **Aviso inmediato a la persona:** lo que consta (o que no se encontró su ficha), lo que le falta si acaso, y que el líder de su equipo la contactará esta semana. Si dice tener algo que PCO no confirma, se le avisa que pase por el punto de información el domingo (solo si sí tiene ficha). **Nadie recibe un email por cada solicitud** (ni el líder de equipo, ni el de Bases, ni el de GC): cada uno la ve en el panel y en su próxima lista programada.
   - Si no hay líder de equipo para ese equipo y ciudad, o líder de Bases/GC para esa ciudad cuando le toca, se avisa a administración.
6. **Reparto entre el líder de equipo, el de Bases y el de GC.** El líder de equipo ve siempre a todos los de su equipo (con lo autodeclarado contando como hecho, igual que en el resto del sistema). En paralelo, el líder de Bases (uno por ciudad, para cualquier equipo) ve a quien le falte Bases 1 o Bases 2 **según Planning Center**; el líder de GC (también uno por ciudad), a quien ya tenga Bases 1 (autodeclarado cuenta) y le falte el GC según Planning Center. Esto incluye a quien lo autodeclaró pero Planning Center todavía no lo confirma: en ese caso ven el aviso de actualizar el dato en Planning Center en vez de pedirle que haga el curso.
7. **Lista completa por email, dos veces por semana** (por defecto domingo a las 22:00 y jueves a las 8:00, configurable desde el panel), a cada líder de equipo (por equipo), de Bases y de GC (por ciudad): su lista abierta, separada en nuevas desde el último envío, a quien toca hacer seguimiento (pasados 7 días) y el resto, con sus datos, sus cursos y si está **contrastado con Planning Center** (ver más abajo) de cada persona. Antes de cada envío se actualiza en Planning Center a quien no tenía ficha o le faltaba algo. Es la única vía por email — junto con el panel (siempre al día).

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
Acceso por email + contraseña común (`PANEL_PASSWORD`). Roles: **admin**; **líder de equipo** (ve y toca las solicitudes de sus equipos y ciudades); **líder de Bases** y **líder de GC** (uno por ciudad, ven de cualquier equipo a quien de verdad les toca, según Planning Center — solo lectura y comentarios, el estado y el borrado los lleva el líder de equipo; en vez de «Contrastado con PCO» ven una columna «Qué le falta» curso a curso, con el aviso de actualizar Planning Center si es un caso autodeclarado sin confirmar). El admin gestiona ciudades, equipos y líderes (alta, edición y borrado, con teléfono, y el rol de cada uno). Cada equipo lleva un **emoji** o una **imagen** (se sube desde el panel, PNG/JPG/WebP hasta 3 MB, y se guarda en `/app/data/uploads`); si hay imagen se muestra la imagen. Todas las columnas de la tabla se pueden **ordenar** pulsando su cabecera (especialmente útil en «Equipo»).

Cada solicitud tiene **Borrar** (administración y líderes de equipo, solo dentro de lo suyo) y la lista se puede **exportar a CSV** con el estado, la categoría y la búsqueda que estés viendo (separador `;`, UTF-8 con BOM para Excel, fechas en hora local, incluye «Contrastado con PCO», el motivo si no, y el líder de equipo/Bases/GC de cada uno para el admin). El admin dispone además de un filtro de **categoría** (falta Bases 1, falta Bases 2, falta GC, completo) tanto en el panel como en el CSV; «completo» cuenta lo autodeclarado igual que el resto del sistema.

## Desarrollo
```bash
npm install
cp .env.example .env   # rellenar; SEED_DEMO=1 crea equipos y ciudades de ejemplo
npm test
npm start
```
Despliegue: ver `deploy/COOLIFY.md`.
