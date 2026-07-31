/* Pruebas de la geolocalización, simulando cómo se comporta un móvil real.
   Ejecutar: node tests/test-geo.js */
const path = require('path');
const GEO = require(path.join(__dirname, '../public/js/geo.js'));

let passed = 0, failed = 0;
const out = [];
const check = (n, c, extra = '') => { c ? (passed++, out.push(`  ✅ ${n}`)) : (failed++, out.push(`  ❌ ${n} ${extra}`)); };
const group = t => out.push(`\n▶ ${t}`);

/* Node 24 trae su propio `navigator` de solo lectura: hay que redefinirlo */
function setNavigator(v) {
  Object.defineProperty(globalThis, 'navigator', { value: v, writable: true, configurable: true });
}
function setWindow(v) {
  Object.defineProperty(globalThis, 'window', { value: v, writable: true, configurable: true });
}

/* ---------- simulador de GPS de móvil ----------
   Reproduce la secuencia real: primero la antena (kilómetros de error),
   luego el wifi, y al final el GPS fino. */
function simularGPS(secuencia, { falloInicial = null } = {}) {
  const temporizadores = [];
  let siguienteId = 1;
  setNavigator({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    geolocation: {
      watchPosition(ok, err, opts) {
        const id = siguienteId++;
        if (falloInicial) { temporizadores.push(setTimeout(() => err(falloInicial), 5)); return id; }
        secuencia.forEach(f => {
          temporizadores.push(setTimeout(() => {
            ok({ coords: { latitude: f.lat, longitude: f.lon, accuracy: f.acc }, timestamp: Date.now() });
          }, f.t));
        });
        return id;
      },
      clearWatch(id) { temporizadores.forEach(clearTimeout); }
    },
    permissions: null
  });
  setWindow({ isSecureContext: true });
}

/* Secuencia típica de un iPhone al abrir la app en un bar de Madrid */
const SECUENCIA_REAL = [
  { t: 30, lat: 40.4200, lon: -3.7100, acc: 3000 },   // antena: 3 km de error
  { t: 400, lat: 40.4175, lon: -3.7050, acc: 800 },   // triangulación
  { t: 900, lat: 40.4170, lon: -3.7041, acc: 120 },   // wifi
  { t: 1500, lat: 40.41682, lon: -3.70385, acc: 35 }, // GPS
  { t: 2400, lat: 40.41680, lon: -3.70380, acc: 12 }  // GPS fino
];

