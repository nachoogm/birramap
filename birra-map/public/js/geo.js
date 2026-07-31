/* ============================================================
   BirraMap · Geolocalización
   ============================================================
   POR QUÉ FALLABA EN IPHONE:

   1. LA REGLA DEL GESTO. Safari en iOS solo atiende la petición de
      ubicación si sale DIRECTAMENTE del toque del usuario. Basta un
      `await` por delante (aunque tarde 1 ms) para que iOS dé el gesto
      por gastado y NO llame ni al éxito ni al error. Silencio total:
      sin mensaje, sin timeout, sin nada. Por eso "no pasaba nada".
      → Aquí la llamada al GPS es la PRIMERA línea que se ejecuta.

   2. watchPosition solo, a veces no arranca en iOS. Lanzamos
      getCurrentPosition Y watchPosition a la vez: el que conteste antes.

   3. Con enableHighAccuracy:true dentro de un edificio iOS puede no
      responder jamás. A los 3,5 s se lanza un intento de baja precisión
      en paralelo, que casi siempre contesta al instante.

   4. Pase lo que pase, SIEMPRE hay salida manual: colocar el punto a mano.
   ============================================================ */

const GEO = (() => {

  const PRECISION = { excelente: 20, buena: 50, aceptable: 150, mala: 600 };
  const OPCIONES = { objetivo: 35, esperaMax: 17000, esperaMin: 900, guardian: 3500 };

  const ua = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const esIOS = () => /iPad|iPhone|iPod/.test(ua()) ||
    (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const esAndroid = () => /Android/.test(ua());
  const esPWA = () => typeof window !== 'undefined' &&
    ((window.navigator && window.navigator.standalone === true) ||
     (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  const hayGeo = () => typeof navigator !== 'undefined' && !!navigator.geolocation;
  const esSeguro = () => typeof window === 'undefined' || window.isSecureContext !== false;

  function calidad(m) {
    if (m == null || !isFinite(m)) return { nivel: 'desconocida', txt: 'sin datos', usable: false, color: '#6a80ac', pct: 0 };
    const pct = Math.max(5, Math.min(100, Math.round(100 - (Math.log10(Math.max(m, 5)) / Math.log10(5000)) * 100)));
    if (m <= PRECISION.excelente) return { nivel: 'excelente', txt: `±${Math.round(m)} m`, usable: true, color: '#3ddc97', pct };
    if (m <= PRECISION.buena) return { nivel: 'buena', txt: `±${Math.round(m)} m`, usable: true, color: '#8ede4f', pct };
    if (m <= PRECISION.aceptable) return { nivel: 'aceptable', txt: `±${Math.round(m)} m`, usable: true, color: '#ffc93c', pct };
    if (m <= PRECISION.mala) return { nivel: 'mala', txt: `±${Math.round(m)} m · puede no ser tu bar`, usable: true, color: '#ff9f43', pct };
    return { nivel: 'pesima', txt: `±${(m / 1000).toFixed(1)} km · es la antena, no el GPS`, usable: false, color: '#ff5d7a', pct };
  }

  function esMejor(n, a) {
    if (!n) return false;
    if (!a) return true;
    if (n.accuracy < a.accuracy) return true;
    if (n.accuracy === a.accuracy && n.timestamp > a.timestamp) return true;
    if (a.timestamp && (n.timestamp - a.timestamp) > 30000 && n.accuracy < a.accuracy * 2) return true;
    return false;
  }

  function suficiente(pos, ms, o = OPCIONES) {
    if (!pos) return false;
    if (ms < o.esperaMin) return false;
    if (pos.accuracy <= o.objetivo) return true;
    if (ms >= o.esperaMax) return true;
    return false;
  }

  function explicarError(err, ctx = {}) {
    const code = err && err.code;
    const ios = ctx.ios !== undefined ? ctx.ios : esIOS();
    const pwa = ctx.pwa !== undefined ? ctx.pwa : esPWA();

    if (code === 1) return {
      titulo: 'Ubicación bloqueada',
      texto: ios
        ? 'Tienes el permiso desactivado en los ajustes del iPhone.'
        : 'Tienes el permiso de ubicación bloqueado en el navegador.',
      pasos: ios
        ? ['Abre Ajustes del iPhone',
           'Privacidad y seguridad → Localización',
           'Comprueba que el interruptor de arriba está activado',
           pwa ? 'Busca BirraMap en la lista' : 'Busca Safari en la lista',
           'Elige "Al usar la app"',
           'Activa "Ubicación precisa" (importante)',
           'Vuelve a BirraMap y prueba otra vez']
        : ['Toca el candado de la barra de direcciones',
           'Permisos → Ubicación',
           'Selecciona Permitir',
           'Recarga la página'],
      recuperable: true, codigo: 1
    };

    if (code === 2) return {
      titulo: 'No se encuentra la señal',
      texto: 'Pasa en sótanos y sitios con paredes gruesas.',
      pasos: ['Acércate a una ventana o sal a la puerta',
              'Comprueba que la ubicación del móvil está encendida',
              'Desactiva el ahorro de energía'],
      recuperable: true, codigo: 2
    };

    if (code === 3) return {
      titulo: 'El GPS tarda demasiado',
      texto: ios ? 'En iPhone suele ser que "Ubicación precisa" está desactivada.' : 'Dentro de un bar puede costar.',
      pasos: ios ? ['Ajustes → Privacidad y seguridad → Localización', 'Safari (o BirraMap) → Ubicación precisa: activada']
                 : ['Prueba otra vez', 'O coloca el punto a mano'],
      recuperable: true, codigo: 3
    };

    if (code === 'silencio') return {
      titulo: ios ? 'Safari no ha respondido' : 'El navegador no ha respondido',
      texto: ios
        ? 'iOS no ha contestado a la petición. Casi siempre el permiso está en "Nunca".'
        : 'No ha llegado respuesta del sistema de ubicación.',
      pasos: ios
        ? ['Ajustes → Privacidad y seguridad → Localización',
           'Activa el interruptor general',
           pwa ? 'Busca BirraMap' : 'Busca Safari',
           'Ponlo en "Al usar la app" y activa "Ubicación precisa"']
        : ['Comprueba los permisos del navegador', 'Recarga la página'],
      recuperable: true, codigo: 'silencio'
    };

    if (code === 'inseguro') return {
      titulo: 'Hace falta HTTPS',
      texto: 'La ubicación solo funciona en conexiones seguras.',
      pasos: [], recuperable: false, codigo: 'inseguro'
    };

    return {
      titulo: 'Sin ubicación',
      texto: 'No se ha podido localizar, pero puedes colocar el punto a mano.',
      pasos: [], recuperable: true, codigo: 0
    };
  }

  function distancia(la1, lo1, la2, lo2) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLa = r(la2 - la1), dLo = r(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(dLo / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }
  const fmtDist = m => m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  const mismoSitio = (d, pa = 0, pb = 0, margen = 60) => d <= (margen + (pa || 0) + (pb || 0));

  async function permiso() {
    try {
      if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return 'desconocido';
      return (await navigator.permissions.query({ name: 'geolocation' })).state;
    } catch { return 'desconocido'; }
  }

  /* =========================================================
     ⚠️ SÍNCRONA A PROPÓSITO. Llámala como PRIMERA instrucción
     dentro del onclick. Ni un await antes.
     ========================================================= */
  function pedirUbicacion({ onProgreso = null, onAviso = null, opts = {} } = {}) {
    const cfg = { ...OPCIONES, ...opts };
    let resolver, rechazar;
    const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });

    if (!hayGeo()) { rechazar(Object.assign(new Error('sin-soporte'), { explicado: explicarError({ code: 0 }) })); return { promesa, cancelar() {} }; }
    if (!esSeguro()) { rechazar(Object.assign(new Error('inseguro'), { explicado: explicarError({ code: 'inseguro' }) })); return { promesa, cancelar() {} }; }

    const t0 = Date.now();
    let mejor = null, intentos = 0, acabado = false, primerError = null;
    let idWatch = null, idBaja = null, tGuard = null, tMax = null;

    const limpiar = () => {
      [idWatch, idBaja].forEach(id => { if (id !== null) { try { navigator.geolocation.clearWatch(id); } catch {} } });
      idWatch = idBaja = null;
      clearTimeout(tGuard); clearTimeout(tMax);
    };

    const terminar = (ok, err) => {
      if (acabado) return;
      acabado = true; limpiar();
      if (ok && mejor) resolver({
        lat: mejor.latitude, lon: mejor.longitude, accuracy: mejor.accuracy,
        calidad: calidad(mejor.accuracy), intentos, ms: Date.now() - t0, manual: false
      });
      else rechazar(Object.assign(new Error('geo'), { explicado: explicarError(err || primerError || { code: 'silencio' }) }));
    };

    const recibir = p => {
      if (acabado || !p || !p.coords) return;
      intentos++;
      const c = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp || Date.now() };
      if (esMejor(c, mejor)) {
        mejor = c;
        if (onProgreso) { try { onProgreso({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy }, calidad(c.accuracy), intentos); } catch {} }
      }
      if (suficiente(mejor, Date.now() - t0, cfg)) terminar(true);
    };

    const fallo = e => {
      if (!primerError) primerError = e;
      /* un error de permiso corta ya: no tiene arreglo esperando */
      if (e && e.code === 1) return terminar(false, e);
      if (!mejor && !acabado) { /* esperamos al guardián por si el otro canal responde */ }
    };

    /* ---- LLAMADAS SÍNCRONAS, sin nada por delante ---- */
    try {
      /* dos canales a la vez: el que conteste primero */
      navigator.geolocation.getCurrentPosition(recibir, fallo,
        { enableHighAccuracy: true, timeout: cfg.esperaMax, maximumAge: 0 });
      idWatch = navigator.geolocation.watchPosition(recibir, fallo,
        { enableHighAccuracy: true, timeout: cfg.esperaMax, maximumAge: 0 });
    } catch (e) {
      terminar(false, { code: 0 });
      return { promesa, cancelar: limpiar };
    }

    /* ---- plan B si iOS se queda mudo ---- */
    tGuard = setTimeout(() => {
      if (acabado || mejor) return;
      if (onAviso) { try { onAviso('El GPS tarda… probando otra vía'); } catch {} }
      try {
        navigator.geolocation.getCurrentPosition(recibir, () => {},
          { enableHighAccuracy: false, timeout: cfg.esperaMax, maximumAge: 120000 });
        idBaja = navigator.geolocation.watchPosition(recibir, () => {},
          { enableHighAccuracy: false, timeout: cfg.esperaMax, maximumAge: 120000 });
      } catch {}
    }, cfg.guardian);

    tMax = setTimeout(() => { mejor ? terminar(true) : terminar(false, primerError || { code: 'silencio' }); }, cfg.esperaMax);

    return { promesa, cancelar: () => { limpiar(); acabado = true; } };
  }

  /* Provoca el diálogo del permiso cuanto antes, dentro de un gesto */
  function calentar() {
    if (!hayGeo()) return;
    try { navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 }); } catch {}
  }

  function seguir(onPos, onErr = null) {
    if (!hayGeo()) return null;
    let mejor = null;
    try {
      return navigator.geolocation.watchPosition(
        p => {
          const c = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp || Date.now() };
          if (esMejor(c, mejor)) { mejor = c; onPos({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, ts: c.timestamp }); }
        },
        e => { if (onErr) onErr(explicarError(e)); },
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 15000 });
    } catch { return null; }
  }

  const diagnostico = () => ({
    soportado: hayGeo(), seguro: esSeguro(), ios: esIOS(), android: esAndroid(),
    pwa: esPWA(), protocolo: typeof location !== 'undefined' ? location.protocol : '?'
  });

  return {
    PRECISION, OPCIONES, calidad, esMejor, suficiente, explicarError,
    distancia, fmtDist, mismoSitio, esIOS, esAndroid, esPWA, hayGeo, esSeguro,
    permiso, pedirUbicacion, calentar, seguir, diagnostico
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GEO;
