/* ============================================================
   BirraMap · Geolocalización v3 — con los arreglos para iPhone
   ============================================================

   POR QUÉ FALLABA EN IPHONE (y no en Android):

   1. LA REGLA DEL GESTO. Safari en iOS solo deja pedir la ubicación
      si la llamada sale DIRECTAMENTE del toque del usuario. Si antes
      hay un `await` (aunque sea de un milisegundo), iOS considera que
      el gesto ya se ha "gastado" y NO llama ni al success ni al error:
      se queda callado para siempre. La versión anterior tenía
      `async function locate()` con awaits antes → silencio absoluto.
      Aquí la llamada al GPS es lo PRIMERO que se ejecuta, sin await.

   2. EL CUELGUE SILENCIOSO. Con enableHighAccuracy:true y maximumAge:0,
      dentro de un edificio iOS puede no responder nunca, ni siquiera con
      timeout. Por eso hay un "perro guardián": si a los 4 s no ha llegado
      nada, se lanza en paralelo un segundo intento con precisión baja.

   3. permissions.query. En Safari puede lanzar excepción o mentir.
      Se usa solo como pista, nunca para decidir.
   ============================================================ */

const GEO = (() => {

  const PRECISION = { excelente: 20, buena: 50, aceptable: 150, mala: 600 };

  const OPCIONES = {
    objetivo: 35,
    esperaMax: 18000,
    esperaMin: 1000,
    guardian: 4000      // si iOS no dice nada en 4 s, plan B
  };

  /* ---------------- detección de plataforma ---------------- */
  const ua = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const esIOS = () => /iPad|iPhone|iPod/.test(ua()) ||
    (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const esSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(ua());
  const esPWA = () => typeof window !== 'undefined' &&
    ((window.navigator && window.navigator.standalone === true) ||
     (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  const hayGeo = () => typeof navigator !== 'undefined' && !!navigator.geolocation;
  const esSeguro = () => typeof window === 'undefined' || window.isSecureContext !== false;

  /* ---------------- calidad ---------------- */
  function calidad(m) {
    if (m == null || !isFinite(m)) return { nivel: 'desconocida', em: '❓', txt: 'sin datos', usable: false, color: '#93a7cf' };
    if (m <= PRECISION.excelente) return { nivel: 'excelente', em: '🎯', txt: `±${Math.round(m)} m`, usable: true, color: '#39d98a' };
    if (m <= PRECISION.buena) return { nivel: 'buena', em: '✅', txt: `±${Math.round(m)} m`, usable: true, color: '#8ede4f' };
    if (m <= PRECISION.aceptable) return { nivel: 'aceptable', em: '🟡', txt: `±${Math.round(m)} m`, usable: true, color: '#f5b301' };
    if (m <= PRECISION.mala) return { nivel: 'mala', em: '🟠', txt: `±${Math.round(m)} m · puede no ser tu bar`, usable: true, color: '#ff9f43' };
    return { nivel: 'pesima', em: '🔴', txt: `±${(m / 1000).toFixed(1)} km · es la antena, no el GPS`, usable: false, color: '#ff6b7a' };
  }

  function esMejor(nueva, actual) {
    if (!nueva) return false;
    if (!actual) return true;
    if (nueva.accuracy < actual.accuracy) return true;
    if (nueva.accuracy === actual.accuracy && nueva.timestamp > actual.timestamp) return true;
    if (actual.timestamp && (nueva.timestamp - actual.timestamp) > 30000 && nueva.accuracy < actual.accuracy * 2) return true;
    return false;
  }

  function suficiente(pos, transcurrido, opts = OPCIONES) {
    if (!pos) return false;
    if (transcurrido < opts.esperaMin) return false;
    if (pos.accuracy <= opts.objetivo) return true;
    if (transcurrido >= opts.esperaMax) return true;
    return false;
  }

  /* ---------------- errores en cristiano ---------------- */
  function explicarError(err, ctx = {}) {
    const code = err && err.code;
    const ios = ctx.ios !== undefined ? ctx.ios : esIOS();
    const pwa = ctx.pwa !== undefined ? ctx.pwa : esPWA();

    if (code === 1) {
      return {
        titulo: 'Ubicación bloqueada',
        texto: ios
          ? (pwa
            ? 'Ajustes → Privacidad y seguridad → Localización → busca BirraMap en la lista → "Al usar la app". Comprueba también que "Ubicación precisa" esté activada.'
            : 'Ajustes → Apps → Safari → Ubicación → "Preguntar" o "Permitir". Y en Ajustes → Privacidad y seguridad → Localización → Safari, activa "Ubicación precisa".')
          : 'Toca el candado 🔒 de la barra de direcciones → Permisos → Ubicación → Permitir. Después recarga la página.',
        pasos: ios
          ? ['Abre Ajustes del iPhone', 'Privacidad y seguridad → Localización', 'Comprueba que está activada arriba del todo', pwa ? 'Busca BirraMap en la lista' : 'Busca Safari en la lista', 'Elige "Al usar la app"', 'Activa "Ubicación precisa"', 'Vuelve y prueba otra vez']
          : ['Toca el candado en la barra de direcciones', 'Permisos → Ubicación', 'Selecciona Permitir', 'Recarga la página'],
        recuperable: true, codigo: 1
      };
    }
    if (code === 2) {
      return {
        titulo: 'No se encuentra la señal',
        texto: 'Pasa dentro de sitios cerrados con paredes gruesas. Acércate a una ventana o sal un momento a la puerta. Mientras, puedes poner el punto a mano.',
        pasos: ['Acércate a una ventana o sal fuera', 'Comprueba que la ubicación del móvil está encendida', 'Desactiva el modo de ahorro de energía'],
        recuperable: true, codigo: 2
      };
    }
    if (code === 3) {
      return {
        titulo: 'El GPS tarda demasiado',
        texto: ios
          ? 'En iPhone suele ser porque "Ubicación precisa" está desactivada. Míralo en Ajustes → Privacidad → Localización.'
          : 'Dentro de un bar puede costar. Prueba otra vez o coloca el punto a mano.',
        pasos: ios ? ['Ajustes → Privacidad y seguridad → Localización', 'Activa "Ubicación precisa"', 'Prueba de nuevo'] : ['Prueba otra vez', 'O coloca el punto a mano en el mapa'],
        recuperable: true, codigo: 3
      };
    }
    if (code === 'silencio') {
      return {
        titulo: 'Safari no responde',
        texto: 'iOS no ha contestado a la petición de ubicación. Casi siempre es que el permiso está en "Nunca" o que la app se abrió desde un enlace raro. Coloca el punto a mano y revisa los Ajustes cuando puedas.',
        pasos: ['Ajustes → Privacidad y seguridad → Localización', 'Activa la localización general', pwa ? 'Busca BirraMap' : 'Busca Safari', 'Ponlo en "Al usar la app"'],
        recuperable: true, codigo: 'silencio'
      };
    }
    if (code === 'inseguro') {
      return {
        titulo: 'Hace falta HTTPS',
        texto: 'La ubicación solo funciona en conexiones seguras. Entra por https://',
        pasos: [], recuperable: false, codigo: 'inseguro'
      };
    }
    return {
      titulo: 'Sin ubicación',
      texto: 'No se ha podido localizar. Puedes colocar el punto a mano en el mapa.',
      pasos: [], recuperable: true, codigo: 0
    };
  }

  /* ---------------- distancias ---------------- */
  function distancia(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }
  const fmtDist = m => m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  function mismoSitio(d, pa = 0, pb = 0, margen = 60) { return d <= (margen + (pa || 0) + (pb || 0)); }

  /* ---------------- permiso (solo informativo) ---------------- */
  async function permiso() {
    try {
      if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return 'desconocido';
      const p = await navigator.permissions.query({ name: 'geolocation' });
      return p.state;
    } catch { return 'desconocido'; }
  }

  /* =========================================================
     LO IMPORTANTE: esta función es SÍNCRONA.
     Llámala directamente dentro del onclick, sin await antes.
     Devuelve un objeto con .promesa y .cancelar()
     ========================================================= */
  function pedirUbicacion({ onProgreso = null, onAviso = null, opts = {} } = {}) {
    const cfg = { ...OPCIONES, ...opts };
    let resolver, rechazar;
    const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });

    if (!hayGeo()) {
      rechazar(Object.assign(new Error('sin-soporte'), { explicado: explicarError({ code: 0 }) }));
      return { promesa, cancelar() {} };
    }
    if (!esSeguro()) {
      rechazar(Object.assign(new Error('inseguro'), { explicado: explicarError({ code: 'inseguro' }) }));
      return { promesa, cancelar() {} };
    }

    const t0 = Date.now();
    let mejor = null, intentos = 0, acabado = false;
    let idAlta = null, idBaja = null;
    let tGuardian = null, tMax = null;

    const limpiar = () => {
      if (idAlta !== null) { try { navigator.geolocation.clearWatch(idAlta); } catch {} idAlta = null; }
      if (idBaja !== null) { try { navigator.geolocation.clearWatch(idBaja); } catch {} idBaja = null; }
      clearTimeout(tGuardian); clearTimeout(tMax);
    };

    const terminar = (ok, err) => {
      if (acabado) return;
      acabado = true;
      limpiar();
      if (ok && mejor) {
        resolver({
          lat: mejor.latitude, lon: mejor.longitude, accuracy: mejor.accuracy,
          calidad: calidad(mejor.accuracy), intentos, ms: Date.now() - t0,
          manual: false
        });
      } else {
        rechazar(Object.assign(new Error('geo'), { explicado: explicarError(err || { code: 'silencio' }) }));
      }
    };

    const recibir = p => {
      intentos++;
      const c = {
        latitude: p.coords.latitude, longitude: p.coords.longitude,
        accuracy: p.coords.accuracy, timestamp: p.timestamp || Date.now()
      };
      if (esMejor(c, mejor)) {
        mejor = c;
        if (onProgreso) { try { onProgreso({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy }, calidad(c.accuracy), intentos); } catch {} }
      }
      if (suficiente(mejor, Date.now() - t0, cfg)) terminar(true);
    };

    const fallo = e => { if (!mejor && !acabado) terminar(false, e); };

    /* ---- 1er intento: alta precisión. SÍNCRONO, sin nada antes ---- */
    try {
      idAlta = navigator.geolocation.watchPosition(recibir, fallo,
        { enableHighAccuracy: true, timeout: cfg.esperaMax, maximumAge: 0 });
    } catch (e) {
      terminar(false, { code: 0 });
      return { promesa, cancelar: limpiar };
    }

    /* ---- perro guardián: iOS puede quedarse mudo ---- */
    tGuardian = setTimeout(() => {
      if (acabado || mejor) return;
      if (onAviso) { try { onAviso('El GPS tarda… probando otra vía'); } catch {} }
      /* Plan B: precisión baja y aceptando caché. Suele responder al instante. */
      try {
        idBaja = navigator.geolocation.watchPosition(recibir, () => {},
          { enableHighAccuracy: false, timeout: cfg.esperaMax, maximumAge: 60000 });
      } catch {}
    }, cfg.guardian);

    /* ---- corte final ---- */
    tMax = setTimeout(() => {
      if (mejor) terminar(true);
      else terminar(false, { code: 'silencio' });
    }, cfg.esperaMax);

    return { promesa, cancelar: () => { limpiar(); acabado = true; } };
  }

  /* Calentamiento: en iOS conviene que la primera petición ocurra
     en un gesto, aunque sea para que salga el diálogo del permiso. */
  function calentar() {
    if (!hayGeo()) return;
    try {
      navigator.geolocation.getCurrentPosition(() => {}, () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
    } catch {}
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
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 15000 }
      );
    } catch { return null; }
  }

  /* Diagnóstico del entorno, para la pantalla de ayuda */
  function diagnostico() {
    return {
      soportado: hayGeo(),
      seguro: esSeguro(),
      ios: esIOS(),
      safari: esSafari(),
      pwa: esPWA(),
      protocolo: typeof location !== 'undefined' ? location.protocol : '?'
    };
  }

  return {
    PRECISION, OPCIONES,
    calidad, esMejor, suficiente, explicarError, distancia, fmtDist, mismoSitio,
    esIOS, esSafari, esPWA, hayGeo, esSeguro, permiso,
    pedirUbicacion, calentar, seguir, diagnostico
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GEO;
