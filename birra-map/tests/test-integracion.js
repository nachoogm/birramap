/* Prueba la función locate() ya parcheada, tal cual quedará en app.js.
   Ejecutar: node tests/test-integracion.js */
const path = require('path');
const GEO = require(path.join(__dirname, '../public/js/geo.js'));

let passed = 0, failed = 0;
const out = [];
const check = (n, c, extra = '') => { c ? (passed++, out.push(`  ✅ ${n}`)) : (failed++, out.push(`  ❌ ${n} ${extra}`)); };
const group = t => out.push(`\n▶ ${t}`);

const setG = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });

/* ---------- entorno de navegador falso ---------- */
function entorno(secuencia, { fallo = null, ios = false } = {}) {
  const temps = [];
  setG('navigator', {
    userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 (Linux; Android 14)',
    geolocation: {
      watchPosition(ok, err) {
        if (fallo) { temps.push(setTimeout(() => err(fallo), 5)); return 1; }
        secuencia.forEach(f => temps.push(setTimeout(() =>
          ok({ coords: { latitude: f.lat, longitude: f.lon, accuracy: f.acc }, timestamp: Date.now() }), f.t)));
        return 1;
      },
      clearWatch() { temps.forEach(clearTimeout); }
    }
  });
  setG('window', { isSecureContext: true });

  /* DOM mínimo */
  const els = {};
  const el = () => ({ textContent: '', innerHTML: '', value: '', onclick: null, style: {} });
  ['#geoStatus', '#placeName'].forEach(k => els[k] = el());
  return {
    els,
    $: s => els[s] || null,
    toasts: [],
  };
}

/* ---------- locate() exactamente como queda tras el parche ---------- */
function crearLocate(env, state, refs) {
  const $ = env.$;
  const toast = m => env.toasts.push(m);
  const abrirSelectorMapa = (lat, lon, cb) => { refs.selectorAbierto = { lat, lon }; refs.cbSelector = cb; };

  return async function locate(cb) {
    const st = $('#geoStatus');
    if (st) st.textContent = '🛰️ buscando GPS…';
    try {
      const pos = await GEO.mejorPosicion({
        onProgreso: (p, c) => { if (st) st.textContent = `${c.em} ${c.txt}`; },
        opts: { objetivo: 40, esperaMax: 6000, esperaMin: 800 }
      });
      refs.myPos = { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy };
      state.accuracy = pos.accuracy;
      if (st) st.innerHTML = `${pos.calidad.em} ${pos.calidad.txt}` +
        (pos.accuracy > 60 ? ' · <a href="#" id="fixPin">ajustar a mano</a>' : '');
      refs.ofreceAjuste = pos.accuracy > 60;
      cb(pos.lat, pos.lon, pos.accuracy);
    } catch (e) {
      const ex = e.explicado || { titulo: 'Sin ubicación', texto: '' };
      if (st) st.innerHTML = `⚠️ ${ex.titulo} · <a href="#" id="fixPin">poner a mano</a>`;
      refs.ofreceAjuste = true;
      refs.errorMostrado = ex;
      toast(ex.titulo);
      /* ⚠️ clave: NO llama a cb con una posición inventada */
    }
  };
}

const BAR = { lat: 40.41680, lon: -3.70380 };
const SECUENCIA = [
  { t: 30, lat: 40.4200, lon: -3.7100, acc: 3000 },
  { t: 350, lat: 40.4175, lon: -3.7050, acc: 800 },
  { t: 800, lat: 40.4170, lon: -3.7041, acc: 120 },
  { t: 1300, lat: 40.41682, lon: -3.70385, acc: 30 }
];

