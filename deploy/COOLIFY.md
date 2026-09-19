# Despliegue en Coolify (VPS 76.13.150.244)

Igual que `seguimiento-llamadas`: Coolify construye el `Dockerfile` y Traefik (ya instalado) genera el HTTPS.

## 1. DNS (Hostinger)
En la zona DNS de `hillsongspain.com` crea un registro:

| Tipo | Nombre | Apunta a | TTL |
|------|--------|----------|-----|
| A    | `equipos` | `76.13.150.244` | 300 |

## 2. Aplicación en Coolify
1. Proyecto → **New Resource → Public/Private Repository** → `robecano/unetealequipo`, rama `main`.
2. **Build pack**: Dockerfile · **Puerto**: 3000 · **Dominio**: `https://equipos.hillsongspain.com`.
3. **Health check**: `/healthz`.
4. **Almacenamiento persistente**: volumen montado en `/app/data` (base de datos SQLite). Sin él se pierden los datos en cada despliegue.
5. **Variables de entorno** (solo en Coolify, nunca en Git): copia `.env.example` y rellena
   `PCO_APP_ID`, `PCO_SECRET`, `SESSION_SECRET`, `PANEL_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SMTP_*`, `MAIL_FROM`, `NODE_ENV=production`, `APP_URL=https://equipos.hillsongspain.com`.
6. Despliega. Al primer arranque se crea el administrador con `ADMIN_EMAIL`.

## 3. Despliegue automático
En GitHub → Settings → Webhooks, añade el webhook de Coolify (aplicación → Webhooks → GitHub) para redesplegar en cada push a `main`.
