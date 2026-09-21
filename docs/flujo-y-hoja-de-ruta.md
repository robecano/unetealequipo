# Únete al equipo · Flujo, procesos y hoja de ruta

Web: **equipos.iglesiahillsong.com** · Panel: **equipos.iglesiahillsong.com/panel**

## 1. Quién es quién
| Figura | Qué hace |
|---|---|
| **Persona** | Se apunta a servir en un equipo. |
| **Voluntario de Bases** | Llama a quien le falta Bases 1 o Bases 2 para invitarle a apuntarse (hillsong.es/bases) y contarle cómo funciona. |
| **Voluntario de GC** | Llama a quien ya tiene Bases 1 y le falta un Grupo de Conexión: le explica la importancia de los GC, qué son y cómo funcionan, y le invita a apuntarse (hillsong.es/gc). |
| **Líder de equipo** | Llama a quien lo tiene todo, le invita a visitar el equipo el domingo y le hace seguimiento. |
| **Administración** | Da de alta ciudades, equipos, líderes y voluntarios; edita los emails; vigila el sistema. |

## 2. Flujo, paso a paso
1. **La persona se apunta** en la web (o con un voluntario, en un iPad): nombre, email, teléfono, ciudad, equipo, cuánto tiempo lleva en la iglesia, y si tiene Bases 1, GC y Bases 2.
2. **Tiempo mínimo.** Si el equipo lo exige (Kids 12 meses, Cuidado Pastoral 24) y no llega, recibe un email explicándolo y no se avisa a nadie más.
3. **Se busca en Planning Center** por email y teléfono (con desempate por nombre si hay duplicados) y se leen sus cursos: Bases 1, Bases 2 (sesiones 1 y 2) y GC.
   - Lo que la persona **declara** en el formulario cuenta como hecho aunque no conste (se marca con ⚠ "dato sin verificar").
   - **Sin ficha en Planning Center = como si no tuviera nada.**
4. **Notas en su perfil de Planning Center** (categoría «Interesado en servir»): interés en servir en el equipo y, si procede, lo que dijo tener y no consta.
5. **Reparto** (cada voluntario es de la ciudad de la persona; entre varios, se reparte de forma equilibrada):

   | Bases 1 | Bases 2 | GC | Voluntario de Bases | Voluntario de GC | Líder de equipo |
   |:-:|:-:|:-:|:-:|:-:|:-:|
   | ✗ | ✗ | ✗ | ✔ | | listado opcional |
   | ✔ | ✗ | ✗ | ✔ | ✔ | listado opcional |
   | ✔ | ✗ | ✔ | ✔ | | listado opcional |
   | ✔ | ✔ | ✗ | | ✔ | listado opcional |
   | ✔ | ✔ | ✔ | | | **aviso inmediato** |

6. **Emails inmediatos:** a la persona (siempre), a los voluntarios que le toquen y, si lo tiene todo, al líder.
7. **Cada semana** (lunes 8:00, configurable): resumen a líderes y voluntarios, y recomprobación en Planning Center.

## 3. Procesos por figura
### Voluntario de Bases
Recibe: email inmediato + lista semanal («posible seguimiento»). Panel: *Posible seguimiento (Bases)*.
1. Llama, da la bienvenida, cuenta cómo funciona Bases (horarios, agenda) e invita a apuntarse en hillsong.es/bases.
2. **Contactado** → cuando se apunta: **Ya está apuntado en Bases**.
3. Sale de su lista cuando: rellena el formulario de Bases *después* de apuntarse a servir, completa Bases, o él/ella lo **quita a mano** (*Quitar de mi lista*).
4. Si la persona ya había rellenado el formulario antes y no la llamaron, aparece con «⚠ Ya rellenó el formulario de Bases anteriormente pero no fue contactado» y se queda hasta quitarla a mano.

### Voluntario de GC
Recibe: email inmediato + lista semanal. Panel: *Posible seguimiento (GC)*.
1. Llama, explica la importancia de los GC, qué son y cómo funcionan, e invita a apuntarse en hillsong.es/gc.
2. **Contactado** → **Ya está en un GC**. Sale de la lista al detectarse en Planning Center que ya está en un GC, o al quitarla a mano.

### Líder de equipo
Recibe: aviso inmediato (solo con los tres cursos) + resumen semanal con tres listados: *llamar*, *seguimiento* y un listado **opcional** de quienes aún no lo tienen todo (indica qué le falta y qué voluntarios también les contactarán).
1. **Esta semana:** llama e invita a visitar el equipo el **próximo domingo** → **Llamé**.
2. **Domingo:** lo recibe y le enseña el equipo → **Visitó**.
3. **La semana siguiente:** segunda llamada para consolidar.
4. **Confirmar** (queda anotado en su perfil de Planning Center) o **No continúa**.
5. Puede **quitar del listado** a quien aún no lo tiene todo y **borrar** solicitudes.

### Administración
Alta de ciudades, equipos (áreas y subequipos, fotos, mínimos de meses, avisos), líderes y voluntarios (con teléfono); pestaña **Emails** (editar textos, vista previa, prueba, horario del resumen); ve el líder asignado a cada persona; exporta CSV.

## 4. Hoja de ruta
| Fase | Qué | Quién | Estado |
|---|---|---|---|
| 1 | Web, formulario, panel, emails, reparto por cuadrante, editor de emails | Desarrollo | ✅ hecho y desplegado |
| 2 | Alta de líderes y voluntarios (ciudad, equipo, teléfono) | Administración | ⏳ pendiente |
| 3 | Prueba completa con una ficha de prueba de Planning Center (las 5 combinaciones) | Desarrollo + administración | ⏳ pendiente |
| 4 | Lanzamiento suave: una ciudad y 2-3 equipos durante una semana | Todos | ⏳ pendiente |
| 5 | Dirección pública (redirección `hillsong.es/unetealequipo`, QR, iPad) | Web / comunicación | ⏳ pendiente (esa dirección ya existe como «Acuerdo Voluntariado») |
| 6 | Formación de 15 minutos a líderes y voluntarios | Coordinación | ⏳ pendiente |
| 7 | Copias de seguridad automáticas y despliegue automático (webhook) | Desarrollo | ⏳ pendiente |
| 8 | Mejoras opcionales: recomprobación diaria, aviso diario de seguimiento, modo iPad, teléfono del voluntario en el email | Desarrollo | 💡 propuestas |

## 5. Límites conocidos
- La recomprobación en Planning Center (salir de listas, enlazar fichas nuevas, promover a «Para llamar») es **semanal**, no instantánea.
- El aviso de seguimiento a los 7 días viaja en el resumen semanal y puede llegar algunos días tarde; el panel muestra la fecha exacta.
- La app **no escribe** los cursos (Bases 1/2, GC) en Planning Center: eso sigue haciéndose como hasta ahora. Los botones del panel son para el seguimiento.
- La contraseña de acceso es común (cada persona entra con su email). No debe escribirse en documentos compartidos.
