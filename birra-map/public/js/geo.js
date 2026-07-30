/* ===================== BirraMap · geolocalización =====================
   El problema del móvil: el navegador NO da una posición, da varias, y las
   primeras son malísimas. La primera suele venir de la antena de móvil o del
   wifi, con un error de 1-5 km. El GPS de verdad tarda entre 5 y 30 segundos.

   Si coges la primera (que es lo que hacía getCurrentPosition), acabas fichando
   en un bar que está a tres calles. Este módulo escucha varias posiciones y se
   queda con la mejor, enseñándote siempre la precisión real.
   ==================================================================== */

const GEO = (() => {

  /* Umbrales de precisión, en metros */
  const PRECISION = {
    excelente: 20,    // GPS fino: sabes en qué terraza estás
    buena: 50,        // vale para fichar
    aceptable: 150,   // el bar correcto, probablemente
    mala: 600         // por encima de esto es la antena, no el GPS
  };

  const OPCIONES = {
    objetivo: 40,        // si bajamos de aquí, paramos de esperar
    esperaMax: 20000,    // 20 s como mucho buscando
    esperaMin: 1200,     // margen para que llegue al menos un segundo fix
    maxEdad: 0           // nunca posiciones cacheadas: en el móvil mienten
  };

  /* ---------- lógica pura (testeable) ---------- */

  /** Etiqueta legible para una precisión en metros */
  function calidad(metros) {
    if (metros == null || !isFinite(metros)) return { nivel: 'desconocida', em: '❓', txt: 'precisión desconocida', usable: false };
    if (metros <= PRECISION.excelente) return { nivel: 'excelente', em: '🎯', txt: `±${Math.round(metros)} m`, usable: true };
    if (metros <= PRECISION.buena) return { nivel: 'buena', em: '✅', txt: `±${Math.round(metros)} m`, usable: true };
    if (metros <= PRECISION.aceptable) return { nivel: 'aceptable', em: '🟡', txt: `±${Math.round(metros)} m`, usable: true };
    if (metros <= PRECISION.mala) return { nivel: 'mala', em: '🟠', txt: `±${Math.round(metros)} m — puede que no sea tu bar`, usable: true };
    return { nivel: 'pesima', em: '🔴', txt: `±${(metros / 1000).toFixed(1)} km — esto es la antena, no el GPS`, usable: false };
  }

  /** ¿La posición nueva es mejor que la que ya tengo? */
  function esMejor(nueva, actual) {
    if (!nueva) return false;
    if (!actual) return true;
    /* Más precisa siempre gana */
    if (nueva.accuracy < actual.accuracy) return true;
    /* Si es igual de precisa pero más reciente, también */
    if (nueva.accuracy === actual.accuracy && nueva.timestamp > actual.timestamp) return true;
    /* Una posición vieja (>30 s) se sustituye aunque sea algo peor:
       te has movido y la de antes ya no vale */
    if (actual.timestamp && (nueva.timestamp - actual.timestamp) > 30000 &&
        nueva.accuracy < actual.accuracy * 2) return true;
    return false;
  }

  /** ¿Paramos ya de buscar? */
  function suficiente(pos, transcurrido, opts = OPCIONES) {
    if (!pos) return false;
    if (transcurrido < opts.esperaMin) return false;            // dale un respiro al GPS
    if (pos.accuracy <= opts.objetivo) return true;             // ya es fino
    if (transcurrido >= opts.esperaMax) return true;            // se acabó el tiempo
    return false;
  }

  /** Traduce el error del navegador a algo que se entienda */
  function explicarError(err, esIOS = false) {
    const code = err && err.code;
    if (code === 1) {
      return {
        titulo: 'Has bloqueado la ubicación',
        texto: esIOS
          ? 'En el iPhone: Ajustes → Safari → Ubicación → Preguntar o Permitir. Si la tienes en pantalla de inicio, mira en Ajustes → Privacidad → Localización.'
          : 'Toca el candado 🔒 de la barra de direcciones → Permisos → Ubicación → Permitir. Luego recarga.',
        recuperable: true
      };
    }
    if (code === 2) {
      return {
        titulo: 'No se pudo obtener la posición',
        texto: 'Suele pasar dentro de sitios cerrados. Comprueba que tienes la ubicación del móvil encendida y acércate a una ventana o sal un momento.',
        recuperable: true
      };
    }
    if (code === 3) {
      return {
        titulo: 'El GPS ha tardado demasiado',
        texto: 'Dentro de un bar puede costar. Prueba otra vez o coloca el punto a mano en el mapa.',
        recuperable: true
      };
    }
    return {
      titulo: 'No hay ubicación disponible',
      texto: 'Tu navegador no ha podido localizarte. Puedes colocar el punto a mano en el mapa.',
      recuperable: true
    };
  }

  /** Distancia en metros entre dos puntos */
  function distancia(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }

  /** ¿Me fío de que estas dos personas están juntas?
      Si mi precisión es de 500 m, no puedo afirmar que estemos a 20 m. */
  function mismoSitio(distanciaM, precisionA = 0, precisionB = 0, margen = 60) {
    const incertidumbre = (precisionA || 0) + (precisionB || 0);
    return distanciaM <= (margen + incertidumbre);
  }

  /** Formatea distancia */
  const fmtDist = m => m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;

  /* ---------- API del navegador ---------- */

  const esIOS = () => typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const hayGeo = () => typeof navigator !== 'undefined' && !!navigator.geolocation;

  const esSeguro = () => typeof window === 'undefined' ||
    window.isSecureContext !== false;

  /** Estado del permiso, si el navegador lo soporta */
  async function permiso() {
    try {
      if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return 'desconocido';
      const p = await navigator.permissions.query({ name: 'geolocation' });
      return p.state;   // 'granted' | 'denied' | 'prompt'
    } catch { return 'desconocido'; }
  }

  /**
   * Busca la mejor posición disponible.
   * onProgreso(pos, calidad) se llama cada vez que mejora, para ir pintando.
   * Devuelve { lat, lon, accuracy, calidad, intentos, ms } o lanza error explicado.
   */
  function mejorPosicion({ onProgreso = null, opts = {} } = {}) {
    const cfg = { ...OPCIONES, ...opts };
    return new Promise((resolve, reject) => {
      if (!hayGeo()) {
        return reject(Object.assign(new Error('sin-soporte'), {
          explicado: { titulo: 'Tu navegador no tiene geolocalización', texto: 'Coloca el punto a mano en el mapa.', recuperable: true }
        }));
      }
      if (!esSeguro()) {
        return reject(Object.assign(new Error('inseguro'), {
          explicado: { titulo: 'Se necesita HTTPS', texto: 'La ubicación solo funciona en conexiones seguras.', recuperable: false }
        }));
      }

      const t0 = Date.now();
      let mejor = null, intentos = 0, watchId = null, acabado = false;

      const terminar = (ok, err) => {
        if (acabado) return;
        acabado = true;
        if (watchId !== null && navigator.geolocation.clearWatch) navigator.geolocation.clearWatch(watchId);
        clearTimeout(temporizador);
        if (ok && mejor) {
          resolve({
            lat: mejor.latitude, lon: mejor.longitude,
            accuracy: mejor.accuracy, calidad: calidad(mejor.accuracy),
            intentos, ms: Date.now() - t0
          });
        } else {
          reject(Object.assign(new Error('geo-error'), { explicado: explicarError(err, esIOS()) }));
        }
      };

      const temporizador = setTimeout(() => {
        if (mejor) terminar(true);
        else terminar(false, { code: 3 });
      }, cfg.esperaMax);

      watchId = navigator.geolocation.watchPosition(
        p => {
          intentos++;
          const c = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp || Date.now() };
          if (esMejor(c, mejor)) {
            mejor = c;
            if (onProgreso) { try { onProgreso({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy }, calidad(c.accuracy), intentos); } catch {} }
          }
          if (suficiente(mejor, Date.now() - t0, cfg)) terminar(true);
        },
        err => { if (!mejor) terminar(false, err); },
        { enableHighAccuracy: true, timeout: cfg.esperaMax, maximumAge: cfg.maxEdad }
      );
    });
  }

  /** Seguimiento en segundo plano, con precisión alta y sin caché */
  function seguir(onPos, onErr = null) {
    if (!hayGeo()) return null;
    let mejor = null;
    return navigator.geolocation.watchPosition(
      p => {
        const c = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp || Date.now() };
        if (esMejor(c, mejor)) {
          mejor = c;
          onPos({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, ts: c.timestamp });
        }
      },
      e => { if (onErr) onErr(explicarError(e, esIOS())); },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 10000 }
    );
  }

  return {
    PRECISION, OPCIONES,
    calidad, esMejor, suficiente, explicarError, distancia, mismoSitio, fmtDist,
    esIOS, hayGeo, esSeguro, permiso, mejorPosicion, seguir
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GEO;
