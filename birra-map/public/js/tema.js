/* ============================================================
   BirraMap · temas claro / oscuro / automático
   ============================================================
   El tema se aplica poniendo data-tema en <html>. Todo el color
   sale de variables CSS, así que el cambio es instantáneo.

   "auto" sigue la preferencia del sistema y reacciona si cambia
   (por ejemplo, con el modo noche programado del móvil).
   ============================================================ */

const TEMA = (() => {

  const KEY = 'birramap_tema';
  const MODOS = ['auto', 'claro', 'oscuro'];

  /* Teselas distintas por tema: dark_all y light_all de CartoDB.
     Ambas gratis y sin clave. */
  const TILES = {
    oscuro: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    claro:  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  };

  const COLOR_BARRA = { oscuro: '#0d1628', claro: '#f4f7fd' };

  const oyentes = new Set();
  let mq = null;

  const sistemaPrefiereOscuro = () => {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return true; }
  };

  /** Modo guardado: 'auto' | 'claro' | 'oscuro' */
  function modo() {
    try {
      const v = localStorage.getItem(KEY);
      return MODOS.includes(v) ? v : 'auto';
    } catch { return 'auto'; }
  }

  /** Tema efectivo: 'claro' | 'oscuro' (resuelve el auto) */
  function efectivo(m = modo()) {
    if (m === 'claro' || m === 'oscuro') return m;
    return sistemaPrefiereOscuro() ? 'oscuro' : 'claro';
  }

  /** Aplica el tema al documento */
  function aplicar(m = modo(), { avisar = true } = {}) {
    const t = efectivo(m);
    const raiz = document.documentElement;
    raiz.setAttribute('data-tema', t);
    raiz.style.colorScheme = t === 'oscuro' ? 'dark' : 'light';

    /* la barra del navegador en el móvil también cambia */
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = COLOR_BARRA[t];

    if (avisar) oyentes.forEach(f => { try { f(t, m); } catch {} });
    return t;
  }

  /** Guarda y aplica */
  function set(m) {
    if (!MODOS.includes(m)) m = 'auto';
    try { localStorage.setItem(KEY, m); } catch {}
    return aplicar(m);
  }

  /** Rota entre claro y oscuro (para el botón rápido de la barra) */
  function alternar() {
    return set(efectivo() === 'oscuro' ? 'claro' : 'oscuro');
  }

  /** Suscribirse a cambios: cb(temaEfectivo, modo) */
  function alCambiar(cb) { oyentes.add(cb); return () => oyentes.delete(cb); }

  /** URL de teselas para el tema actual */
  const urlTiles = (t = efectivo()) => TILES[t] || TILES.oscuro;

  /** Capa de Leaflet que se repinta sola al cambiar de tema */
  function capaMapa() {
    if (typeof L === 'undefined') return null;
    const capa = L.tileLayer(urlTiles(), {
      maxZoom: 20, subdomains: 'abcd',
      attribution: '© OpenStreetMap © CARTO'
    });
    alCambiar(t => { try { capa.setUrl(urlTiles(t)); } catch {} });
    return capa;
  }

  /** Arranque: aplica y escucha al sistema si estamos en auto */
  function iniciar() {
    aplicar(modo(), { avisar: false });
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      const alSistema = () => { if (modo() === 'auto') aplicar('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', alSistema);
      else if (mq.addListener) mq.addListener(alSistema);
    } catch {}
  }

  return { KEY, MODOS, modo, efectivo, aplicar, set, alternar, alCambiar, urlTiles, capaMapa, iniciar };
})();

/* Se aplica cuanto antes para que no haya destello blanco al cargar */
if (typeof document !== 'undefined') TEMA.iniciar();

if (typeof module !== 'undefined' && module.exports) module.exports = TEMA;