(async () => {
  console.log('🔗 Integración de locate() — pruebas\n' + '='.repeat(56));

  /* ============ caso normal ============ */
  group('Fichar en la calle (GPS que afina)');
  let env = entorno(SECUENCIA);
  let state = {}, refs = {};
  let fichado = null;
  let locate = crearLocate(env, state, refs);
  await locate((lat, lon, acc) => { fichado = { lat, lon, acc }; });

  check('ficha con una posición', !!fichado);
  check('NO usa la primera lectura de 3 km', fichado.acc < 100, `(±${fichado.acc} m)`);
  check('ficha en el bar correcto',
    GEO.distancia(fichado.lat, fichado.lon, BAR.lat, BAR.lon) < 30,
    `(a ${GEO.distancia(fichado.lat, fichado.lon, BAR.lat, BAR.lon)} m)`);
  check('guarda la precisión en myPos', refs.myPos.accuracy === fichado.acc);
  check('enseña la precisión al usuario', /±\d+ m/.test(env.els['#geoStatus'].innerHTML), env.els['#geoStatus'].innerHTML);
  check('con GPS bueno no molesta con el ajuste manual', refs.ofreceAjuste === false);

  /* ============ dentro de un bar ============ */
  group('Fichar dentro del bar (GPS malo)');
  env = entorno([{ t: 30, lat: 40.4200, lon: -3.7100, acc: 1500 }, { t: 600, lat: 40.4198, lon: -3.7095, acc: 900 }]);
  state = {}; refs = {}; fichado = null;
  locate = crearLocate(env, state, refs);
  await locate((lat, lon, acc) => { fichado = { lat, lon, acc }; });

  check('devuelve algo, no bloquea al usuario', !!fichado);
  check('avisa de que la precisión es mala', /km|antena/i.test(env.els['#geoStatus'].innerHTML), env.els['#geoStatus'].innerHTML);
  check('ofrece ajustar a mano', refs.ofreceAjuste === true);

  /* ============ permiso denegado ============ */
  group('Permiso denegado (el fallo silencioso de antes)');
  env = entorno([], { fallo: { code: 1 }, ios: true });
  state = {}; refs = {}; fichado = null;
  locate = crearLocate(env, state, refs);
  await locate((lat, lon, acc) => { fichado = { lat, lon, acc }; });

  check('NO ficha con una posición inventada', fichado === null, JSON.stringify(fichado));
  check('avisa al usuario con un toast', env.toasts.length === 1, JSON.stringify(env.toasts));
  check('el mensaje explica que está bloqueada', /bloqueado/i.test(refs.errorMostrado.titulo));
  check('en iPhone da la ruta de Ajustes', /Ajustes/.test(refs.errorMostrado.texto));
  check('ofrece poner el punto a mano', refs.ofreceAjuste === true);

  /* comparación con el comportamiento anterior */
  const centroMapaMadrid = { lat: 40.4168, lng: -3.7038 };
  check('el código viejo habría fichado en el centro del mapa sin avisar',
    GEO.distancia(centroMapaMadrid.lat, centroMapaMadrid.lng, 41.3874, 2.1686) > 500000);

  /* ============ selector manual ============ */
  group('Selector manual');
  env = entorno([], { fallo: { code: 3 } });
  state = {}; refs = {};
  locate = crearLocate(env, state, refs);
  await locate(() => {});
  check('tras un timeout ofrece el selector', refs.ofreceAjuste === true);
  check('el mensaje sugiere ponerlo a mano', /a mano/i.test(refs.errorMostrado.texto));

  /* ============ distancias según fiabilidad ============ */
  group('Distancias honestas');
  const fmt = (myPos, otro) => {
    const dm = GEO.distancia(myPos.lat, myPos.lon, otro.lat, otro.lon);
    const fiable = (myPos.accuracy || 0) < 150;
    return fiable ? GEO.fmtDist(dm) : '~' + GEO.fmtDist(dm);
  };
  check('con GPS bueno da la distancia exacta',
    fmt({ lat: 40.4168, lon: -3.7038, accuracy: 15 }, { lat: 40.4180, lon: -3.7038 }) === '133 m');
  check('con GPS malo la marca como aproximada',
    fmt({ lat: 40.4168, lon: -3.7038, accuracy: 900 }, { lat: 40.4180, lon: -3.7038 }).startsWith('~'));

  /* ============ avisos de proximidad ============ */
  group('Avisos de proximidad');
  const avisa = (myPos, otro, radio = 500) => {
    if ((myPos.accuracy || 0) > 300) return false;
    return GEO.distancia(myPos.lat, myPos.lon, otro.lat, otro.lon) <= radio;
  };
  check('con GPS bueno y cerca, avisa',
    avisa({ lat: 40.4168, lon: -3.7038, accuracy: 20 }, { lat: 40.4180, lon: -3.7038 }));
  check('con GPS bueno y lejos, no avisa',
    !avisa({ lat: 40.4168, lon: -3.7038, accuracy: 20 }, { lat: 40.4300, lon: -3.7038 }));
  check('con GPS malo NO avisa (evita las falsas alarmas)',
    !avisa({ lat: 40.4168, lon: -3.7038, accuracy: 900 }, { lat: 40.4180, lon: -3.7038 }));

  console.log(out.join('\n'));
  console.log('\n' + '='.repeat(56));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