(async () => {
  console.log('📍 Geolocalización de BirraMap — pruebas\n' + '='.repeat(58));

  /* ================= calidad ================= */
  group('Etiquetas de precisión');
  check('12 m → excelente', GEO.calidad(12).nivel === 'excelente');
  check('45 m → buena', GEO.calidad(45).nivel === 'buena');
  check('120 m → aceptable', GEO.calidad(120).nivel === 'aceptable');
  check('400 m → mala', GEO.calidad(400).nivel === 'mala');
  check('3000 m → pésima y NO usable', GEO.calidad(3000).nivel === 'pesima' && GEO.calidad(3000).usable === false);
  check('pésima se muestra en km, no en metros', GEO.calidad(3000).txt.includes('km'), GEO.calidad(3000).txt);
  check('sin dato → desconocida', GEO.calidad(null).nivel === 'desconocida');
  check('la etiqueta buena avisa con emoji', GEO.calidad(30).em === '✅');

  /* ================= comparar posiciones ================= */
  group('Elegir la mejor posición');
  const vieja = { accuracy: 500, timestamp: 1000 };
  check('más precisa gana', GEO.esMejor({ accuracy: 20, timestamp: 1100 }, vieja));
  check('menos precisa NO gana', !GEO.esMejor({ accuracy: 900, timestamp: 1100 }, vieja));
  check('la primera siempre entra', GEO.esMejor({ accuracy: 5000, timestamp: 1 }, null));
  check('igual de precisa pero más nueva, gana', GEO.esMejor({ accuracy: 500, timestamp: 2000 }, vieja));
  check('nada nunca gana', !GEO.esMejor(null, vieja));
  check('tras 30 s se acepta una algo peor (te has movido)',
    GEO.esMejor({ accuracy: 800, timestamp: 40000 }, { accuracy: 500, timestamp: 1000 }));
  check('pero no una muchísimo peor',
    !GEO.esMejor({ accuracy: 5000, timestamp: 40000 }, { accuracy: 500, timestamp: 1000 }));

  /* ================= cuándo parar ================= */
  group('Cuándo dejar de buscar');
  const o = GEO.OPCIONES;
  check('no para antes del tiempo mínimo aunque sea precisa',
    !GEO.suficiente({ accuracy: 10 }, 500, o));
  check('para si baja del objetivo', GEO.suficiente({ accuracy: 25 }, 2000, o));
  check('no para si sigue siendo imprecisa', !GEO.suficiente({ accuracy: 500 }, 5000, o));
  check('para al agotarse el tiempo, aunque sea mala',
    GEO.suficiente({ accuracy: 900 }, 20000, o));
  check('sin posición no para nunca', !GEO.suficiente(null, 30000, o));

  /* ================= errores explicados ================= */
  group('Mensajes de error');
  const denegado = GEO.explicarError({ code: 1 }, false);
  check('permiso denegado → explica el candado', /candado|Permisos/i.test(denegado.texto), denegado.texto);
  const denegadoIOS = GEO.explicarError({ code: 1 }, true);
  check('en iPhone da la ruta de Ajustes', /Ajustes/.test(denegadoIOS.texto), denegadoIOS.texto);
  check('los dos mensajes son distintos', denegado.texto !== denegadoIOS.texto);
  check('posición no disponible → sugiere salir fuera', /ventana|sal/i.test(GEO.explicarError({ code: 2 }).texto));
  check('timeout → sugiere ponerlo a mano', /a mano/i.test(GEO.explicarError({ code: 3 }).texto));
  check('todos los errores son recuperables', [1, 2, 3, 9].every(c => GEO.explicarError({ code: c }).recuperable));

  /* ================= distancias ================= */
  group('Distancias y fiabilidad');
  check('~133 m en Madrid', (() => { const d = GEO.distancia(40.4168, -3.7038, 40.4180, -3.7038); return d > 120 && d < 145; })());
  check('a sí mismo = 0', GEO.distancia(40.4, -3.7, 40.4, -3.7) === 0);
  check('formatea metros', GEO.fmtDist(350) === '350 m');
  check('formatea kilómetros', GEO.fmtDist(2400) === '2.4 km');

  /* esto es lo que arregla las notificaciones falsas */
  check('con GPS fino, 30 m = mismo sitio', GEO.mismoSitio(30, 10, 10));
  check('con GPS fino, 500 m NO es el mismo sitio', !GEO.mismoSitio(500, 10, 10));
  check('con GPS malo no se afirma que estéis juntos… pero tampoco se descarta',
    GEO.mismoSitio(300, 200, 200));
  check('si los dos vamos con 1 km de error, 3 km sigue siendo "no"',
    !GEO.mismoSitio(3000, 1000, 1000));

  /* ================= el caso real del móvil ================= */
  group('Secuencia real de un móvil (lo que fallaba)');

  simularGPS(SECUENCIA_REAL);
  const t0 = Date.now();
  const progreso = [];
  const pos = await GEO.mejorPosicion({
    onProgreso: (p, c) => progreso.push(Math.round(p.accuracy)),
    opts: { objetivo: 40, esperaMax: 6000, esperaMin: 1200 }
  });
  const tardo = Date.now() - t0;

  check('devuelve una posición', !!pos && isFinite(pos.lat) && isFinite(pos.lon));
  check('NO se queda con la primera lectura de 3 km', pos.accuracy < 100, `(±${pos.accuracy} m)`);
  check('se queda con una precisión buena', pos.accuracy <= 40, `(±${pos.accuracy} m)`);
  check('la posición final es la del bar de verdad',
    GEO.distancia(pos.lat, pos.lon, 40.41680, -3.70380) < 20,
    `(a ${GEO.distancia(pos.lat, pos.lon, 40.41680, -3.70380)} m del bar)`);
  check('avisa del progreso mientras busca', progreso.length >= 3, JSON.stringify(progreso));
  check('el progreso va mejorando', progreso.every((v, i) => i === 0 || v < progreso[i - 1]), JSON.stringify(progreso));
  check('no tarda una eternidad', tardo < 5000, `(${tardo} ms)`);
  check('informa de cuántas lecturas ha usado', pos.intentos >= 4, String(pos.intentos));
  check('la calidad final es usable', pos.calidad.usable === true && pos.calidad.nivel !== 'pesima');

  /* comparación con el método viejo */
  const viejo = SECUENCIA_REAL[0];
  const errorViejo = GEO.distancia(viejo.lat, viejo.lon, 40.41680, -3.70380);
  const errorNuevo = GEO.distancia(pos.lat, pos.lon, 40.41680, -3.70380);
  check(`el método viejo te ponía a ${GEO.fmtDist(errorViejo)} del bar; el nuevo a ${GEO.fmtDist(errorNuevo)}`,
    errorNuevo < errorViejo / 10);

  /* ================= sitio cerrado: nunca mejora ================= */
  group('Dentro de un bar (el GPS no mejora)');
  simularGPS([
    { t: 30, lat: 40.4200, lon: -3.7100, acc: 1800 },
    { t: 800, lat: 40.4195, lon: -3.7090, acc: 1500 }
  ]);
  const malo = await GEO.mejorPosicion({ opts: { objetivo: 40, esperaMax: 2200, esperaMin: 600 } });
  check('devuelve algo igualmente, no deja al usuario tirado', !!malo);
  check('pero lo marca como no usable', malo.calidad.usable === false, malo.calidad.nivel);
  check('y el aviso dice que es la antena', /antena/i.test(malo.calidad.txt), malo.calidad.txt);

  /* ================= permiso denegado ================= */
  group('Permiso denegado');
  simularGPS([], { falloInicial: { code: 1, message: 'User denied Geolocation' } });
  let capturado = null;
  try { await GEO.mejorPosicion({ opts: { esperaMax: 1500 } }); }
  catch (e) { capturado = e; }
  check('lanza error, no se queda colgado', !!capturado);
  check('el error viene explicado', !!(capturado && capturado.explicado));
  check('con título entendible', /bloqueado/i.test(capturado.explicado.titulo), capturado.explicado.titulo);
  check('detecta que es un iPhone y da la ruta de Ajustes',
    /Ajustes/.test(capturado.explicado.texto), capturado.explicado.texto);

  /* ================= sin soporte ================= */
  group('Casos límite');
  setNavigator({ userAgent: 'x' });
  setWindow({ isSecureContext: true });
  let sinSoporte = null;
  try { await GEO.mejorPosicion(); } catch (e) { sinSoporte = e; }
  check('sin geolocalización → error explicado', !!sinSoporte && /a mano/i.test(sinSoporte.explicado.texto));

  setNavigator({ userAgent: 'x', geolocation: { watchPosition() { return 1; }, clearWatch() {} } });
  setWindow({ isSecureContext: false });
  let inseguro = null;
  try { await GEO.mejorPosicion(); } catch (e) { inseguro = e; }
  check('sin HTTPS → avisa y no es recuperable',
    !!inseguro && /HTTPS/.test(inseguro.explicado.titulo) && inseguro.explicado.recuperable === false);

  /* ================= detección de iOS ================= */
  group('Detección de plataforma');
  setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
  check('detecta iPhone', GEO.esIOS());
  setNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' });
  check('no confunde Android con iPhone', !GEO.esIOS());
  setNavigator({ userAgent: 'Mac', platform: 'MacIntel', maxTouchPoints: 5 });
  check('detecta iPad moderno (se hace pasar por Mac)', GEO.esIOS());

  console.log(out.join('\n'));
  console.log('\n' + '='.repeat(58));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
