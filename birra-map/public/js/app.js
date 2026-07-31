/* ============================================================
   BirraMap · aplicación
   ============================================================ */

const DRINKS = [
  { id: 'cana', ico: 'cana', name: 'Caña' }, { id: 'tercio', ico: 'tercio', name: 'Tercio' },
  { id: 'ipa', ico: 'ipa', name: 'IPA' }, { id: 'trigo', ico: 'trigo', name: 'Trigo' },
  { id: 'tostada', ico: 'tostada', name: 'Tostada' }, { id: 'sin', ico: 'sin', name: 'Sin' },
  { id: 'vino', ico: 'vino', name: 'Vino' }, { id: 'tinto', ico: 'tinto', name: 'Tinto v.' },
  { id: 'copa', ico: 'copa', name: 'Copa' }, { id: 'gintonic', ico: 'gintonic', name: 'Gin-tonic' },
  { id: 'sidra', ico: 'sidra', name: 'Sidra' }, { id: 'refresco', ico: 'refresco', name: 'Refresco' }
];
const POLL_MS = 20000, NOTIF_RADIO = 500;

let me = null, map = null, heatMap = null, heatLayer = null;
let markers = new Map(), timer = null, myPos = null;
let ultimos = { active: [], home: [], rounds: [], me: null };
let vistos = new Set();
let notifOn = localStorage.getItem('birramap_notif') === '1';
let picker = null;

const state = { drink: 'cana', qty: 1, lat: null, lon: null, acc: null, manual: false, precio: '',
                roundDrink: 'cana', roundSel: new Set(), cerca: [] };

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => UI.esc(s);
const ico = (n, t = 18, c = '') => ICON.get(n, t, c);
const bebida = id => DRINKS.find(d => d.id === id) || DRINKS[0];

/* el selector manual necesita saber dónde está el mapa */
window.__mapaCentro = () => map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : { lat: 40.4168, lon: -3.7038 };

/* ---------------- API con caché ----------------
   Dos mejoras que se notan mucho en Bares y Deudas:
   · caché por ruta con TTL, así volver a la pestaña es instantáneo
   · deduplicación: dos llamadas iguales a la vez comparten petición */
const _cache = new Map();
const _enVuelo = new Map();

const TTL = { '/ratings': 45000, '/debts': 45000, '/heatmap': 90000, '/ranking': 25000, '/events': 120000 };
const ttlDe = path => { for (const k in TTL) if (path.startsWith(k)) return TTL[k]; return 0; };

function invalidarCache(...prefijos) {
  for (const k of [..._cache.keys()])
    if (!prefijos.length || prefijos.some(p => k.startsWith(p))) _cache.delete(k);
}

const apiRaw = async (path, opts = {}) => {
  let r;
  try { r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts }); }
  catch { const e = new Error('Sin conexión con el servidor.'); e.status = 0; throw e; }
  if (!r.ok) {
    let msg = `Error ${r.status}`, extra = null;
    try { const j = await r.json(); msg = j.error || msg; extra = j; } catch {}
    const e = new Error(msg); e.status = r.status; e.detail = extra; throw e;
  }
  return r.status === 204 ? null : r.json();
};

const api = async (path, opts = {}) => {
  const esGet = !opts.method || opts.method === 'GET';

  /* las escrituras tiran el caché de lo que toquen */
  if (!esGet) {
    const res = await apiRaw(path, opts);
    if (path.startsWith('/rating')) invalidarCache('/ratings');
    else if (path.startsWith('/round')) invalidarCache('/debts', '/ranking', '/checkins');
    else if (path.startsWith('/checkin')) invalidarCache('/ranking', '/heatmap', '/checkins');
    else if (path.startsWith('/events')) invalidarCache('/events', '/ranking');
    else invalidarCache();
    return res;
  }

  const ttl = opts.noCache ? 0 : ttlDe(path);
  if (ttl) {
    const hit = _cache.get(path);
    if (hit && hit.expira > Date.now()) return hit.valor;
  }
  /* si ya hay una petición idéntica en marcha, nos colgamos de ella */
  if (_enVuelo.has(path)) return _enVuelo.get(path);

  const prom = apiRaw(path, opts)
    .then(v => { if (ttl) _cache.set(path, { valor: v, expira: Date.now() + ttl }); return v; })
    .finally(() => _enVuelo.delete(path));
  _enVuelo.set(path, prom);
  return prom;
};

/* Devuelve lo cacheado al momento (si lo hay) y refresca por detrás.
   Es lo que hace que Bares y Deudas se sientan instantáneos. */
async function apiRefresco(path, alPintar) {
  const hit = _cache.get(path);
  if (hit) { try { alPintar(hit.valor, true); } catch {} }
  const fresco = await api(path, { noCache: !!hit });
  if (hit) _cache.set(path, { valor: fresco, expira: Date.now() + ttlDe(path) });
  alPintar(fresco, false);
  return fresco;
}

const pantalla = id => ['login', 'alta', 'app'].forEach(s => $('#scr-' + s).classList.toggle('hidden', s !== id));

function fatal(e) {
  document.body.innerHTML = `<div class="screen centro">
    <div class="card" style="max-width:420px;text-align:center">
      <div style="display:flex;justify-content:center;color:var(--mal);margin-bottom:10px">${ico('aviso', 46)}</div>
      <h2>${e.status === 503 || e.status === 500 ? 'El servidor no puede guardar los datos' : 'Algo ha fallado'}</h2>
      <p class="mini" style="margin:10px 0 16px">${esc(e.message)}</p>
      <p class="mini" style="color:var(--txt3)">Código ${e.status}</p>
      <a class="btn btn-oro" href="/">Reintentar</a>
      <a class="btn btn-fantasma" href="/ayuda.html">Ver la ayuda</a>
    </div></div>`;
}

