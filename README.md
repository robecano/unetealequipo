# Únete al equipo — equipos.hillsongspain.com

Escaparate de los equipos de Hillsong España y formulario para apuntarse a servir, conectado a Planning Center (PCO).

## Flujo
1. La persona rellena el formulario (nombre, email, teléfono, ciudad, equipo, tiempo en la iglesia, Bases 1 / GC / Bases 2).
2. Si no llega al mínimo de antigüedad del equipo (p. ej. Kids, Cuidado Pastoral) → email explicativo; no se avisa al líder.
3. Se busca en PCO por email y teléfono (coincidencia y desduplicado). **Quien no está en Planning Center se trata como si no tuviera nada** (ni Bases 1, ni Bases 2, ni GC).
4. Se leen los campos **Bases 1**, **Bases 2** y **GC Asignado** de PCO. Lo que la persona dice tener en el formulario cuenta como hecho aunque en PCO no conste; si hay diferencia, se deja una nota aparte en su perfil de PCO («La persona dice haber hecho Bases 2, pero no consta en Planning Center…») y se escribe la nota «Interesado en servir en X».
5. **Aviso inmediato a la persona:** lo que consta (o que no se encontró su ficha), lo que le falta si acaso, y que se la contactará esta semana. Si dice tener algo que PCO no confirma, se le avisa que pase por el punto de información el domingo (solo si sí tiene ficha). **Nadie recibe un email por cada solicitud** (ni seguimiento de Equipos, ni de Bases, ni de GC): cada uno la ve en el panel y en su próxima lista programada.
   - Si la ciudad no tiene a nadie de seguimiento de Equipos, o de Bases/GC cuando le toca, se avisa a administración.
6. **Reparto entre seguimiento de Equipos, de Bases y de GC** (los tres, por ciudad — no por equipo). Seguimiento de Equipos ve siempre a todos los de su ciudad, de cualquier equipo (con lo autodeclarado contando como hecho, igual que en el resto del sistema). En paralelo, seguimiento de Bases ve a quien le falte Bases 1 o Bases 2 **según Planning Center**; seguimiento de GC, a quien ya tenga Bases 1 (autodeclarado cuenta) y le falte el GC según Planning Center. Esto incluye a quien lo autodeclaró pero Planning Center todavía no lo confirma: en ese caso ven el aviso de actualizar el dato en Planning Center en vez de pedirle que haga el curso.
7. **Lista completa por email, dos veces por semana** (por defecto domingo a las 22:00 y jueves a las 8:00, configurable desde el panel por ciudad — cada ciudad puede tener su propio horario), a cada uno de seguimiento de Equipos, de Bases y de GC (por ciudad): su lista abierta, separada en nuevas desde el último envío, a quien toca hacer seguimiento (pasados 7 días) y el resto, con sus datos, sus cursos y si está **OK con Planning Center** (ver más abajo) de cada persona. Antes de cada envío se actualiza en Planning Center a quien no tenía ficha o le faltaba algo. Es la única vía por email — junto con el panel (siempre al día).

## «OK con Planning Center»
Columna del panel y del email:
- **Sí:** hay ficha en PCO y no hay contradicción entre lo declarado y lo que consta.
- **No, sin ficha:** no se encontró a la persona en PCO. Se aconseja preguntarle si hay algún fallo (email/teléfono distinto) o si aún no se ha registrado.
- **No, con mezcla:** dice tener algo que no consta en PCO. Se aconseja contactar con el equipo de PCO del campus para revisarlo.

## Equipos: áreas y subequipos
La web muestra **12 áreas** (tarjetas cuadradas con foto o emoji); al pulsar una se abre un desplegable con sus **subequipos**, cada uno con su descripción y su botón «Quiero unirme». En el formulario se elige un subequipo. Los líderes se asignan a subequipos. Un área sin subequipos se comporta como un equipo. `node scripts/seed-equipos.js [--ciudades]` carga el listado completo (idempotente, no pisa lo editado).

Cada subequipo (o área sin subequipos) puede **restringirse a una o varias ciudades** desde su editor en el panel; sin ninguna marcada, está disponible en todas (así no hace falta tocar los que ya existían). Tanto el escaparate de la web (con su propio selector de ciudad) como el desplegable «Equipo» del formulario solo muestran lo disponible en la ciudad elegida; el servidor también lo comprueba al recibir el formulario.

