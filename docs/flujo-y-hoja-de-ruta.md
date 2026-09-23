# Únete al equipo · Flujo, procesos y hoja de ruta

Web: **equipos.iglesiahillsong.com** · Panel: **equipos.iglesiahillsong.com/panel**

## 1. Quién es quién
| Figura | Qué hace |
|---|---|
| **Persona** | Se apunta a servir en un equipo. |
| **Líder de equipo** | Ve las solicitudes de su equipo y ciudad en su lista programada y en el panel, tenga o no completados Bases 1, Bases 2 y GC. Llama, invita a visitar el equipo el domingo y hace seguimiento. |
| **Administración** | Da de alta ciudades, equipos y líderes; edita los emails; vigila el sistema. |

## 2. Flujo, paso a paso
1. **La persona se apunta** en la web: nombre, email, teléfono, ciudad, equipo, cuánto tiempo lleva en la iglesia, y si tiene Bases 1, GC y Bases 2.
2. **Tiempo mínimo.** Si el equipo lo exige (Kids 12 meses, Cuidado Pastoral 24) y no llega, recibe un email explicándolo y no se avisa a nadie más.
3. **Se busca en Planning Center** por email y teléfono (con desempate por nombre si hay duplicados) y se leen sus cursos: Bases 1, Bases 2 (sesiones 1 y 2) y GC.
   - Lo que la persona **declara** en el formulario cuenta como hecho aunque no conste en Planning Center.
   - **Sin ficha en Planning Center = como si no tuviera nada** (se trata igual, y el líder lo ve marcado en «Contrastado con PCO»).
4. **Notas en su perfil de Planning Center** (categoría «Interesado en servir»): interés en servir en el equipo y, si procede, lo que dijo tener y no consta.
5. **Email inmediato a la persona:** lo que consta (o que no se encontró su ficha), lo que le falta si acaso, y que el líder de su equipo la contactará esta semana. El líder **no** recibe un email por cada solicitud — ya no hay bloqueo ni reparto previo por voluntarios de Bases o GC, pero tampoco aviso inmediato: la solicitud queda visible en el panel y llega en su próxima lista programada.
   - Si el equipo y la ciudad no tienen ningún líder asignado, se avisa a administración (si no, nadie se enteraría hasta la próxima lista, que tampoco se envía porque no hay a quién).
6. **Lista completa por email**, dos veces por semana (lunes y jueves a las 8:00 por defecto, configurable desde el panel): a cada líder, toda su lista abierta en tres partes — nuevas desde el último envío, a quien toca hacer seguimiento (pasados 7 días sin novedad) y el resto, con los datos, cursos (Bases 1, Bases 2, GC) y si está **contrastado con Planning Center** de cada persona. Antes de cada envío se actualizan los cursos con Planning Center. Es la única vía por email para el líder — junto con el panel, donde ve su lista al día en todo momento.

## 3. «Contrastado con Planning Center»
Columna del panel y del email al líder que dice si lo que consta cuadra con Planning Center:
- **Sí:** hay ficha en Planning Center y no hay ninguna contradicción entre lo declarado y lo que consta.
- **No, sin ficha:** no se ha encontrado a la persona en Planning Center. Se aconseja preguntarle si hay algún fallo (un email o teléfono distinto al que usó) o si aún no se ha registrado.
- **No, con mezcla:** la persona dice tener algo (p. ej. Bases 2) que no consta en Planning Center. Se aconseja contactar con el equipo de PCO del campus para revisar si falta registrar algo.

Además, si a la persona le falta de verdad algo (ni Planning Center ni ella misma lo dan por hecho), se añade un recordatorio junto a esa misma columna: *«Recuerda que es importante que haga el paso que le falta antes de empezar a servir»* (o «los pasos», si le falta más de uno). Aparece aunque esté contrastado con Planning Center («Sí»), porque contrastado y completo son cosas distintas.

## 4. Proceso del líder de equipo
Recibe su lista completa dos veces por semana (con los cursos y el contraste con PCO de cada persona) y siempre puede consultarla al día en el panel. No recibe un email por cada solicitud nueva.
1. **Esta semana:** llama e invita a visitar el equipo el **próximo domingo** → **Llamé**.
2. **Domingo:** lo recibe y le enseña el equipo → **Visitó**.
3. **La semana siguiente:** segunda llamada para consolidar.
4. **Resolver** (queda anotado en su perfil de Planning Center) o **No continúa**.
5. Puede **borrar** solicitudes de su equipo y ciudad.

## 5. Administración
Alta de ciudades, equipos (áreas y subequipos, fotos, mínimos de meses, avisos) y líderes (nombre, email, teléfono, ciudades y equipos a su cargo); puede **editar y borrar** líderes (incluido su email) y **borrar equipos** (al borrar un área se borran también sus subequipos; no deja borrar uno con solicitudes registradas, para eso hay que ocultarlo o borrarlas antes); pestaña **Emails** (editar textos, vista previa, prueba, días y horas de la lista completa); ve el líder asignado a cada persona; exporta CSV (con la columna «Contrastado con PCO» y el motivo si no).

## 6. Hoja de ruta
| Fase | Qué | Quién | Estado |
|---|---|---|---|
| 1 | Web, formulario, panel, emails, lista programada al líder, editor de emails | Desarrollo | ✅ hecho y desplegado |
| 2 | Alta de líderes (ciudad, equipo, teléfono) | Administración | ⏳ pendiente |
| 3 | Prueba completa con una ficha de prueba de Planning Center (con y sin ficha, con y sin mezcla) | Desarrollo + administración | ⏳ pendiente |
| 4 | Lanzamiento suave: una ciudad y 2-3 equipos durante una semana | Todos | ⏳ pendiente |
| 5 | Dirección pública (redirección `hillsong.es/unetealequipo`, QR, iPad) | Web / comunicación | ⏳ pendiente (esa dirección ya existe como «Acuerdo Voluntariado») |
| 6 | Formación de 15 minutos a líderes | Coordinación | ⏳ pendiente |
| 7 | Copias de seguridad automáticas y despliegue automático (webhook) | Desarrollo | ⏳ pendiente |
| 8 | Mejoras opcionales: recomprobación diaria, modo iPad | Desarrollo | 💡 propuestas |

## 7. Límites conocidos
- La actualización de cursos en Planning Center (enlazar fichas nuevas, refrescar Bases 1/2 y GC) ocurre **antes de cada lista completa** (lunes y jueves), no al instante.
- El aviso de seguimiento a los 7 días viaja en la lista completa y puede llegar algunos días tarde; el panel muestra la fecha exacta.
- La app **no escribe** los cursos (Bases 1/2, GC) en Planning Center: eso sigue haciéndose como hasta ahora. Los botones del panel son para el seguimiento.
- La contraseña de acceso es común (cada persona entra con su email). No debe escribirse en documentos compartidos.