const hace = ts => {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
};
const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';
const fmtFecha = ms => new Date(ms).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ---------------- arranque ---------------- */
(async function boot() {
  ICON.pintar();
  pintarBotonTema();
  let p = null;
  try { p = (await (await fetch('/.auth/me')).json()).clientPrincipal; } catch {}
  if (!p) return pantalla('login');

  try { me = await api('/me'); }
  catch (e) {
    if (e.status === 401) return pantalla('login');
    return fatal(e);
  }
  if (!me.groupId || !me.nick) {
    $('#ob-nick').value = me.nick || p.userDetails || '';
    return pantalla('alta');
  }
  arrancar();
})();

$('#ob-save').onclick = async () => {
  const nick = $('#ob-nick').value.trim(), groupId = $('#ob-group').value.trim().toLowerCase();
  if (!nick || !groupId) return UI.toast('Rellena el mote y el grupo');
  try { me = await api('/me', { method: 'POST', body: JSON.stringify({ nick, groupId }) }); arrancar(); }
  catch (e) { UI.toast(e.message); }
};

function arrancar() {
  pantalla('app');
  $('#chipGrupo').textContent = me.groupId;
  pintarBebidas();
  ruta();
  refrescar();
  clearInterval(timer);
  timer = setInterval(refrescar, POLL_MS);
  GEO.seguir(p => { myPos = { lat: p.lat, lon: p.lon, accuracy: p.accuracy }; });
  $('#notifSw').checked = notifOn;
  estadoNotif();
  cargarEventos();
  UI.tour();
  precargar();
}

/* Precarga silenciosa: cuando el usuario toca Bares o Deudas
   los datos ya están en caché y aparecen al instante. */
function precargar() {
  setTimeout(() => {
    api('/ratings').catch(() => {});
    api('/debts?days=90').catch(() => {});
  }, 1200);
}

/* ---------------- router ---------------- */
const PAGES = {
  mapa:    { tit: 'BirraMap',      init: iniMapa },
  ranking: { tit: 'Ranking',       init: () => cargarRanking() },
  bares:   { tit: 'Bares',         init: () => cargarBares() },
  deudas:  { tit: 'Deudas',        init: () => cargarDeudas() },
  calor:   { tit: 'Mapa de calor', init: () => iniCalor() },
  eventos: { tit: 'Eventos',       init: () => cargarEventos() },
  perfil:  { tit: 'Perfil',        init: () => pintarPerfil() }
};
function ruta() {
  const n = location.hash.replace('#/', '') || 'mapa';
  const p = PAGES[n] ? n : 'mapa';
  $$('.page').forEach(x => x.classList.add('hidden'));
  $('#pg-' + p).classList.remove('hidden');
  $$('.nav-i').forEach(x => x.classList.toggle('activo', x.dataset.page === p));
  $('#titulo').textContent = PAGES[p].tit;
  PAGES[p].init();
}
window.addEventListener('hashchange', ruta);

/* ---------------- mapa ---------------- */
function iniMapa() {
  if (map) { setTimeout(() => map.invalidateSize(), 60); return; }
  map = L.map('map', { zoomControl: false }).setView([40.4168, -3.7038], 13);
  TEMA.capaMapa().addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  if (myPos) map.setView([myPos.lat, myPos.lon], 15);
  pintarPines(ultimos.active);
}

function pintarPines(lista) {
  if (!map) return;
  const vistosAhora = new Set();
  lista.forEach(c => {
    vistosAhora.add(c.userId);
    const d = bebida(c.drink);
    const cls = `pin${c.stale ? ' viejo' : ''}${c.userId === me.userId ? ' yo' : ''}`;
    const icon = L.divIcon({
      className: '', iconSize: [50, 50], iconAnchor: [25, 46],
      html: `<div class="${cls}">${c.stale ? '' : '<div class="pin-onda"></div>'}
               <div class="pin-cuerpo">${ico(d.ico, 21)}</div>
               <div class="pin-num">${c.total}</div></div>`
    });
    const pop = `<div class="pop">
      <div class="pop-tit">${esc(c.nick)}${c.userId === me.userId ? ' (tú)' : ''}</div>
      <div class="pop-sub">${esc(c.place) || 'por ahí'}</div>
      <div class="pop-fila">${ico(d.ico, 15)} <b>${c.total}</b> × ${d.name}</div>
      <div class="pop-fila">${ico('reloj', 15)} ${hace(c.ts)}</div>
      ${c.note ? `<div class="pop-fila">${esc(c.note)}</div>` : ''}</div>`;
    if (markers.has(c.userId)) markers.get(c.userId).setLatLng([c.lat, c.lon]).setIcon(icon).setPopupContent(pop);
    else markers.set(c.userId, L.marker([c.lat, c.lon], { icon }).addTo(map).bindPopup(pop));
  });
  [...markers.keys()].filter(k => !vistosAhora.has(k)).forEach(k => { map.removeLayer(markers.get(k)); markers.delete(k); });
}

/* ---------------- datos ---------------- */
async function refrescar() {
  try {
    const d = await api('/checkins?hours=12');
    proximidad(d.active);
    ultimos = d;
    pintarPines(d.active);
    pintarDirecto(d);
    $('#chipVivo').textContent = d.active.length ? `${d.active.length} fuera` : '';
    $('#chipVivo').classList.toggle('hidden', !d.active.length);
    if (!$('#pg-perfil').classList.contains('hidden')) pintarPerfil();
  } catch (e) {
    if (e.status === 401) return pantalla('login');
    console.warn(e);
  }
}

