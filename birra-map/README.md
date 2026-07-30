# 🍺 BirraMap v3

Webapp + app móvil (PWA) serverless: **dónde está la peña, qué beben, cuántas llevan y cuánto se están gastando**.

Stack: **Azure Static Web Apps (Free) + Azure Functions + Table Storage**.

---

## 🔴 Por qué falló otra vez (y va en serio, esta es la buena)

Tu log dice esto:

```
App Directory Location: '/' was found.
Could not detect any platform in the source directory.
Failed to find a default file in the app artifacts folder (/). Valid default files: index.html
```

Traducido: **buscó `index.html` en la raíz del repo y no lo encontró.** Y no lo encontró porque en tu GitHub se ve esto:

```
birramap/
├── .github/workflows/
└── birra-map/          ← ¡esta carpeta sobra!
    ├── public/
    ├── api/
    └── ...
```

Al descomprimir el zip anterior se creó la carpeta `birra-map/` y subiste **todo un nivel por debajo**. Para Azure, `/public` no existe: lo que existe es `/birra-map/public`.

Además sigues teniendo **dos workflows**: el mío y el que generó Azure (`azure-static-web-apps-XXXX.yml`, el del commit *"ci: add Azure Static Web Apps workflow file"*). Se ejecuta el suyo, con `app_location: "/"`.

**Este zip ya viene con los ficheros en la raíz**, sin carpeta contenedora. Y hay 6 tests nuevos que fallan si la estructura se vuelve a torcer.

### Los pasos, exactos

```bash
cd birramap

# 1. Si aún tienes la carpeta birra-map/, esto la deshace sola
bash infra/arreglar-repo.sh

# 2. Borra el workflow que creó Azure (deja SOLO azure-static-web-apps.yml)
ls .github/workflows/
git rm .github/workflows/azure-static-web-apps-*.yml

# 3. Comprueba y sube
npm test
git add -A && git commit -m "fix: proyecto en la raiz + precios" && git push
```

Cuando termine, en la raíz de tu repo tienes que ver `public/`, `api/`, `tests/`, `package.json` y `staticwebapp.config.json`. Si ves `birra-map/`, el deploy volverá a fallar.

**Tus variables ya están bien** ✅ — en la captura se ven `PURGE_KEY`, `RETENTION_DAYS` y `STORAGE_CONNECTION_STRING`. Eso ya no hay que tocarlo.

---

## 💶 Nuevo: precio por consumición (lo pones tú)

Como el precio cambia según el garito, **lo metes tú en cada fichaje**. Pero la app no te hace teclearlo cada vez:

- **Aprende de vosotros.** Cuando escribes el nombre del bar, busca la **mediana de lo que el grupo ha pagado ahí por esa bebida** y te la propone. Segunda vez que vas al Manolo, la caña ya sale a 2,00 € sola.
- **Botones rápidos** con los precios más habituales, para no escribir.
- **Total en vivo**: antes de confirmar ves "3 × 2,50 € = 7,50 €".
- **Puedes dejarlo en blanco.** Si pasas del tema, se guarda sin precio y no cuenta para el gasto.
- **En las rondas**, el precio se multiplica por los presentes: pones 2 € y te dice *"invitas a 4 → te cuesta 8 €"* antes de que le des al botón.

### Qué te da eso
| Dónde | Qué ves |
|---|---|
| Mapa | Cada pin lleva lo que se ha gastado esa persona |
| **Gasto** (pestaña nueva) | Ranking de gasto, tu desglose (lo tuyo / lo que invitaste / lo que te ahorraste), gasto por bar |
| Deudas | Ahora en **rondas Y en euros**. Si estáis a la par en rondas pero uno invitó gin-tonics, sale la diferencia en € |
| Calor | Precio medio de cada bar. Cuál es el caro de verdad |
| Perfil | Gasto del día/semana/mes y precio medio de tu copa |

Todo se guarda **en céntimos, en enteros**. Nada de decimales flotantes con el dinero.

---

## 🧪 Tests: 210 + simulación

```bash
npm test                    # 210 comprobaciones
node tests/simulacion.js    # una noche entera de 5 colegas con precios reales
```

Sin Azure: hay un Table Storage en memoria que imita el real (orden de RowKeys y filtros OData incluidos).

La simulación no solo imprime, **verifica coherencia contable**: que lo que pagan las personas sea exactamente lo que cobran las barras, que lo invitado por unos sea lo recibido por otros y que el balance de rondas sume cero.

Y vuelve a haber cosecha de bugs reales:
- **El gasto de una ronda no se cargaba a quien invita.** Cada participante se comía su parte. Arreglado con segunda pasada que atribuye el coste al pagador.
- **"Bar Manolo" y "bar manolo" contaban como bares distintos**, así que el precio medio salía mal. Ahora se normaliza y se muestra la grafía más usada.
- Los 6 tests de estructura de repo que habrían cazado este despliegue fallido antes de subirlo.

---

## Arquitectura

```
Móvil / navegador ──► Static Web App (Free)
                       ├── /public   front (PWA instalable)
                       ├── /.auth/*  login GitHub / Microsoft
                       └── /api/*    Azure Functions (Node 20)
                                      └── Table Storage
                                           ├── members   nick, grupo, estado
                                           ├── checkins  consumiciones + precio
                                           ├── rounds    rondas pagadas
                                           └── events    modo evento
```

| Ruta | Qué hace |
|---|---|
| `/api/me` | perfil y alta en grupo |
| `/api/checkins` | activos + estadísticas + quién está en casa |
| `/api/checkin` | fichar / cerrar la noche |
| `/api/round` | rondas con precio |
| `/api/debts` | deudas compensadas en rondas y € |
| `/api/spend` | gasto por persona, por bar y tu desglose |
| `/api/prices` | precio sugerido y precios por bar |
| `/api/nearby` | quién está a tiro |
| `/api/ranking` | clasificación (periodo o evento) |
| `/api/events` | modo evento |
| `/api/heatmap` | puntos calientes + top bares con precio medio |
| `/api/home` | he llegado a casa |
| `/api/purge` | limpieza por retención |

### Variables
| Nombre | Obligatoria | Defecto |
|---|---|---|
| `STORAGE_CONNECTION_STRING` o `STORE_CONNECTION_STRING` | sí | — |
| `PURGE_KEY` | para limpieza | — |
| `RETENTION_DAYS` | no | 180 |
| `CHECKIN_COOLDOWN_MS` | no | 30000 |
| `ROUND_COOLDOWN_MS` | no | 60000 |

## Local

```bash
npm i -g @azure/static-web-apps-cli
cd api && npm install && cd ..
npm start
```

## Ideas para la v4
- **Bote común**: metes 50 € entre todos y la app va descontando.
- **Bizum directo** desde la pantalla de deudas.
- **Retos**: "5 bares en una noche", con insignias.
- **Modo resaca**: resumen del día siguiente con el daño económico.
