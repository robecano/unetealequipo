# Únete al equipo — equipos.hillsongspain.com

Escaparate de los equipos de Hillsong España y formulario para apuntarse a servir, conectado a Planning Center (PCO).

## Flujo
1. La persona rellena el formulario (nombre, email, teléfono, ciudad, equipo, tiempo en la iglesia, Bases 1 / Bases 2 / GC).
2. Si no llega al mínimo de antigüedad del equipo (p. ej. Kids, Cuidado Pastoral) → email explicativo; no se avisa al líder.
3. Se busca en PCO por email y teléfono (coincidencia y desduplicado). Si no existe → email para registrarse en Bases 1.
4. Se leen los campos **Bases 1**, **Bases 2** y **GC Asignado** de PCO (si la persona dice «Sí» y en PCO no consta, se cree el formulario: se avisa al líder con la marca «dato sin verificar» y queda anotado en la nota de PCO) y se escribe la nota «Interesado en servir en X».
5. **Tiene Bases 1 y 2** → email al líder (llamar esta semana, invitar el domingo); seguimiento a los 7 días.
   **Falta Bases 2** → se asigna un voluntario de Bases de su ciudad (reparto equilibrado), email a la persona con lo que le falta y el líder lo ve en «pendientes».
6. Cada semana (por defecto lunes 8:00) resumen por email a líderes y voluntarios de Bases, y se vuelve a comprobar en PCO a los pendientes: si ya tienen Bases 2 pasan a «para llamar».

## Panel (`/panel`)
Acceso por email + contraseña común (`PANEL_PASSWORD`). Roles: **admin**, **líder** (sus equipos y ciudades) y **voluntario de Bases** (sus ciudades). El admin gestiona equipos, ciudades y personas.

## Desarrollo
```bash
npm install
cp .env.example .env   # rellenar; SEED_DEMO=1 crea equipos y ciudades de ejemplo
npm test
npm start
```
Despliegue: ver `deploy/COOLIFY.md`.