function pintarDirecto(d) {
  const el = $('#listaDirecto');
  $('#asaTxt').textContent = d.active.length ? `${d.active.length} de birras` : 'nadie fuera';
  if (!d.active.length) {
    el.innerHTML = UI.vacio('jarra', 'Nadie ha fichado', 'Sé tú quien abra la veda. Dale al botón dorado.');
  } else {
    el.innerHTML = d.active.map((c, i) => {
      const b = bebida(c.drink);
      const dm = myPos ? GEO.distancia(myPos.lat, myPos.lon, c.lat, c.lon) : null;
      const fiable = myPos && (myPos.accuracy || 0) < 150;
      const dist = dm === null ? '' : ` · ${fiable ? '' : '~'}${GEO.fmtDist(dm)}`;
      return `<div class="item" data-uid="${c.userId}" style="animation-delay:${i * .04}s">
        <div class="item-ico">${ico(b.ico, 22)}</div>
        <div class="item-cuerpo"><b>${esc(c.nick)}${c.userId === me.userId ? ' (tú)' : ''}</b>
          <span>${esc(c.place) || 'por ahí'} · ${hace(c.ts)}${dist}</span></div>
        <div class="item-fin"><span class="num">${c.total}</span><small>copas</small></div></div>`;
    }).join('');
    el.querySelectorAll('.item').forEach(r => r.onclick = () => verPersona(r.dataset.uid));
  }
  $('#listaCasa').innerHTML = (d.home && d.home.length)
    ? `<div class="seccion">Ya en casa</div>` + d.home.map(h =>
      `<div class="item casa"><div class="item-ico">${ico('casa', 22)}</div>
       <div class="item-cuerpo"><b>${esc(h.nick)}</b><span>llegó bien · ${hace(h.homeAt)}</span></div></div>`).join('')
    : '';
}

function verPersona(uid) {
  const c = ultimos.active.find(a => a.userId === uid);
  if (!c) return;
  const d = bebida(c.drink);
  abrirModal('mdDetalle', `
    <div class="modal-asa"></div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
      <div class="item-ico" style="width:54px;height:54px">${ico(d.ico, 26)}</div>
      <div><h3>${esc(c.nick)}</h3><p class="mini" style="margin:2px 0 0">${esc(c.place) || 'por ahí'}</p></div>
    </div>
    <div class="stat"><span>${ico('cana', 18)} Lleva</span><b>${c.total} consumiciones</b></div>
    <div class="stat"><span>${ico('reloj', 18)} Último fichaje</span><b>${hace(c.ts)}</b></div>
    ${myPos ? `<div class="stat"><span>${ico('pin', 18)} Distancia</span><b>${GEO.fmtDist(GEO.distancia(myPos.lat, myPos.lon, c.lat, c.lon))}</b></div>` : ''}
    ${c.note ? `<div class="stat"><span>Dice</span><b>${esc(c.note)}</b></div>` : ''}
    <div class="fila-btn" style="margin-top:18px">
      <button class="btn btn-fantasma" data-cerrar="mdDetalle">Cerrar</button>
      <a class="btn btn-oro" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}">${ico('pin', 18)} Cómo llegar</a>
    </div>`);
}

/* ---------------- modales ---------------- */
function abrirModal(id, html) {
  let m = $('#' + id);
  if (!m) { m = document.createElement('div'); m.id = id; m.className = 'modal'; document.body.appendChild(m); }
  m.className = 'modal';
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  m.onclick = e => { if (e.target === m) m.classList.add('hidden'); };
  m.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => $('#' + b.dataset.cerrar).classList.add('hidden'));
  return m;
}
const cerrarModal = id => { const m = $('#' + id); if (m) m.classList.add('hidden'); };

/* ---------------- fichar ---------------- */
function pintarBebidas() {
  const build = (sel, key) => {
    const c = $(sel); if (!c) return;
    c.innerHTML = DRINKS.map(d => `<div class="bebida ${state[key] === d.id ? 'sel' : ''}" data-id="${d.id}">
      ${ico(d.ico, 26)}<span>${d.name}</span></div>`).join('');
    c.querySelectorAll('.bebida').forEach(e => e.onclick = () => { state[key] = e.dataset.id; build(sel, key); });
  };
  build('#bebidas', 'drink');
}

/* IMPORTANTE: sin async y con localizar() como PRIMERA instrucción. iOS lo exige. */
$('#fabBeber').onclick = function () {
  localizar();                 // ← primero, dentro del gesto
  $('#mdBeber').classList.remove('hidden');
  pintarBebidas();
  $('#qtyVal').textContent = state.qty = 1;
  $('#nota').value = '';
};

function localizar() {
  UI.pedirUbicacionUI({
    statusSel: '#geoStatus',
    onOk: (lat, lon, acc, manual) => {
      state.lat = lat; state.lon = lon; state.acc = acc; state.manual = manual;
      myPos = { lat, lon, accuracy: acc };
      const campo = $('#localNombre');
      if (campo && !campo.value) adivinarBar(lat, lon).then(n => { if (n && !campo.value) campo.value = n; });
    },
    onFallo: ex => {
      UI.toast(ex.titulo);
      if (ex.pasos && ex.pasos.length) {
        setTimeout(() => abrirModal('mdGeo', `
          <div class="modal-asa"></div>
          <div style="display:flex;justify-content:center;color:var(--mal);margin-bottom:8px">${ico('satelite', 44)}</div>
          <h3 style="text-align:center">${esc(ex.titulo)}</h3>
          <p class="modal-sub" style="text-align:center">${esc(ex.texto)}</p>
          <div class="aviso"><b>Cómo arreglarlo</b><ol>${ex.pasos.map(p => `<li>${esc(p)}</li>`).join('')}</ol></div>
          <button class="btn btn-oro" data-cerrar="mdGeo">Entendido</button>
          <a class="btn btn-fantasma" href="/ayuda.html">Ver más ayuda</a>`), 400);
      }
    }
  });
}

