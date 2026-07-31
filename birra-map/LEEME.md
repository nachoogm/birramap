# BirraMap v4 — carpeta completa, sin editar nada a mano

## Lo que pasó y por qué no viste cambios

Las veces anteriores te di un **parche con instrucciones** del tipo "busca esta línea y sustitúyela". Si no editaste `app.js` e `index.html` línea a línea, no se cargó nada nuevo: seguías con el mismo `index.html` de siempre, que solo carga el `styles.css` y el `app.js` viejos.

**Esta vez no hay nada que editar.** Sustituyes la carpeta `birra-map` entera y funciona.

---

## Los 3 pasos

1. **Borra** el contenido actual de `birra-map/` en tu repo (deja `.git` y `.github` fuera, que están en la raíz).
2. **Copia** todo lo de este paquete dentro de `birra-map/`.
3. **Sube:**
   ```bash
   git add -A && git commit -m "BirraMap v4" && git push
   ```

Tu workflow ya apunta a `/birra-map/public` y `/birra-map/api`, así que no hay que tocarlo.

### Después de subir, en el móvil

La primera vez, **cierra la pestaña del todo y vuelve a abrir**. La app trae un service worker nuevo (`v4-0-1`) que tira la caché vieja y se recarga sola, pero en iPhone a veces hace falta ese empujón. Si la tienes en la pantalla de inicio, ciérrala del multitarea y ábrela de nuevo.

Que no veías cambios también tenía que ver con esto: el service worker anterior servía `styles.css` y `app.js` desde caché. Ahora los ficheros van con `?v=4` y la estrategia es **red primero**, así que un despliegue nuevo se ve al momento.

---

## Por qué no iba el GPS en iPhone

**La regla del gesto de Safari.** En iOS, la petición de ubicación solo se atiende si sale **directamente** del toque del usuario. Basta un `await` por delante —aunque tarde un milisegundo— para que iOS dé el gesto por gastado y **no llame ni al éxito ni al error**. Silencio absoluto: sin mensaje, sin timeout, sin nada. Por eso parecía que el botón no hacía nada.

El `locate()` anterior era `async function` con awaits delante. En Android funciona igual y por eso allí sí iba.

Lo que hace ahora:

- `GEO.pedirUbicacion()` **no es async** y la llamada al GPS es la primera línea que se ejecuta.
- Lanza `getCurrentPosition` **y** `watchPosition` a la vez: el que conteste primero.
- Si a los 3,5 s iOS sigue mudo, lanza en paralelo un intento de precisión baja, que casi siempre responde al instante.
- Si el permiso está denegado, corta al momento y te enseña **los pasos exactos** de tu iPhone en vez de esperar 20 segundos.
- Y siempre, siempre, puedes **colocar el punto a mano** en un mapa a pantalla completa.

Hay tests que simulan iOS descartando las llamadas fuera del gesto, y comprueban que el método viejo falla y el nuevo funciona.

**Comprueba tu móvil:** entra en `/ayuda.html` y dale a "Probar el GPS ahora". Te dice la precisión real, te la pinta en un mapa con el círculo de error y, si está bloqueado, te da los pasos concretos.

> El fallo más común en iPhone es que **"Ubicación precisa" está desactivada**: Ajustes → Privacidad y seguridad → Localización → Safari → Ubicación precisa.

---

## Las estrellas

Ahora sí están cableadas, en tres sitios:

- **Botón morado en el mapa.** Te sugiere los bares donde has estado y no has puntuado.
- **Después de fichar**, te lo ofrece solo.
- **Pestaña Bares** (nueva, en el menú de abajo): tocas cualquiera y lo puntúas.

Un voto por persona y bar; si revotas, se sustituye. Ves la media del grupo y el reparto de votos en barras mientras decides.

El ranking usa el **límite inferior de Wilson**, no la media pelada: un bar con un solo voto de 5 no adelanta a uno con veinte de 4,5. La media real se sigue mostrando tal cual.

---

## Lo visual

**Fuera los emojis.** Hay **43 iconos SVG** dibujados: cada bebida, cada sección, cada acción. Se ven igual en iPhone, Android y escritorio, heredan el color y escalan sin pixelarse. Los tests fallan si aparece un emoji en el código del front.

**El mapa cambia de verdad.** Antes eran las teselas normales de OpenStreetMap con un filtro CSS encima, que quedaba lavado. Ahora usa **CartoDB dark_matter**, un mapa diseñado en oscuro (gratis, sin clave). Las chinchetas son gotas con el icono de la bebida, halo animado en quien está activo y contador integrado.

**Tipografía.** Outfit para títulos y números, Inter para el texto. Antes era la del sistema, que en cada móvil se ve distinta.

Y además: degradados, animaciones de entrada escalonadas, estados vacíos con ilustración, y todo respetando el notch y `prefers-reduced-motion`.

---

## Las instrucciones

- **Tour de bienvenida** de 5 pasos, sale solo la primera vez.
- **`/ayuda.html`** con 11 apartados plegables, desde "cómo empiezo" hasta privacidad, con el comprobador de GPS incluido.
- Los dos accesibles desde **Perfil**.

---

## Tests

```bash
node tests/test.js     # 224 comprobaciones
```

Cubren la lógica de estrellas, la API entera, la simulación de iOS con la regla del gesto, los iconos (incluido que no haya emojis) y —lo más importante esta vez— **que el `index.html` cargue de verdad todos los ficheros nuevos y que `app.js` tenga las funciones cableadas**. Eso es exactamente lo que falló antes y ahora está cubierto.

---

## Qué hay en el paquete

```
public/
  index.html          ← completo, carga todo
  ayuda.html          ← instrucciones + comprobador de GPS
  css/styles.css      ← diseño nuevo
  js/icons.js         ← 43 iconos SVG
  js/geo.js           ← GPS con el arreglo de iOS
  js/ui.js            ← estrellas, tour, ayuda
  js/app.js           ← la app entera
  sw.js               ← service worker v4-0-1
  manifest.webmanifest
  staticwebapp.config.json
  icons/
api/                  ← 16 endpoints, incluidos rating y ratings
tests/test.js
```
