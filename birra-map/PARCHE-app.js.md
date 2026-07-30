# Parche de geolocalización para `public/js/app.js`

Cuatro cambios. El tercero es el que de verdad salva la papeleta dentro de un bar.

---

## 0 · Cargar el módulo nuevo

En `public/index.html`, **antes** de `<script src="/js/app.js">`, añade:

```html
<script src="/js/geo.js"></script>
```

Y sube el fichero `public/js/geo.js` que viene en el paquete.

---

## 1 · Sustituir `locate()`

**BUSCA** esto:

```js
function locate(cb) {
  if (!navigator.geolocation) { const c = map ? map.getCenter() : { lat: 40.4168, lng: -3.7038 }; return cb(c.lat, c.lng); }
  navigator.geolocation.getCurrentPosition(
    p => { myPos = { lat: p.coords.latitude, lon: p.coords.longitude }; cb(myPos.lat, myPos.lon); },
    () => { const c = map ? map.getCenter() : { lat: 40.4168, lng: -3.7038 }; $('#geoStatus').textContent = '⚠️ sin GPS, uso el centro del mapa'; cb(c.lat, c.lng); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}
```

**SUSTITÚYELO POR:**

```js
/* Espera a que el GPS afine en vez de quedarse con la primera lectura,
   que en el móvil suele venir de la antena con kilómetros de error. */
async function locate(cb) {
  const st = $('#geoStatus');
  if (st) st.textContent = '🛰️ buscando GPS…';
  try {
    const pos = await GEO.mejorPosicion({
      onProgreso: (p, c) => { if (st) st.textContent = `${c.em} ${c.txt}`; }
    });
    myPos = { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy };
    state.accuracy = pos.accuracy;
    if (st) st.innerHTML = `${pos.calidad.em} ${pos.calidad.txt}` +
      (pos.accuracy > 60 ? ' · <a href="#" id="fixPin" style="color:#f5b301">ajustar a mano</a>' : '');
    const fix = $('#fixPin');
    if (fix) fix.onclick = ev => { ev.preventDefault(); abrirSelectorMapa(pos.lat, pos.lon, cb); };
    cb(pos.lat, pos.lon, pos.accuracy);
  } catch (e) {
    const ex = e.explicado || { titulo: 'Sin ubicación', texto: '' };
    if (st) st.innerHTML = `⚠️ ${ex.titulo} · <a href="#" id="fixPin" style="color:#f5b301">poner a mano</a>`;
    const fix = $('#fixPin');
    const centro = map ? map.getCenter() : { lat: 40.4168, lng: -3.7038 };
    if (fix) fix.onclick = ev => { ev.preventDefault(); abrirSelectorMapa(centro.lat, centro.lng, cb); };
    toast(ex.titulo);
  }
}
```

> Fíjate en lo importante: **ya no ficha sola con una posición mala**. Antes, si el GPS fallaba, usaba el centro del mapa sin decírtelo y quedabas fichado en mitad de la Gran Vía.

---

## 2 · Sustituir `trackPosition()`

**BUSCA:**

```js
function trackPosition() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(p => {
    myPos = { lat: p.coords.latitude, lon: p.coords.longitude };
  }, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 });
}
```

**SUSTITÚYELO POR:**

```js
function trackPosition() {
  GEO.seguir(p => { myPos = { lat: p.lat, lon: p.lon, accuracy: p.accuracy }; });
}
```

El anterior tenía `enableHighAccuracy: false`, o sea que **pedía expresamente la posición mala**. Por eso las distancias de la lista y los avisos de proximidad bailaban tanto.

---

## 3 · Añadir el selector manual (lo más útil)

Pega esta función al final de `app.js`. Dentro de un bar el GPS es un desastre y no hay módulo que lo arregle: lo que hace falta es poder arrastrar el punto.