$$('.cant-btn').forEach(b => b.onclick = () => {
  state.qty = Math.max(1, Math.min(20, state.qty + Number(b.dataset.d)));
  $('#qtyVal').textContent = state.qty;
});

$('#guardarBeber').onclick = async () => {
  if (state.lat == null) return UI.toast('Espera al GPS o pon el punto a mano');
  const bar = $('#localNombre').value.trim();
  try {
    await api('/checkin', { method: 'POST', body: JSON.stringify({
      drink: state.drink, qty: state.qty, lat: state.lat, lon: state.lon,
      place: bar, note: $('#nota').value.trim(), price: $('#precio').value.trim()
    }) });
    cerrarModal('mdBeber');
    UI.toast('¡Fichado!');
    refrescar();
    if (bar) setTimeout(() => abrirPuntuar(bar, { lat: state.lat, lon: state.lon }), 800);
  } catch (e) { UI.toast(e.message); }
};

async function adivinarBar(lat, lon) {
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`)).json();
    return r.name || (r.address && (r.address.bar || r.address.pub || r.address.cafe || r.address.restaurant || r.address.road)) || '';
  } catch { return ''; }
}

/* ---------------- ⭐ PUNTUAR ---------------- */
function abrirPuntuar(place, { lat = null, lon = null } = {}) {
  if (!place) return UI.toast('Primero dime en qué bar estás');
  const m = abrirModal('mdEstrellas', `
    <div class="modal-asa"></div>
    <h3>${esc(place)}</h3>
    <p class="modal-sub">¿Qué tal está el sitio?</p>
    <div id="estPicker"></div>
    <div id="estOtros"></div>
    <label>Comentario <span class="mini">opcional</span></label>
    <input id="estNota" maxlength="120" placeholder="Las cañas más frías del barrio" />
    <div class="fila-btn" style="margin-top:18px">
      <button class="btn btn-fantasma" data-cerrar="mdEstrellas">Ahora no</button>
      <button class="btn btn-oro" id="estGuardar">${ico('estrellaLlena', 18)} Guardar</button>
    </div>`);
  m.classList.remove('hidden');

  picker = UI.pickerEstrellas('#estPicker', { valor: 0 });
  $('#estOtros').innerHTML = UI.cargando('Cargando votos…');

  api(`/ratings?place=${encodeURIComponent(place)}`).then(d => {
    if (d.miVoto) { picker.set(d.miVoto.stars); $('#estNota').value = d.miVoto.note || ''; }
    $('#estOtros').innerHTML = (d.bar && d.bar.votos)
      ? `<div class="aviso"><b>Media del grupo: ${d.bar.media}</b>
           <span class="mini"> · ${d.bar.votos} voto${d.bar.votos > 1 ? 's' : ''} · ${esc(d.bar.etiqueta.txt)}</span>
           ${UI.reparto(d.bar.reparto, d.bar.votos)}</div>`
      : `<p class="mini" style="text-align:center;margin:10px 0">Nadie lo ha puntuado todavía. Estrénalo tú.</p>`;
  }).catch(() => { $('#estOtros').innerHTML = ''; });

  $('#estGuardar').onclick = async () => {
    try {
      const r = await api('/rating', { method: 'POST', body: JSON.stringify({
        place, stars: picker.valor(), note: $('#estNota').value.trim(), lat, lon }) });
      cerrarModal('mdEstrellas');
      UI.toast(`Guardado. ${place}: ${r.bar.media} de 5`);
      if (!$('#pg-bares').classList.contains('hidden')) cargarBares();
    } catch (e) { UI.toast(e.message); }
  };
}

/* botón morado del mapa */
$('#fabPuntuar').onclick = function () {
  const sugerido = (ultimos.active.find(a => a.userId === me.userId) || {}).place || '';
  const m = abrirModal('mdElegirBar', `
    <div class="modal-asa"></div>
    <h3>Puntuar un bar</h3>
    <p class="modal-sub">¿Cuál quieres puntuar?</p>
    <label>Nombre del bar</label>
    <input id="barNombre" maxlength="60" placeholder="Bar Manolo" value="${esc(sugerido)}" />
    <div id="barSugeridos"></div>
    <div class="fila-btn" style="margin-top:18px">
      <button class="btn btn-fantasma" data-cerrar="mdElegirBar">Cancelar</button>
      <button class="btn btn-oro" id="barIr">Continuar</button>
    </div>`);
  m.classList.remove('hidden');
  $('#barIr').onclick = () => {
    const v = $('#barNombre').value.trim();
    if (!v) return UI.toast('Escribe el nombre del bar');
    cerrarModal('mdElegirBar');
    abrirPuntuar(v, myPos ? { lat: myPos.lat, lon: myPos.lon } : {});
  };
  api('/ratings?pending=1').then(d => {
    if (!d.pendientes || !d.pendientes.length) return;
    $('#barSugeridos').innerHTML = `<div class="seccion">Has estado aquí</div>` +
      d.pendientes.slice(0, 6).map(p => `<div class="item" data-p="${esc(p.place)}">
        <div class="item-ico">${ico('pin', 20)}</div>
        <div class="item-cuerpo"><b>${esc(p.place)}</b><span>sin puntuar · ${hace(p.tsMs)}</span></div>
        <div class="item-fin">${ico('flecha', 18)}</div></div>`).join('');
    $('#barSugeridos').querySelectorAll('.item').forEach(it => it.onclick = () => {
      cerrarModal('mdElegirBar');
      abrirPuntuar(it.dataset.p, myPos ? { lat: myPos.lat, lon: myPos.lon } : {});
    });
  }).catch(() => {});
};

/* ---------------- página de bares ---------------- */
async function cargarBares() {
  const lista = $('#baresLista'), top = $('#baresTop');
  if (!lista.dataset.pintado) lista.innerHTML = UI.esqueleto(5);
  try {
    await apiRefresco('/ratings', d => pintarBares(d, lista, top));
  } catch (e) { lista.innerHTML = UI.vacio('aviso', 'No se pudo cargar', e.message); }
}

function pintarBares(d, lista, top) {
  {
    if (!d.total) {
      top.innerHTML = '';
      lista.innerHTML = UI.vacio('estrella', 'Ningún bar puntuado', 'Ficha en un sitio y ponle nota. Así sabréis cuáles merecen la pena.');
      lista.dataset.pintado = '1';
      return;
    }
    top.innerHTML = d.mejor ? `<div class="hero">
      <div class="hero-ico">${ico('corona', 40)}</div>
      <span class="num">${d.mejor.media}</span>
      <div class="hero-sub"><b>${esc(d.mejor.place)}</b> es vuestro mejor bar<br>
        ${UI.estrellas(d.mejor.media)} · ${d.mejor.votos} voto${d.mejor.votos > 1 ? 's' : ''}</div></div>` : '';
    lista.innerHTML = d.ranking.map((b, i) => `
      <div class="item" data-place="${esc(b.place)}" style="animation-delay:${i * .04}s">
        <div class="medalla">${i < 3 ? ico('trofeo', 20) : `<span class="n">${i + 1}</span>`}</div>
        <div class="item-cuerpo"><b>${esc(b.place)}</b>
          <span>${UI.estrellas(b.media)} ${esc(b.etiqueta.txt)} · ${b.votos} voto${b.votos > 1 ? 's' : ''}${b.miVoto !== null ? ` · tú: ${b.miVoto}` : ''}</span></div>
        <div class="item-fin"><span class="num">${b.media}</span><small>nota</small></div></div>`).join('');
    lista.querySelectorAll('.item').forEach(it => it.onclick = () => abrirPuntuar(it.dataset.place));
    lista.dataset.pintado = '1';
  }
}

/* ---------------- ronda ---------------- */
$('#fabRonda').onclick = function () {
  localizarRonda();
  const m = abrirModal('mdRonda', `
    <div class="modal-asa"></div>
    <h3>Invito yo</h3>
    <p class="modal-sub">Marca a quién le entra. Se les suma una y te deben una ronda.</p>
    <div id="rondaBebidas" class="bebidas"></div>
    <label>Local</label>
    <input id="rondaLocal" placeholder="Bar Manolo" />
    <label>Precio por consumición <span class="mini">opcional</span></label>
    <input id="rondaPrecio" inputmode="decimal" placeholder="2,50" />
    <label>Quién está aquí <span class="mini" id="cercaEstado"></span></label>
    <div id="cercaLista"></div>
    <div class="fila-btn" style="margin-top:18px">
      <button class="btn btn-fantasma" data-cerrar="mdRonda">Cancelar</button>
      <button class="btn btn-oro" id="guardarRonda">Pagar la ronda</button>
    </div>`);
  m.classList.remove('hidden');

  const build = () => {
    $('#rondaBebidas').innerHTML = DRINKS.map(d => `<div class="bebida ${state.roundDrink === d.id ? 'sel' : ''}" data-id="${d.id}">
      ${ico(d.ico, 26)}<span>${d.name}</span></div>`).join('');
    $('#rondaBebidas').querySelectorAll('.bebida').forEach(e => e.onclick = () => { state.roundDrink = e.dataset.id; build(); });
  };
  build();
  $('#guardarRonda').onclick = guardarRonda;
};

function localizarRonda() {
  state.roundSel.clear();
  const pet = GEO.pedirUbicacion({});
  pet.promesa.then(async pos => {
    state.lat = pos.lat; state.lon = pos.lon;
    myPos = { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy };
    const campo = $('#rondaLocal');
    if (campo && !campo.value) adivinarBar(pos.lat, pos.lon).then(n => { if (n && !campo.value) campo.value = n; });
    try {
      const r = await api(`/nearby?lat=${pos.lat}&lon=${pos.lon}&radius=500`);
      state.cerca = r.people.filter(p => p.userId !== me.userId);
      state.cerca.forEach(p => state.roundSel.add(p.userId));
      pintarCerca();
    } catch (e) { const el = $('#cercaEstado'); if (el) el.textContent = e.message; }
  }).catch(() => {
    const el = $('#cercaLista');
    if (el) el.innerHTML = `<p class="mini">Sin GPS no puedo buscar a nadie cerca. Escribe el local y añade a mano.</p>`;
  });
}

function pintarCerca() {
  const est = $('#cercaEstado'), el = $('#cercaLista');
  if (!el) return;
  if (est) est.textContent = state.cerca.length ? `${state.cerca.length} a menos de 500 m` : '';
  el.innerHTML = state.cerca.length
    ? state.cerca.map(p => `<div class="item ${state.roundSel.has(p.userId) ? '' : ''}" data-uid="${p.userId}"
         style="border-color:${state.roundSel.has(p.userId) ? 'var(--oro)' : 'var(--line)'}">
        <div class="item-ico" style="color:${state.roundSel.has(p.userId) ? 'var(--oro)' : 'var(--txt3)'}">
          ${ico(state.roundSel.has(p.userId) ? 'check' : 'persona', 20)}</div>
        <div class="item-cuerpo"><b>${esc(p.nick)}</b><span>${esc(p.place) || 'por ahí'} · a ${GEO.fmtDist(p.distance)}</span></div></div>`).join('')
    : UI.vacio('grupo', 'No hay nadie cerca', 'Que fichen ellos primero y vuelve a intentarlo.');
  el.querySelectorAll('.item').forEach(r => r.onclick = () => {
    const id = r.dataset.uid;
    state.roundSel.has(id) ? state.roundSel.delete(id) : state.roundSel.add(id);
    pintarCerca();
  });
}

async function guardarRonda() {
  if (state.lat == null) return UI.toast('Espera al GPS');
  if (!state.roundSel.size) return UI.toast('Marca al menos a uno');
  try {
    const r = await api('/round', { method: 'POST', body: JSON.stringify({
      drink: state.roundDrink, lat: state.lat, lon: state.lon,
      place: $('#rondaLocal').value.trim(), price: $('#rondaPrecio').value.trim(),
      participants: [...state.roundSel] }) });
    cerrarModal('mdRonda');
    UI.toast(`Ronda de ${r.size} pagada${r.totalCents ? ' · ' + eur(r.totalCents) : ''}`);
    refrescar();
  } catch (e) { UI.toast(e.message); }
}

/* ---------------- ranking ---------------- */
async function cargarRanking() {
  const ev = $('#rankEvento').value;
  const per = ($('.seg-btn.activo[data-period]') || {}).dataset?.period || 'day';
  const q = ev ? `?eventId=${encodeURIComponent(ev)}` : `?period=${per}`;
  const el = $('#rankLista');
  if (!el.dataset.pintado) el.innerHTML = UI.esqueleto(4);
  try {
    const r = await api('/ranking' + q);
    el.innerHTML = r.list.length
      ? r.list.map((x, i) => `<div class="item" style="animation-delay:${i * .04}s">
          <div class="medalla">${i < 3 ? ico('trofeo', 20) : `<span class="n">${i + 1}</span>`}</div>
          <div class="item-cuerpo"><b>${esc(x.nick)}${x.userId === me.userId ? ' (tú)' : ''}</b>
            <span>${x.sessions} ${x.sessions === 1 ? 'sesión' : 'sesiones'} · ${bebida(x.favorite).name}${x.roundsPaid ? ` · ${x.roundsPaid} rondas` : ''}</span></div>
          <div class="item-fin"><span class="num">${x.total}</span><small>copas</small></div></div>`).join('')
      : UI.vacio('trofeo', 'Nada por aquí', 'Aún no hay consumiciones en este periodo.');
    el.dataset.pintado = '1';
  } catch (e) { el.innerHTML = UI.vacio('aviso', 'No se pudo cargar', e.message); }
}
$('#rankSeg').querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
  $('#rankSeg').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('activo'));
  b.classList.add('activo'); $('#rankEvento').value = ''; cargarRanking();
});
$('#rankEvento').onchange = cargarRanking;

/* ---------------- deudas ---------------- */
async function cargarDeudas() {
  const el = $('#deudaLista');
  if (!el.dataset.pintado) el.innerHTML = UI.esqueleto(4);
  try {
    await apiRefresco('/debts?days=90', d => pintarDeudas(d, el));
  } catch (e) { el.innerHTML = UI.vacio('aviso', 'No se pudo cargar', e.message); }
}

function pintarDeudas(d, el) {
  {
    const debo = d.mine.owes.reduce((a, x) => a + x.rounds, 0);
    const deben = d.mine.owed.reduce((a, x) => a + x.rounds, 0);
    const saldo = deben - debo;
    $('#deudaHero').innerHTML = `<div class="hero">
      <div class="hero-ico">${ico(saldo > 0 ? 'corona' : saldo < 0 ? 'monedas' : 'manos', 40)}</div>
      <span class="num">${saldo >= 0 ? '+' : ''}${saldo}</span>
      <div class="hero-sub">${saldo > 0 ? 'rondas a tu favor, que inviten' : saldo < 0 ? 'rondas que debes, ve soltando' : 'estáis en paz, qué aburrido'}</div></div>`;
    el.innerHTML = d.debts.length
      ? d.debts.map(x => {
        const yo = x.fromId === me.userId, mio = x.toId === me.userId;
        return `<div class="item ${yo ? 'debo' : mio ? 'credito' : ''}">
          <div class="item-ico">${ico('monedas', 20)}</div>
          <div class="item-cuerpo"><b>${esc(x.from)} → ${esc(x.to)}</b>
            <span>${x.rounds === 0 ? 'a la par en rondas, pero invitó más caro'
              : (yo ? 'le debes' : mio ? 'te debe' : 'entre ellos') + ` ${x.rounds} ${x.rounds === 1 ? 'ronda' : 'rondas'}`}</span></div>
          <div class="item-fin"><span class="num">${x.cents ? eur(x.cents) : x.rounds}</span>
            <small>${x.cents ? 'diferencia' : 'rondas'}</small></div></div>`;
      }).join('')
      : UI.vacio('manos', 'Nadie debe nada', 'Sospechoso. Que alguien invite.');
    $('#balanceLista').innerHTML = d.balance.length
      ? `<div class="seccion">Balance de generosidad</div>` + d.balance.map(b => `
        <div class="item"><div class="item-ico">${ico(b.balance > 0 ? 'corona' : 'persona', 20)}</div>
          <div class="item-cuerpo"><b>${esc(b.nick)}</b>
            <span>invitó a ${b.given} · le invitaron ${b.received} · ${b.paid} rondas puestas</span></div>
          <div class="item-fin"><span class="num">${b.balance > 0 ? '+' : ''}${b.balance}</span><small>saldo</small></div></div>`).join('')
      : '';
    el.dataset.pintado = '1';
  }
}

/* ---------------- calor ---------------- */
function iniCalor() {
  if (!heatMap) {
    heatMap = L.map('heatmap', { zoomControl: false }).setView(myPos ? [myPos.lat, myPos.lon] : [40.4168, -3.7038], 13);
    TEMA.capaMapa().addTo(heatMap);
    $('#pg-calor').querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
      $('#pg-calor').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('activo'));
      b.classList.add('activo'); cargarCalor(b.dataset.scope);
    });
  }
  setTimeout(() => heatMap.invalidateSize(), 60);
  cargarCalor(($('#pg-calor .seg-btn.activo') || {}).dataset?.scope || 'group');
}
async function cargarCalor(scope) {
  try {
    const d = await api(`/heatmap?days=365&scope=${scope}`);
    if (heatLayer) heatMap.removeLayer(heatLayer);
    const max = Math.max(1, ...d.points.map(p => p.weight));
    if (window.L && L.heatLayer) {
      heatLayer = L.heatLayer(d.points.map(p => [p.lat, p.lon, p.weight / max]), {
        radius: 30, blur: 22, maxZoom: 17,
        gradient: { .2: '#4cc9f0', .45: '#3ddc97', .7: '#ffc93c', 1: '#ff5d7a' }
      }).addTo(heatMap);
    }
    if (d.points.length) heatMap.fitBounds(L.latLngBounds(d.points.map(p => [p.lat, p.lon])).pad(.25), { maxZoom: 15 });
    $('#calorTop').innerHTML = d.top.length
      ? `<div class="seccion">Bares más pisados</div>` + d.top.map((t, i) => `
        <div class="item" data-i="${i}"><div class="medalla"><span class="n">${i + 1}</span></div>
          <div class="item-cuerpo"><b>${esc(t.place)}</b>
            <span>${t.visits} visitas · ${t.people} personas${t.avgPriceCents ? ' · ' + eur(t.avgPriceCents) + ' media' : ''}</span></div>
          <div class="item-fin"><span class="num">${t.drinks}</span><small>copas</small></div></div>`).join('')
      : UI.vacio('fuego', 'Sin historial', 'Ficha unas cuantas veces y aquí verás vuestros sitios.');
    $('#calorTop').querySelectorAll('.item').forEach(r => r.onclick = () => {
      const p = d.points.find(x => x.place === d.top[+r.dataset.i].place);
      if (p) heatMap.setView([p.lat, p.lon], 17);
    });
  } catch (e) { $('#calorTop').innerHTML = UI.vacio('aviso', 'No se pudo cargar', e.message); }
}

/* ---------------- eventos ---------------- */
async function cargarEventos() {
  try {
    const list = await api('/events');
    const act = list.find(e => e.active);
    $('#chipEvento').classList.toggle('hidden', !act);
    if (act) $('#chipEvento').textContent = act.name;
    const sel = $('#rankEvento');
    if (sel) sel.innerHTML = `<option value="">Sin evento</option>` +
      list.map(e => `<option value="${e.id}">${esc(e.name)}${e.active ? ' (en curso)' : ''}</option>`).join('');
    const el = $('#evLista');
    if (el) el.innerHTML = list.length
      ? list.map(e => `<div class="item" data-id="${e.id}">
          <div class="item-ico">${ico('calendario', 20)}</div>
          <div class="item-cuerpo"><b>${esc(e.name)}</b>
            <span>${fmtFecha(e.startsMs)} → ${fmtFecha(e.endsMs)} · por ${esc(e.createdByNick)}</span></div>
          <div class="item-fin">${e.active ? ico('rayo', 18) : ''}</div></div>`).join('')
      : UI.vacio('calendario', 'Sin eventos', 'Crea uno para la próxima feria o despedida.');
    if (el) el.querySelectorAll('.item').forEach(r => r.onclick = () => {
      location.hash = '#/ranking';
      setTimeout(() => { $('#rankEvento').value = r.dataset.id; cargarRanking(); }, 60);
    });
  } catch {}
}
const evSave = $('#ev-save');
if (evSave) evSave.onclick = async () => {
  const name = $('#ev-name').value.trim(), s = $('#ev-start').value, e = $('#ev-end').value;
  if (!name || !s || !e) return UI.toast('Nombre y fechas');
  try {
    await api('/events', { method: 'POST', body: JSON.stringify({ name, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() }) });
    $('#ev-name').value = ''; UI.toast('Evento creado'); cargarEventos();
  } catch (err) { UI.toast(err.message); }
};

/* ---------------- perfil ---------------- */
function pintarPerfil() {
  pintarTema();
  pintarBotonTema();
  const m = ultimos.me;
  $('#mnu-nick').value = me.nick; $('#mnu-group').value = me.groupId;
  if (!m) return;
  $('#perfilStats').innerHTML = `
    <div class="hero"><div class="hero-ico">${ico('jarra', 40)}</div>
      <span class="num">${m.today}</span>
      <div class="hero-sub">consumiciones hoy${m.streak > 1 ? ` · racha de ${m.streak} días` : ''}</div></div>
    <div class="card card-sm">
      <div class="stat"><span>${ico('calendario', 18)} Esta semana</span><b>${m.week}</b></div>
      <div class="stat"><span>${ico('calendario', 18)} Este mes</span><b>${m.month}</b></div>
      <div class="stat"><span>${ico('cana', 18)} Media diaria</span><b>${m.avg30}</b></div>
      <div class="stat"><span>${ico(bebida(m.favorite).ico, 18)} Tu favorita</span><b>${bebida(m.favorite).name}</b></div>
      <div class="stat"><span>${ico('pin', 18)} Bar top</span><b>${esc(m.topPlace) || '—'}</b></div>
      ${m.spentCents ? `<div class="stat"><span>${ico('monedas', 18)} Gastado hoy</span><b>${eur(m.spentCents)}</b></div>` : ''}
    </div>`;
}
$('#mnu-save').onclick = async () => {
  try {
    me = await api('/me', { method: 'POST', body: JSON.stringify({ nick: $('#mnu-nick').value.trim(), groupId: $('#mnu-group').value.trim().toLowerCase() }) });
    $('#chipGrupo').textContent = me.groupId;
    markers.forEach(mk => map && map.removeLayer(mk)); markers.clear();
    UI.toast('Guardado'); refrescar(); cargarEventos();
  } catch (e) { UI.toast(e.message); }
};
$('#btnCasa').onclick = async () => {
  try { await api('/home', { method: 'POST' }); UI.toast('Avisados. Descansa'); refrescar(); }
  catch (e) { UI.toast(e.message); }
};
$('#btnCerrarNoche').onclick = async () => {
  try { await api('/checkin', { method: 'DELETE' }); UI.toast('Fuera del mapa'); refrescar(); }
  catch (e) { UI.toast(e.message); }
};
$('#btnTour').onclick = () => UI.tour({ forzar: true });

/* ---------------- tema ---------------- */
function pintarTema() {
  const m = TEMA.modo();
  const cont = $('#temaSel');
  if (!cont) return;
  const ops = [
    { id: 'claro', ico: 'sol', txt: 'Claro' },
    { id: 'oscuro', ico: 'luna', txt: 'Oscuro' },
    { id: 'auto', ico: 'automatico', txt: 'Automático' }
  ];
  cont.innerHTML = ops.map(o => `<div class="tema-op ${m === o.id ? 'sel' : ''}" data-t="${o.id}">
    ${ico(o.ico, 24)}<span>${o.txt}</span></div>`).join('');
  cont.querySelectorAll('.tema-op').forEach(el => el.onclick = () => {
    TEMA.set(el.dataset.t);
    pintarTema();
    pintarBotonTema();
    UI.toast(el.dataset.t === 'auto' ? 'Tema automático, sigue al sistema' : `Tema ${el.dataset.t}`);
  });
  const t = $('#temaTxt');
  if (t) t.textContent = m === 'auto'
    ? `Sigue al sistema (ahora: ${TEMA.efectivo()})`
    : `Siempre en ${m}`;
}

function pintarBotonTema() {
  const b = $('#btnTema');
  if (b) b.innerHTML = ico(TEMA.efectivo() === 'oscuro' ? 'sol' : 'luna', 19);
}

const btnTema = $('#btnTema');
if (btnTema) btnTema.onclick = () => {
  TEMA.alternar();
  pintarBotonTema();
  pintarTema();
};
TEMA.alCambiar(() => { pintarBotonTema(); });

/* ---------------- notificaciones ---------------- */
$('#notifSw').onchange = async e => {
  if (e.target.checked) {
    const p = await Notification.requestPermission();
    notifOn = p === 'granted'; e.target.checked = notifOn;
    if (!notifOn) UI.toast('El navegador ha bloqueado los avisos');
  } else notifOn = false;
  localStorage.setItem('birramap_notif', notifOn ? '1' : '0');
  estadoNotif();
};
function estadoNotif() {
  const p = typeof Notification !== 'undefined' ? Notification.permission : 'no';
  $('#notifTxt').textContent = p === 'no' ? 'Tu navegador no soporta avisos.'
    : notifOn ? 'Activado: te avisamos si alguien ficha a menos de 500 m.'
    : 'Desactivado. Actívalo y no te perderás una ronda.';
}
function proximidad(activos) {
  const primera = vistos.size === 0;
  activos.forEach(c => {
    const k = c.userId + '_' + c.tsMs;
    const nuevo = !vistos.has(k);
    vistos.add(k);
    if (primera || !nuevo || !notifOn || !myPos || c.userId === me.userId) return;
    if ((myPos.accuracy || 0) > 300) return;
    const d = GEO.distancia(myPos.lat, myPos.lon, c.lat, c.lon);
    if (d > NOTIF_RADIO) return;
    avisar(`${c.nick} está a ${GEO.fmtDist(d)}`, `${bebida(c.drink).name} en ${c.place || 'por ahí'}`);
  });
  if (vistos.size > 400) vistos = new Set([...vistos].slice(-200));
}
function avisar(t, b) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const o = { body: b, icon: '/icons/icon-192.png', tag: 'birramap', data: { url: '/#/mapa' } };
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification(t, o)).catch(() => new Notification(t, o));
  else new Notification(t, o);
}

/* ---------------- varios ---------------- */
$('#asa').onclick = () => $('#hoja').classList.toggle('abierta');
$('#btnMenu').onclick = () => { location.hash = '#/perfil'; };
document.addEventListener('click', e => {
  const c = e.target.closest && e.target.closest('[data-cerrar]');
  if (c) cerrarModal(c.dataset.cerrar);
  if (e.target.classList && e.target.classList.contains('modal')) e.target.classList.add('hidden');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) refrescar(); });

/* service worker: si hay versión nueva, se recarga sola */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          sw.postMessage('skipWaiting');
          UI.toast('Actualizando a la versión nueva…');
          setTimeout(() => location.reload(), 900);
        }
      });
    });
  }).catch(() => {});
}