## Emails
El texto de cada email es **uno por ciudad**: se edita en **Panel → Emails** (administración total o de ciudad), con un selector de ciudad arriba — el admin total puede elegir cualquiera; el de ciudad, solo la suya. Cada plantilla tiene asunto, título y cuerpo con marcadores (`{{nombre}}`, `{{ciudad}}`, `{{seccion_nuevas}}`…), condicionales (`{{#encontrado}}…{{/encontrado}}`), vista previa, email de prueba a tu correo y «Restaurar el original» (vuelve al texto de fábrica de esa ciudad). No deja guardar un email al que le falte información imprescindible o con marcadores inexistentes. Los originales están en `src/email-templates.js`. Los días y horas de la lista completa también son **por ciudad** (mismo selector arriba): el admin total cambia el horario de cualquier ciudad; el de ciudad, solo el de la suya.

Envíos: a la persona al procesar el formulario (inmediato, reintento cada 5 min si Planning Center falla) y la lista completa a cada uno de seguimiento en las franjas configuradas (hora de `APP_TZ`; un planificador interno lo comprueba cada 15 min y no repite un envío ya hecho esa semana).

## Panel (`/panel`)
Acceso por email + contraseña común (`PANEL_PASSWORD`, salvo el admin total, que usa `ADMIN_PASSWORD`). Roles:
- **Admin total**: ve y gestiona todo, sin restricción — ciudades, equipos, usuarios, y emails (texto y horario) de cualquier ciudad.
- **Admin de ciudad**: como el admin total pero limitado a su ciudad — ve y toca las solicitudes de su ciudad; gestiona equipos (cualquier campo, pero en «ciudades donde se puede elegir» solo puede marcar o quitar la suya, las demás quedan como estaban); da de alta y gestiona seguimiento de Equipos/Bases/GC de su ciudad (nunca a otro admin); edita los emails de su propia ciudad, texto y horario. No puede crear ni editar ciudades.
- **Seguimiento de Equipos**: ve y toca todas las solicitudes de su ciudad (de cualquier equipo), tengan o no completados los cursos. Puede deshacer el último cambio de estado, y deshacer un borrado justo después de hacerlo.
- **Seguimiento de Bases** y **seguimiento de GC**: uno o varios por ciudad, ven de cualquier equipo a quien de verdad les toca, según Planning Center — solo lectura y comentarios, el estado y el borrado los llevan administración y seguimiento de Equipos; en vez de «OK con PCO» ven una columna «Qué le falta» curso a curso, con el aviso de actualizar Planning Center si es un caso autodeclarado sin confirmar. Cada contacto que marcan queda registrado con su fecha (se ven todas, no solo la última) y se puede deshacer el más reciente.

Si Planning Center confirma que la persona pertenece a un Grupo de Conexión real (no solo el checkbox «GC Asignado»), su nombre se muestra en el panel junto a sus datos.

Cada equipo lleva un **emoji** o una **imagen** (se sube desde el panel, PNG/JPG/WebP hasta 3 MB, y se guarda en `/app/data/uploads`); si hay imagen se muestra la imagen. Todas las columnas de la tabla se pueden **ordenar** pulsando su cabecera (especialmente útil en «Equipo»). Cada solicitud lleva un enlace directo a su ficha de Planning Center cuando hay una.

Cada solicitud tiene **Borrar** (administración y seguimiento de Equipos, solo dentro de su ciudad) — es un borrado blando: se puede deshacer justo después con el aviso que aparece abajo — y la lista se puede **exportar a CSV** con el estado, la categoría y la búsqueda que estés viendo (separador `;`, UTF-8 con BOM para Excel, fechas en hora local, incluye «OK con PCO», el motivo si no, el Grupo de Conexión de Planning Center si tiene uno, y quién hace seguimiento de Equipos/Bases/GC de cada uno para administración). Administración dispone además de un filtro de **categoría** (falta Bases 1, falta Bases 2, falta GC, completo) tanto en el panel como en el CSV; «completo» cuenta lo autodeclarado igual que el resto del sistema.

## Desarrollo
```bash
npm install
cp .env.example .env   # rellenar; SEED_DEMO=1 crea equipos y ciudades de ejemplo
npm test
npm start
```
Despliegue: ver `deploy/COOLIFY.md`.
