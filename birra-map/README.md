# 🍺 BirraMap v2

Webapp + app móvil (PWA) serverless para ver **dónde está la peña, qué beben y cuántas llevan**, con rondas, deudas, mapa de calor y modo evento.

Stack: **Azure Static Web Apps (Free) + Azure Functions + Table Storage**. Coste real: céntimos al mes.

---

## ⚠️ Lo que falló en tu deploy y cómo queda arreglado

**Error 1 — Oryx buscaba un script `build`:**
```
Error: Could not find either 'build' or 'build:azure' node under 'scripts' in package.json
```
Pasaba porque el workflow que se ejecutó tenía `app_location: "/"` (mira el log: *App Directory Location: '/' was found*), así que Oryx intentó construir la raíz como si fuera una app de Node. Ahora hay dos cinturones:
1. El workflow apunta a `/public` y lleva `skip_app_build: true`.
2. Hay un `package.json` en la raíz **con script `build`** que no hace nada. Aunque alguien vuelva a poner `app_location: "/"`, no revienta.

**Error 2 — tenías dos workflows.** Al crear la SWA con `--login-with-github`, Azure te generó su propio `.github/workflows/azure-static-web-apps-XXXX.yml`. Ese es el que se ejecutó (job "Build and Deploy Job"). **Borra el suyo y quédate solo con el de este repo**, o si prefieres el suyo, edítale las tres líneas de `app_location`, `api_location` y `skip_app_build`.

**Error 3 — el nombre de la variable.** En tu portal pone `STORE_CONNECTION_STRING` y el código pedía `STORAGE_CONNECTION_STRING`. Ahora acepta los dos, así que no tienes que tocar nada. Lo que **sí te falta** son `PURGE_KEY` y `RETENTION_DAYS`.

---

## ✅ Pasos exactos que te quedan

1. **Sustituye el repo** por el contenido de este zip (conserva tu `.git`).
2. **Borra el workflow duplicado**:
   ```bash
   ls .github/workflows/
   git rm .github/workflows/azure-static-web-apps-*.yml
   ```
   (deja solo `azure-static-web-apps.yml`)
3. **Añade las dos variables que faltan** en *Static Web App → Environment variables → Add*:
   | Nombre | Valor |
   |---|---|
   | `PURGE_KEY` | una cadena aleatoria tuya |
   | `RETENTION_DAYS` | `180` |

   O por CLI en una línea:
   ```bash
   az staticwebapp appsettings set -n birramap -g rg-birramap --setting-names PURGE_KEY="$(openssl rand -hex 16)" RETENTION_DAYS="180"
   ```
4. **Comprueba que la Storage Account tiene Tables habilitado** (viene por defecto en StorageV2) y que la connection string de la variable es la de esa cuenta.
5. **Push y a mirar Actions**:
   ```bash
   npm test && git add -A && git commit -m "BirraMap v2" && git push
   ```
   El workflow corre los tests antes de desplegar: si algo se rompe, no sube nada roto.
6. **Habilita el login** que quieras usar. GitHub y AAD funcionan de serie en el plan Free sin configurar nada.

---

## 🧪 Tests

```bash
npm test              # 138 comprobaciones
node tests/simulacion.js   # simula una noche entera de 5 colegas
```

Los tests **no necesitan Azure**: hay un Table Storage en memoria (`BIRRAMAP_FAKE_STORE=1`) que imita el real, incluido el orden de las RowKey y los filtros OData. Cubren lógica pura, la API de punta a punta, permisos entre grupos, concurrencia, los ficheros de despliegue y el frontend.

La simulación pilló un bug real: dos fichajes en el mismo milisegundo (lo que pasa al repartir una ronda) chocaban en la RowKey. Arreglado con sufijo aleatorio y con test de regresión de 500 escrituras simultáneas.

---

## 🆕 Novedades de la v2

### 🤝 Rondas — "invito yo"
Botón azul en el mapa. Coge tu GPS, busca quién del grupo está **a menos de 500 m**, te los marca ya seleccionados y con un toque pagas la ronda: se le suma una consumición a cada uno y queda registrada la deuda.

### 💸 Deuda de rondas
Pestaña propia. Calcula **quién debe cuántas a quién ya compensado**: si tú le pusiste 3 y él a ti 1, debes 1 y punto. Arriba un contador con tu saldo y abajo el *balance de generosidad* (a cuánta gente has invitado vs. cuánta te ha invitado). El balance del grupo **siempre suma cero**, hay test que lo verifica.

