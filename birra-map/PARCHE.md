# Integrar la v4 en tu `app.js`

Cinco cambios. El **primero es el que arregla iPhone** y es el más importante de todos.

---

## 0 · Ficheros y cabecera

Sube estos ficheros dentro de `birra-map/`:

```
public/css/styles.css      ← nuevo (reemplaza al viejo styles.css)
public/js/geo.js           ← nuevo
public/js/ui.js            ← nuevo
public/ayuda.html          ← nuevo
public/demo.html           ← nuevo (puedes borrarlo cuando lo hayas visto)
api/shared/ratings.js      ← nuevo
api/rating/                ← nueva carpeta
api/ratings/               ← nueva carpeta
api/shared/store.js        ← reemplaza (añade listRatings y addRating)
```

⚠️ **No subas `api/shared/logic.js` ni `api/shared/tables.js`** de este paquete: son versiones reducidas solo para los tests. Conserva las tuyas.

En `public/index.html`, cambia la hoja de estilos y añade los dos scripts **antes** de `app.js`:

```html
<link rel="stylesheet" href="/css/styles.css" />
...
<script src="/js/geo.js"></script>
<script src="/js/ui.js"></script>
<script src="/js/app.js"></script>
```

---

## 1 · 🍎 EL ARREGLO DE IPHONE

Esto es lo que fallaba. En Safari de iOS, la petición de ubicación **solo funciona si sale directamente del toque del usuario**. Si antes hay un `await` —aunque sea de un milisegundo— iOS da el gesto por consumido y **no llama ni al éxito ni al error: se queda mudo para siempre**. No hay mensaje, no hay timeout, nada. Por eso parecía que "no hacía nada".

Tu `locate()` era `async` y tenía awaits por delante. Ahí estaba el problema.

**BUSCA** tu función `locate` (empiece por `function locate` o `async function locate`) y **sustituye toda la función** por:

```js
/* ⚠️ NO pongas `async` aquí ni añadas ningún await antes de llamar a
   pedirUbicacionUI. Si lo haces, iOS deja de responder. */
function locate(cb) {
  UI.pedirUbicacionUI({
    statusSel: '#geoStatus',
    onOk: (lat, lon, precision, manual) => {
      myPos = { lat, lon, accuracy: precision };
      state.lat = lat; state.lon = lon; state.accuracy = precision; state.manual = manual;
      cb(lat, lon, precision);
      /* el nombre del bar se rellena DESPUÉS, ya sin gesto de por medio */
      const campo = $('#placeName');
      if (campo && !campo.value) guessPlace(lat, lon).then(n => { if (n && !campo.value) campo.value = n; });
    },
    onFallo: ex => UI.toast(ex.titulo)
  });
}
```

Y en el botón de fichar, **BUSCA**:

```js
$('#fabDrink').onclick = () => {
  openModal('mdCheckin');
  ...
  locate(async (lat, lon) => { ... });
};
```

**Asegúrate de que quede así** — `locate` lo primero, sin nada asíncrono delante:

```js
$('#fabDrink').onclick = function () {
  locate(() => {});           // ← PRIMERO, dentro del gesto
  openModal('mdCheckin');     // el modal se abre después
};
```

> El orden importa: abrir el modal es una operación de DOM que en iOS puede romper el gesto.

Además, en `start()` añade una línea de calentamiento:

```js
function start() {
  // ... lo que ya tienes
  GEO.calentar();   // hace que el diálogo del permiso salga cuanto antes
}
```

Y sustituye `trackPosition()` entera por:

```js
function trackPosition() {
  GEO.seguir(p => { myPos = { lat: p.lat, lon: p.lon, accuracy: p.accuracy }; });
}
```

---

## 2 · ⭐ Puntuar bares

Añade al final de `app.js`:

```js
/* ---------- puntuar un bar ---------- */
let pickerActual = null;

function abrirPuntuar(place, { lat = null, lon = null } = {}) {
  if (!place) return UI.toast('Primero dime en qué bar estás');
  let m = $('#mdRating');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mdRating'; m.className = 'modal hidden';
    m.innerHTML = `
      <div class="modal-card">
        <div class="modal-asa"></div>
        <h3 id="ratTitulo"></h3>
        <p class="modal-sub">¿Qué tal está el sitio?</p>
        <div id="ratPicker"></div>
        <div id="ratOtros"></div>
        <label>Comentario <span class="mini">opcional</span></label>
        <input id="ratNota" maxlength="120" placeholder="Las cañas más frías del barrio" />
        <div class="fila-btn" style="margin-top:18px">
          <button class="btn btn-fantasma" data-close="mdRating">Ahora no</button>
          <button class="btn btn-oro" id="ratGuardar">Guardar ⭐</button>
        </div>
      </div>`;
    document.body.appendChild(m);
  }
  m.classList.remove('hidden');
  $('#ratTitulo').textContent = place;
  $('#ratNota').value = '';
  $('#ratOtros').innerHTML = UI.cargando('Cargando votos…');
  pickerActual = UI.pickerEstrellas('#ratPicker', { valor: 0 });

  api(`/ratings?place=${encodeURIComponent(place)}`).then(d => {
    if (d.miVoto) {
      pickerActual.set(d.miVoto.stars);
      $('#ratNota').value = d.miVoto.note || '';
    }
    $('#ratOtros').innerHTML = d.bar && d.bar.votos
      ? `<div class="aviso"><b>${d.bar.etiqueta.em} Media del grupo: ${d.bar.media}</b>
           <span class="mini"> · ${d.bar.votos} voto${d.bar.votos > 1 ? 's' : ''}</span>
           ${UI.reparto(d.bar.reparto, d.bar.votos)}</div>`
      : `<p class="mini" style="text-align:center">Nadie lo ha puntuado todavía. Estrénalo tú 🙌</p>`;
  }).catch(() => { $('#ratOtros').innerHTML = ''; });

  $('#ratGuardar').onclick = async () => {
    try {
      const r = await api('/rating', {
        method: 'POST',
        body: JSON.stringify({ place, stars: pickerActual.valor(), note: $('#ratNota').value.trim(), lat, lon })
      });
      m.classList.add('hidden');
      UI.toast(`¡Guardado! ${place}: ${r.bar.media} ⭐`);
      if (typeof cargarBares === 'function') cargarBares();
    } catch (e) { UI.toast(e.message); }
  };
}
```