```js
/* Mapa a pantalla completa para colocar el punto con el dedo */
function abrirSelectorMapa(lat, lon, cb) {
  let cont = $('#pickerModal');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'pickerModal';
    cont.style.cssText = 'position:fixed;inset:0;z-index:1200;background:#0b1b3a;display:flex;flex-direction:column';
    cont.innerHTML = `
      <div style="padding:calc(12px + env(safe-area-inset-top)) 14px 10px;background:#132a55;border-bottom:1px solid #22407a">
        <b style="font-size:1.05rem">📍 Mueve el mapa hasta tu bar</b>
        <div style="color:#93a7cf;font-size:.8rem;margin-top:3px">El punto central es donde vas a fichar.</div>
      </div>
      <div id="pickerMap" style="flex:1;position:relative"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-100%);z-index:500;
                  font-size:2.4rem;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6))">📍</div>
      <div style="padding:12px 14px calc(14px + env(safe-area-inset-bottom));background:#132a55;
                  border-top:1px solid #22407a;display:flex;gap:10px">
        <button id="pickerCancel" style="flex:1;padding:14px;border-radius:12px;border:1px solid #22407a;
                background:transparent;color:#eaf0ff;font-weight:600;font-size:1rem">Cancelar</button>
        <button id="pickerOk" style="flex:2;padding:14px;border-radius:12px;border:none;
                background:linear-gradient(180deg,#ffd24a,#f5b301);color:#26180a;font-weight:800;font-size:1rem">Es aquí ✓</button>
      </div>`;
    document.body.appendChild(cont);
  }
  cont.style.display = 'flex';

  if (!cont._map) {
    cont._map = L.map('pickerMap', { zoomControl: false }).setView([lat, lon], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(cont._map);
    L.control.zoom({ position: 'bottomleft' }).addTo(cont._map);
  } else {
    cont._map.setView([lat, lon], 18);
  }
  setTimeout(() => cont._map.invalidateSize(), 80);

  $('#pickerCancel').onclick = () => { cont.style.display = 'none'; };
  $('#pickerOk').onclick = async () => {
    const c = cont._map.getCenter();
    cont.style.display = 'none';
    state.manual = true;
    state.accuracy = 0;
    const st = $('#geoStatus');
    if (st) st.textContent = '📍 posición puesta a mano';
    /* intenta poner el nombre del bar solo */
    const campo = $('#placeName') && !$('#placeName').value ? $('#placeName') : null;
    if (campo) campo.value = await guessPlace(c.lat, c.lng);
    cb(c.lat, c.lng, 0);
  };
}
```

---

## 4 · Usar la precisión en las distancias

Cuando tu GPS tiene 800 m de error, decir "Juan está a 40 m" es mentira. **BUSCA** en `renderLive`:

```js
      const dist = myPos ? ` · ${fmtDist(haversine(myPos.lat, myPos.lon, c.lat, c.lon))}` : '';
```

**SUSTITÚYELO POR:**

```js
      /* Si mi posición es mala, no presumo de precisión */
      const dm = myPos ? haversine(myPos.lat, myPos.lon, c.lat, c.lon) : null;
      const fiable = myPos && (myPos.accuracy || 0) < 150;
      const dist = dm === null ? '' : fiable ? ` · ${fmtDist(dm)}` : ` · ~${fmtDist(dm)}`;
```

Y en `checkProximity`, **BUSCA**:

```js
    const dist = haversine(myPos.lat, myPos.lon, c.lat, c.lon);
    if (dist > NOTIF_RADIUS) return;
```

**SUSTITÚYELO POR:**

```js
    const dist = haversine(myPos.lat, myPos.lon, c.lat, c.lon);
    /* con la posición mala saltaban avisos de gente que estaba lejísimos */
    if ((myPos.accuracy || 0) > 300) return;
    if (dist > NOTIF_RADIUS) return;
```

---

## Comprobar que va

Sube todo y abre **en el móvil**:

```
https://proud-stone-01c2fce03.7.azurestaticapps.net/geotest.html
```

Te enseña la precisión real, el círculo de error sobre el mapa y el historial de lecturas. Si ves que empieza en ±3000 m y baja a ±15 m en unos segundos, es exactamente el problema que tenías.