### 🔔 Notificaciones de proximidad
Se activa en Perfil. Cuando alguien ficha **a menos de 500 m de ti**, salta el aviso con el bar y la distancia. Usa el service worker, así que llega también con la PWA en segundo plano.

### 🎪 Modo evento
Creas "Oktoberfest 2026" con fecha de inicio y fin, y el ranking se puede filtrar por ese evento: clasificación cerrada del finde, independiente del ranking normal. Cuando el evento está en curso aparece una chapa arriba.

### 🔥 Mapa de calor
Página con heatmap real (leaflet.heat) del último año, alternable entre **el grupo** y **solo yo**, más el ranking de bares más pisados con visitas, copas y cuánta gente distinta ha pasado. Tocas un bar y el mapa vuela ahí.

### 🏠 Vuelta a casa
Botón "He llegado a casa". Sales del mapa y al grupo le sale un aviso verde de que llegaste bien. Si vuelves a fichar, reapareces.

**Además**: la app ya no es monopágina. Hay navegación inferior con Mapa · Ranking · Deudas · Calor · Perfil, cada una con su URL (`#/deudas`, `#/heat`…), así puedes compartir enlaces directos.

---

## Arquitectura

```
Móvil / navegador ──► Static Web App (Free)
                       ├── /public   front (HTML + JS + Leaflet, PWA instalable)
                       ├── /.auth/*  login GitHub / Microsoft integrado
                       └── /api/*    Azure Functions (Node 20)
                                      └── Table Storage
                                           ├── members   userId → nick, grupo, estado
                                           ├── checkins  grupo → consumiciones
                                           ├── rounds    grupo → rondas pagadas
                                           └── events    grupo → eventos
```

### Endpoints
| Método | Ruta | Qué hace |
|---|---|---|
| GET/POST | `/api/me` | perfil, alta en grupo |
| GET | `/api/checkins?hours=12` | activos + estadísticas + quién está en casa |
| POST/DELETE | `/api/checkin` | fichar / cerrar la noche |
| GET/POST | `/api/round` | rondas |
| GET | `/api/debts?days=90` | deudas compensadas y balance |
| GET | `/api/nearby?lat&lon&radius` | quién está a tiro |
| GET | `/api/ranking?period=\|eventId=` | clasificación |
| GET/POST/DELETE | `/api/events` | modo evento |
| GET | `/api/heatmap?days&scope` | puntos calientes + top bares |
| GET/POST | `/api/home` | he llegado a casa |
| POST | `/api/purge` | limpieza por retención (cabecera `x-purge-key`) |

### Variables de entorno
| Nombre | Obligatoria | Por defecto |
|---|---|---|
| `STORAGE_CONNECTION_STRING` o `STORE_CONNECTION_STRING` | sí | — |
| `PURGE_KEY` | para la limpieza | — |
| `RETENTION_DAYS` | no | 180 |
| `CHECKIN_COOLDOWN_MS` | no | 30000 |
| `ROUND_COOLDOWN_MS` | no | 60000 |

---

## Local

```bash
npm i -g @azure/static-web-apps-cli
cd api && npm install && cd ..
npm start      # swa start public --api-location api
```
El SWA CLI simula el login en `http://localhost:4280/.auth/login/github`.

## App móvil

Es **PWA instalable**: abres la URL en el móvil, "Añadir a pantalla de inicio" y listo. Icono, pantalla completa y avisos. Si algún día quieres publicarla en las stores:
```bash
npm i -D @capacitor/cli && npx cap init BirraMap com.tunombre.birramap --web-dir=public
npx cap add android && npx cap add ios && npx cap sync
```
Ojo: en nativo el `fetch` a `/api` deja de ser relativo, tendrás que poner la URL completa de la SWA y activar CORS.

## Limpieza

```bash
curl -X POST https://TU-SWA.azurestaticapps.net/api/purge -H "x-purge-key: TU_KEY"
```
Bórralo con el timer que ya tienes montado para el lol-hub.

## Ideas para la v3
- **Modo resaca**: resumen del día siguiente con lo que hiciste y cuánto te gastaste.
- **Precio por consumición** y gasto real de la noche por persona.
- **Fotos** de la ronda que caduquen a las 24 h.
- **Retos**: "5 bares distintos en una noche", con insignias.