Y en el modal de fichar, tras guardar, ofrece puntuar. **BUSCA** en `$('#saveCheckin').onclick` la línea `toast('¡Fichado! 🍻'); refresh();` y déjala así:

```js
    UI.toast('¡Fichado! 🍻');
    refresh();
    const bar = $('#placeName').value.trim();
    if (bar) setTimeout(() => abrirPuntuar(bar, { lat: state.lat, lon: state.lon }), 900);
```

---

## 3 · Pestaña de bares

En `index.html`, añade la página y la entrada de menú:

```html
<div class="page hidden" id="pg-bares">
  <div class="wrap">
    <div id="baresTop"></div>
    <div class="seccion">Todos los bares</div>
    <div id="baresLista"></div>
  </div>
</div>
```

```html
<a href="#/bares" class="nav-i" data-page="bares"><span class="ni">⭐</span><span>Bares</span></a>
```

En `app.js`, registra la página y añade el cargador:

```js
const PAGES = {
  mapa:    { title: 'BirraMap',      init: initMap },
  ranking: { title: 'Ranking',       init: () => loadRanking() },
  bares:   { title: 'Bares',         init: () => cargarBares() },   // ← nueva
  deudas:  { title: 'Deudas',        init: () => loadDebts() },
  heat:    { title: 'Mapa de calor', init: () => initHeat() },
  eventos: { title: 'Eventos',       init: () => loadEvents() },
  perfil:  { title: 'Perfil',        init: () => renderProfile() }
};

async function cargarBares() {
  const lista = $('#baresLista'), top = $('#baresTop');
  lista.innerHTML = UI.cargando();
  try {
    const d = await api('/ratings');
    if (!d.total) {
      top.innerHTML = '';
      lista.innerHTML = UI.vacio('⭐', 'Ningún bar puntuado', 'Ficha en un sitio y ponle nota. Así sabréis cuáles merecen la pena.');
      return;
    }
    top.innerHTML = d.mejor ? `<div class="hero">
      <span class="hero-em">${d.mejor.etiqueta.em}</span>
      <span class="num">${d.mejor.media}</span>
      <div class="hero-sub"><b>${UI.esc(d.mejor.place)}</b> es vuestro mejor bar<br>
        ${UI.estrellas(d.mejor.media, 'mini')} · ${d.mejor.votos} votos</div></div>` : '';

    lista.innerHTML = d.ranking.map((b, i) => `
      <div class="item" data-place="${UI.esc(b.place)}" style="animation-delay:${i * .04}s">
        <div class="medalla">${['🥇','🥈','🥉'][i] || `<span class="n">${i+1}</span>`}</div>
        <div class="item-cuerpo">
          <b>${UI.esc(b.place)}</b>
          <span>${UI.estrellas(b.media,'mini')} ${b.etiqueta.em} ${b.etiqueta.txt} · ${b.votos} voto${b.votos>1?'s':''}${b.miVoto!==null?` · tú: ${b.miVoto}★`:''}</span>
        </div>
        <div class="item-fin"><span class="num">${b.media}</span><small>nota</small></div>
      </div>`).join('');
    lista.querySelectorAll('.item').forEach(it =>
      it.onclick = () => abrirPuntuar(it.dataset.place));
  } catch (e) { lista.innerHTML = UI.vacio('😕', 'No se pudo cargar', e.message); }
}
```

---

## 4 · Chinchetas bonitas

**BUSCA** en `paintMarkers` la línea del `icon` y sustitúyela:

```js
    const cls = `pin${c.stale ? ' viejo' : ''}${c.userId === me.userId ? ' yo' : ''}`;
    const icon = L.divIcon({
      className: '', iconSize: [50, 50], iconAnchor: [25, 46],
      html: `<div class="${cls}">${c.stale ? '' : '<div class="pin-onda"></div>'}
               <div class="pin-cuerpo"><i>${d.em}</i></div>
               <div class="pin-num">${c.total}</div></div>`
    });
    const pop = `<div class="pop">
      <div class="pop-tit">${UI.esc(c.nick)}${c.userId === me.userId ? ' (tú)' : ''}</div>
      <div class="pop-sub">📍 ${UI.esc(c.place) || 'por ahí'}</div>
      <div class="pop-fila">${d.em} <b>${c.total}</b> × ${d.name}</div>
      <div class="pop-fila">🕒 ${ago(c.ts)}</div>
      ${c.note ? `<div class="pop-fila">💬 ${UI.esc(c.note)}</div>` : ''}</div>`;
```

---

## 5 · Tour e instrucciones

Al final de `start()`:

```js
  UI.tour();     // solo sale la primera vez; se guarda en localStorage
```

Y en la pestaña de Perfil, un acceso a la ayuda:

```html
<a class="btn btn-fantasma" href="/ayuda.html">📖 Cómo funciona la app</a>
```

---

## Comprobar

```bash
node tests/test-todo.js     # 152 comprobaciones
```

Y en el navegador:
- `/demo.html` — todo el diseño nuevo con datos de ejemplo
- `/ayuda.html` — las instrucciones, con comprobador de GPS incluido
