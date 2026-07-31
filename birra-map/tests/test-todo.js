/* Batería completa: puntuaciones, geolocalización iOS e interfaz.
   Ejecutar: node tests/test-todo.js */
process.env.BIRRAMAP_FAKE_STORE = '1';

const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const out = [];
const check = (n, c, extra = '') => { c ? (passed++, out.push(`  ✅ ${n}`)) : (failed++, out.push(`  ❌ ${n} ${extra}`)); };
const group = t => out.push(`\n▶ ${t}`);

const setG = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });

/* Coloca los stubs de test y los retira al terminar, para que el paquete
   no incluya un logic.js/tables.js que pisaría los tuyos. */
const SH = path.join(__dirname, '../api/shared');
const STUBS = ['logic.js', 'tables.js'];
const puestos = [];
for (const f of STUBS) {
  const destino = path.join(SH, f);
  if (!fs.existsSync(destino)) {
    fs.copyFileSync(path.join(__dirname, '_stubs', f), destino);
    puestos.push(destino);
  }
}
process.on('exit', () => puestos.forEach(f => { try { fs.unlinkSync(f); } catch {} }));

const R = require(path.join(__dirname, '../api/shared/ratings.js'));
const fn = n => require(path.join(__dirname, '../api', n, 'index.js'));
const hdr = u => Buffer.from(JSON.stringify({ userId: u, userDetails: u, identityProvider: 'github' })).toString('base64');
async function call(name, { user, method = 'GET', body = null, query = {} } = {}) {
  const ctx = {};
  await fn(name)(ctx, { method, body, query, headers: user ? { 'x-ms-client-principal': hdr(user) } : {} });
  return ctx.res;
}

/* ============================================================
   1 · PUNTUACIONES — lógica
   ============================================================ */
function testRatingsLogica() {
  group('Puntuaciones · normalizar y validar');
  check('acepta enteros de 0 a 5', [0, 1, 2, 3, 4, 5].every(v => R.normalizarEstrellas(v) === v));
  check('acepta medias estrellas', R.normalizarEstrellas(3.5) === 3.5);
  check('redondea a la media más cercana', R.normalizarEstrellas(3.7) === 3.5, String(R.normalizarEstrellas(3.7)));
  check('rechaza más de 5', R.normalizarEstrellas(6) === null);
  check('rechaza negativos', R.normalizarEstrellas(-1) === null);
  check('rechaza texto', R.normalizarEstrellas('mucho') === null);
  check('acepta el cero (bar horrible)', R.normalizarEstrellas(0) === 0);
  check('acepta número en texto', R.normalizarEstrellas('4') === 4);

  group('Puntuaciones · nombre del bar');
  check('normaliza mayúsculas', R.clavePlace('Bar Manolo') === R.clavePlace('BAR MANOLO'));
  check('normaliza espacios sobrantes', R.clavePlace('  Bar   Manolo  ') === 'bar manolo');
  check('vacío da vacío', R.clavePlace('') === '' && R.clavePlace(null) === '');

  group('Puntuaciones · medias y reparto');
  const votos = [{ stars: 5 }, { stars: 4 }, { stars: 3 }];
  const m = R.mediaDe(votos);
  check('media correcta', m.media === 4, String(m.media));
  check('cuenta los votos', m.votos === 3);
  check('reparto por estrellas', m.reparto[5] === 1 && m.reparto[4] === 1 && m.reparto[3] === 1);
  check('sin votos no revienta', R.mediaDe([]).media === 0 && R.mediaDe([]).votos === 0);

  group('Puntuaciones · un voto por persona');
  const filas = [
    { userId: 'u1', nick: 'Nacho', place: 'Bar Manolo', stars: 2, tsMs: 1000 },
    { userId: 'u1', nick: 'Nacho', place: 'Bar Manolo', stars: 5, tsMs: 5000 },   // cambia de opinión
    { userId: 'u2', nick: 'Juan', place: 'bar manolo', stars: 4, tsMs: 2000 },     // minúsculas
    { userId: 'u3', nick: 'Ana', place: 'La Tasca', stars: 1, tsMs: 3000 }
  ];
  const bares = R.agruparPorBar(filas);
  check('agrupa "Bar Manolo" y "bar manolo" como uno solo', bares.length === 2, String(bares.length));
  const manolo = bares.find(b => R.clavePlace(b.place) === 'bar manolo');
  check('solo cuenta el último voto de cada uno', manolo.votos === 2, String(manolo.votos));
  check('usa el voto nuevo, no el viejo', manolo.media === 4.5, String(manolo.media));
  check('muestra el nombre más escrito', manolo.place === 'Bar Manolo', manolo.place);
  check('guarda quién ha votado', manolo.votantes.length === 2);
  check('los votantes salen del más reciente al más antiguo', manolo.votantes[0].userId === 'u1');

  group('Puntuaciones · ranking ponderado');
  const muchos = [
    ...Array.from({ length: 20 }, (_, i) => ({ userId: 'x' + i, nick: 'x', place: 'Sitio Bueno', stars: 4.5, tsMs: i })),
    { userId: 'y1', nick: 'y', place: 'Chiringuito', stars: 5, tsMs: 1 }
  ];
  const rk = R.rankingBares(muchos);
  check('un bar con 20 votos de 4,5 gana a otro con 1 voto de 5',
    rk[0].place === 'Sitio Bueno', JSON.stringify(rk.map(x => [x.place, x.puntuacion])));
  check('la media real se conserva sin tocar', rk.find(x => x.place === 'Chiringuito').media === 5);
  check('la puntuación de confianza sí baja', rk.find(x => x.place === 'Chiringuito').puntuacion < 5);
  check('sin datos devuelve lista vacía', R.rankingBares([]).length === 0);

  /* límite inferior de Wilson */
  check('más votos con la misma nota dan más confianza',
    R.wilsonInferior(5, 20) > R.wilsonInferior(5, 3) && R.wilsonInferior(5, 3) > R.wilsonInferior(5, 1));
  check('la confianza nunca supera la media real', R.wilsonInferior(4.5, 20) <= 4.5);
  check('sin votos, confianza cero', R.wilsonInferior(5, 0) === 0);
  check('un bar malo con muchos votos sigue siendo malo', R.wilsonInferior(1, 50) < 1.5);
  check('20 votos de 4,5 pesan más que 1 de 5',
    R.wilsonInferior(4.5, 20) > R.wilsonInferior(5, 1),
    `${R.wilsonInferior(4.5, 20).toFixed(2)} vs ${R.wilsonInferior(5, 1).toFixed(2)}`);

  group('Puntuaciones · etiquetas y pintado');
  check('4,7 es un templo', R.etiqueta(4.7, 5).txt === 'templo');
  check('3,2 cumple', R.etiqueta(3.2, 5).txt === 'cumple');
  check('0,5 es para huir', R.etiqueta(0.5, 3).em === '☠️');
  check('sin votos lo dice', R.etiqueta(0, 0).txt === 'sin votos todavía');
  check('pinta 4 estrellas llenas', R.pintarEstrellas(4) === '★★★★☆', R.pintarEstrellas(4));
  check('pinta media estrella', R.pintarEstrellas(3.5).includes('⯨'));
  check('cero estrellas son 5 vacías', R.pintarEstrellas(0) === '☆☆☆☆☆');

  group('Puntuaciones · bares pendientes de puntuar');
  const checkins = [
    { userId: 'u1', place: 'Bar Manolo', tsMs: 100 },
    { userId: 'u1', place: 'La Tasca', tsMs: 200 },
    { userId: 'u1', place: 'El Tercio', tsMs: 300 },
    { userId: 'u2', place: 'Otro Bar', tsMs: 400 }
  ];
  const ratings = [{ userId: 'u1', place: 'Bar Manolo', stars: 4, tsMs: 150 }];
  const pend = R.sinPuntuar(checkins, ratings, 'u1');
  check('propone solo los que no he votado', pend.length === 2, JSON.stringify(pend.map(p => p.place)));
  check('no propone bares de otros', !pend.some(p => p.place === 'Otro Bar'));
  check('el más reciente primero', pend[0].place === 'El Tercio');
  check('no propone el que ya voté', !pend.some(p => p.place === 'Bar Manolo'));
}

/* ============================================================
   2 · PUNTUACIONES — API
   ============================================================ */
async function testRatingsApi() {
  group('Puntuaciones · API');
  const { __resetMemory } = require(path.join(__dirname, '../api/shared/tables.js'));
  __resetMemory();

  const join = (u, n, g) => call('me', { user: u, method: 'POST', body: { nick: n, groupId: g } });
  /* me/index.js no está en este paquete: damos de alta a mano */
  const S = require(path.join(__dirname, '../api/shared/store.js'));
  await S.saveMember('u1', { nick: 'Nacho', groupId: 'lospavos' });
  await S.saveMember('u2', { nick: 'Juan', groupId: 'lospavos' });
  await S.saveMember('u3', { nick: 'Ana', groupId: 'lospavos' });
  await S.saveMember('x1', { nick: 'Otro', groupId: 'otrogrupo' });

  check('sin login → 401', (await call('ratings', {})).status === 401);
  check('sin grupo → 409', (await call('ratings', { user: 'zz' })).status === 409);

  let r = await call('rating', { user: 'u1', method: 'POST', body: { place: 'Bar Manolo', stars: 5, note: 'las cañas más frías' } });
  check('puntuación creada (201)', r.status === 201, JSON.stringify(r.body));
  check('devuelve cómo queda el bar', r.body.bar && r.body.bar.media === 5, JSON.stringify(r.body.bar));

  check('sin bar → 400', (await call('rating', { user: 'u1', method: 'POST', body: { stars: 4 } })).status === 400);
  check('6 estrellas → 400', (await call('rating', { user: 'u1', method: 'POST', body: { place: 'X', stars: 6 } })).status === 400);
  check('estrellas negativas → 400', (await call('rating', { user: 'u1', method: 'POST', body: { place: 'X', stars: -2 } })).status === 400);
  check('0 estrellas SÍ vale', (await call('rating', { user: 'u1', method: 'POST', body: { place: 'Antro', stars: 0 } })).status === 201);

  await call('rating', { user: 'u2', method: 'POST', body: { place: 'bar manolo', stars: 4 } });
  await call('rating', { user: 'u3', method: 'POST', body: { place: 'BAR MANOLO', stars: 3 } });

  const ficha = await call('ratings', { user: 'u1', query: { place: 'Bar Manolo' } });
  check('agrupa los 3 votos pese a las mayúsculas', ficha.body.bar.votos === 3, String(ficha.body.bar.votos));
  check('media correcta (5+4+3)/3 = 4', ficha.body.bar.media === 4, String(ficha.body.bar.media));
  check('me dice cuál es mi voto', ficha.body.miVoto.stars === 5);
  check('y mi comentario', /cañas más frías/.test(ficha.body.miVoto.note));

  /* cambiar el voto */
  await call('rating', { user: 'u1', method: 'POST', body: { place: 'Bar Manolo', stars: 2 } });
  const tras = await call('ratings', { user: 'u1', query: { place: 'Bar Manolo' } });
  check('al revotar NO se suma otro voto', tras.body.bar.votos === 3, String(tras.body.bar.votos));
  check('la media se recalcula (2+4+3)/3 = 3', tras.body.bar.media === 3, String(tras.body.bar.media));
  check('mi voto queda actualizado', tras.body.miVoto.stars === 2);

  const lista = await call('ratings', { user: 'u1' });
  check('el ranking incluye los bares votados', lista.body.total >= 2);
  check('marca cuál es mi voto en cada bar', lista.body.ranking.some(b => b.miVoto !== null));
  check('incluye el reparto de estrellas', Array.isArray(lista.body.ranking[0].reparto));
  check('señala el mejor y el peor', !!lista.body.mejor && !!lista.body.peor);
  check('el mejor tiene mejor puntuación que el peor',
    lista.body.mejor.puntuacion >= lista.body.peor.puntuacion);

  const otro = await call('ratings', { user: 'x1' });
  check('otro grupo no ve vuestras puntuaciones', otro.body.total === 0, String(otro.body.total));

  await S.addCheckin('lospavos', { userId: 'u1', nick: 'Nacho', place: 'Sitio Nuevo', qty: 1, tsMs: Date.now(), day: '2026-07-30' });
  const pend = await call('ratings', { user: 'u1', query: { pending: '1' } });
  check('propone puntuar los bares donde estuve', pend.body.pendientes.some(p => p.place === 'Sitio Nuevo'),
    JSON.stringify(pend.body.pendientes));
}

/* ============================================================
   3 · GEOLOCALIZACIÓN iOS
   ============================================================ */
async function testGeo() {
  const GEO = require(path.join(__dirname, '../public/js/geo.js'));

  group('GPS · la regla del gesto en iOS (el fallo real)');

  /* Simula iOS: si watchPosition se llama fuera del turno síncrono del
     gesto, Safari no responde jamás. */
  let llamadaSincrona = false;
  let gestoVivo = true;
  const temps = [];
  setG('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/605.1',
    geolocation: {
      watchPosition(ok, err) {
        llamadaSincrona = gestoVivo;
        if (!gestoVivo) return 99;                    // iOS: silencio absoluto
        temps.push(setTimeout(() => ok({ coords: { latitude: 40.4168, longitude: -3.7038, accuracy: 18 }, timestamp: Date.now() }), 60));
        return 1;
      },
      clearWatch() { temps.forEach(clearTimeout); }
    }
  });
  setG('window', { isSecureContext: true, navigator: { standalone: false }, matchMedia: () => ({ matches: false }) });

  /* así se hacía antes: async con await por delante → gesto perdido */
  async function locateViejo() {
    await Promise.resolve();          // ← esto rompe iOS
    gestoVivo = false;
    return GEO.pedirUbicacion({ opts: { esperaMax: 400, guardian: 200 } }).promesa;
  }
  let falloViejo = false;
  try { await locateViejo(); } catch { falloViejo = true; }
  check('el método viejo (con await antes) falla en iOS', falloViejo && llamadaSincrona === false);

  /* así se hace ahora: la llamada es lo primero */
  gestoVivo = true; llamadaSincrona = false;
  function locateNuevo() {
    return GEO.pedirUbicacion({ opts: { esperaMax: 3000, esperaMin: 50, guardian: 1500 } }).promesa;
  }
  const pos = await locateNuevo();
  check('el nuevo llama al GPS dentro del gesto', llamadaSincrona === true);
  check('y obtiene posición', !!pos && pos.accuracy === 18);
  check('pedirUbicacion NO es async (requisito de iOS)',
    GEO.pedirUbicacion.constructor.name === 'Function');

  group('GPS · el plan B cuando iOS se queda mudo');
  let usadaAlta = false, usadaBaja = false;
  const t2 = [];
  setG('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    geolocation: {
      watchPosition(ok, err, o) {
        if (o.enableHighAccuracy) { usadaAlta = true; return 1; }   // alta: nunca responde
        usadaBaja = true;
        t2.push(setTimeout(() => ok({ coords: { latitude: 40.4168, longitude: -3.7038, accuracy: 450 }, timestamp: Date.now() }), 40));
        return 2;
      },
      clearWatch() { t2.forEach(clearTimeout); }
    }
  });
  const rec = await GEO.pedirUbicacion({ opts: { esperaMax: 2500, esperaMin: 100, guardian: 300 } }).promesa;
  check('primero prueba con alta precisión', usadaAlta);
  check('si no responde, lanza el plan B con precisión baja', usadaBaja);
  check('así recupera una posición en vez de colgarse', !!rec && rec.accuracy === 450);
  check('pero avisa de que la precisión es mala', rec.calidad.usable === false || rec.calidad.nivel === 'mala');

  group('GPS · elegir la mejor lectura');
  const t3 = [];
  setG('navigator', {
    userAgent: 'iPhone',
    geolocation: {
      watchPosition(ok) {
        [{ t: 20, acc: 3000, lat: 40.4200 }, { t: 200, acc: 700, lat: 40.4180 },
         { t: 500, acc: 90, lat: 40.4170 }, { t: 900, acc: 15, lat: 40.41680 }]
          .forEach(f => t3.push(setTimeout(() => ok({ coords: { latitude: f.lat, longitude: -3.70380, accuracy: f.acc }, timestamp: Date.now() }), f.t)));
        return 1;
      },
      clearWatch() { t3.forEach(clearTimeout); }
    }
  });
  const prog = [];
  const fino = await GEO.pedirUbicacion({
    onProgreso: (p, c) => prog.push(Math.round(p.accuracy)),
    opts: { objetivo: 35, esperaMax: 4000, esperaMin: 300, guardian: 3500 }
  }).promesa;
  check('NO se queda con la primera lectura de 3 km', fino.accuracy < 100, `(±${fino.accuracy} m)`);
  check('se queda con la mejor', fino.accuracy === 15, `(±${fino.accuracy} m)`);
  check('informa del progreso', prog.length >= 3, JSON.stringify(prog));
  check('el progreso va mejorando', prog.every((v, i) => i === 0 || v < prog[i - 1]), JSON.stringify(prog));

  group('GPS · mensajes de ayuda para iPhone');
  const denegadoIOS = GEO.explicarError({ code: 1 }, { ios: true, pwa: false });
  check('menciona Ajustes', /Ajustes/.test(denegadoIOS.texto));
  check('menciona "Ubicación precisa" (la causa más común)', /Ubicación precisa/i.test(denegadoIOS.texto));
  check('da pasos numerados', Array.isArray(denegadoIOS.pasos) && denegadoIOS.pasos.length >= 4);
  const pwa = GEO.explicarError({ code: 1 }, { ios: true, pwa: true });
  check('si está instalada como app, busca BirraMap y no Safari', /BirraMap/.test(pwa.texto));
  check('el mensaje de Android es distinto', GEO.explicarError({ code: 1 }, { ios: false }).texto !== denegadoIOS.texto);
  const silencio = GEO.explicarError({ code: 'silencio' }, { ios: true });
  check('cubre el caso "Safari no responde"', /no responde/i.test(silencio.titulo));

  group('GPS · detección de plataforma');
  setG('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  check('detecta iPhone', GEO.esIOS());
  setG('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' });
  check('no confunde Android', !GEO.esIOS());
  setG('navigator', { userAgent: 'Mac', platform: 'MacIntel', maxTouchPoints: 5 });
  check('detecta iPad moderno', GEO.esIOS());
  setG('navigator', { userAgent: 'iPhone', standalone: true });
  setG('window', { navigator: { standalone: true }, matchMedia: () => ({ matches: false }), isSecureContext: true });
  check('detecta app instalada en la pantalla de inicio', GEO.esPWA());

  group('GPS · calidad y distancias');
  check('±15 m es excelente', GEO.calidad(15).nivel === 'excelente');
  check('±3 km no es usable', GEO.calidad(3000).usable === false);
  check('cada nivel tiene su color', GEO.calidad(15).color !== GEO.calidad(3000).color);
  check('~133 m en Madrid', (() => { const d = GEO.distancia(40.4168, -3.7038, 40.4180, -3.7038); return d > 120 && d < 145; })());
  check('formatea km', GEO.fmtDist(2400) === '2.4 km');
  check('con GPS malo no afirma que estéis juntos', !GEO.mismoSitio(3000, 1000, 1000));
}

/* ============================================================
   4 · INTERFAZ
   ============================================================ */
function testUI() {
  group('Interfaz · componentes');
  /* DOM mínimo para poder cargar ui.js */
  const nodos = new Map();
  const nodo = () => ({
    innerHTML: '', textContent: '', className: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelectorAll: () => [], querySelector: () => null,
    appendChild() {}, remove() {}, onclick: null
  });
  setG('document', {
    querySelector: s => nodos.get(s) || null,
    createElement: () => nodo(),
    body: { appendChild() {} },
    addEventListener() {}
  });
  setG('localStorage', { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } });

  const UI = require(path.join(__dirname, '../public/js/ui.js'));

  check('escapa HTML malicioso', UI.esc('<script>alert(1)</script>').includes('&lt;script&gt;'));
  check('escapa comillas', UI.esc('a"b').includes('&quot;'));

  const e4 = UI.estrellas(4);
  check('4 estrellas pinta 4 encendidas', (e4.match(/class="on"/g) || []).length === 4, e4);
  check('y 5 en total', (e4.match(/★/g) || []).length === 5);
  check('0 estrellas no enciende ninguna', !UI.estrellas(0).includes('class="on"'));
  check('5 estrellas las enciende todas', (UI.estrellas(5).match(/class="on"/g) || []).length === 5);
  check('recorta por encima de 5', (UI.estrellas(9).match(/class="on"/g) || []).length === 5);

  const rep = UI.reparto([0, 1, 0, 2, 3, 4], 10);
  check('el reparto pinta 5 filas', (rep.match(/reparto-fila/g) || []).length === 5);
  check('calcula los porcentajes', rep.includes('width:40%'), rep.slice(0, 200));
  check('sin votos no pinta nada', UI.reparto([0, 0, 0, 0, 0, 0], 0) === '');

  check('hay texto para cada nota de 0 a 5', [0, 1, 2, 3, 4, 5].every(n => !!UI.TEXTOS_NOTA[n]));
  check('el 5 es el mejor', /templo/i.test(UI.TEXTOS_NOTA[5]));

  group('Interfaz · tour y ayuda');
  check('el tour tiene 5 pasos', UI.PASOS.length === 5);
  check('todos los pasos tienen emoji y título', UI.PASOS.every(p => p.em && p.tit));
  check('el último paso está marcado como final', UI.PASOS[UI.PASOS.length - 1].final === true);
  check('el tour explica el grupo', UI.PASOS.some(p => /grupo/i.test(p.tit + (p.txt || ''))));
  check('el tour explica cómo fichar', UI.PASOS.some(p => (p.lista || []).some(x => /tomo una/i.test(x.t))));
  check('el tour menciona las estrellas', UI.PASOS.some(p => (p.lista || []).some(x => /⭐|puntú/i.test(x.em + x.t))));

  check('la ayuda tiene 11 apartados', UI.AYUDA.length === 11, String(UI.AYUDA.length));
  check('todos con emoji, título y contenido', UI.AYUDA.every(a => a.em && a.tit && a.html));
  const temas = UI.AYUDA.map(a => a.tit.toLowerCase()).join(' ');
  ['empiezo', 'fichar', 'ronda', 'puntuar', 'deuda', 'ranking', 'gps', 'aviso', 'noche', 'privacidad']
    .forEach(t => check(`la ayuda cubre "${t}"`, temas.includes(t), temas));
  const ayudaGps = UI.AYUDA.find(a => /gps/i.test(a.tit));
  check('la ayuda del GPS explica los pasos de iPhone', /Ubicación precisa/i.test(ayudaGps.html));
  check('y también los de Android', /Android/i.test(ayudaGps.html));

  check('genera estado vacío con emoji', UI.vacio('🍺', 'Nada', 'texto').includes('vacio-em'));
  check('genera pantalla de carga', UI.cargando().includes('jarra'));
}

/* ============================================================
   5 · FICHEROS
   ============================================================ */
function testFicheros() {
  group('Ficheros y estilos');
  const root = path.join(__dirname, '..');
  const ex = p => fs.existsSync(path.join(root, p));
  const leer = p => fs.readFileSync(path.join(root, p), 'utf8');

  ['public/js/geo.js', 'public/js/ui.js', 'public/css/styles.css',
   'api/shared/ratings.js', 'api/rating/index.js', 'api/ratings/index.js']
    .forEach(f => check(`existe ${f}`, ex(f)));
  check('el paquete NO trae logic.js (pisaría el tuyo)', puestos.some(p => p.endsWith('logic.js')));
  check('el paquete NO trae tables.js (pisaría el tuyo)', puestos.some(p => p.endsWith('tables.js')));

  const css = leer('public/css/styles.css');
  check('el CSS carga tipografías propias', css.includes('Outfit') && css.includes('Inter'));
  check('define variables de color', css.includes('--oro') && css.includes('--surface'));
  check('tiene animaciones', ['subir', 'pulso', 'onda', 'flotar', 'brillo'].every(a => css.includes(`@keyframes ${a}`)));
  check('estiliza las chinchetas del mapa', css.includes('.pin-cuerpo') && css.includes('.pin-onda'));
  check('estiliza el selector de estrellas', css.includes('.picker-estrellas'));
  check('estiliza el tour', css.includes('.tour-card'));
  check('estiliza la ayuda plegable', css.includes('.ayuda-item'));
  check('respeta a quien prefiere menos animación', css.includes('prefers-reduced-motion'));
  check('tiñe el mapa de noche', css.includes('leaflet-tile-pane') && css.includes('hue-rotate'));
  check('contempla el notch del iPhone', css.includes('safe-area-inset'));

  const geo = leer('public/js/geo.js');
  check('geo.js documenta el fallo de iOS', /gesto/i.test(geo) && /iOS/.test(geo));
  check('pedirUbicacion no está declarada como async',
    /function pedirUbicacion\(/.test(geo) && !/async function pedirUbicacion/.test(geo));

  const ui = leer('public/js/ui.js');
  check('ui.js avisa de no poner await antes', /sin await antes/i.test(ui));
  check('pedirUbicacionUI tampoco es async', !/async function pedirUbicacionUI/.test(ui));

  group('Páginas nuevas');
  ['public/ayuda.html', 'public/demo.html'].forEach(f => check(`existe ${f}`, ex(f)));
  const ayuda = leer('public/ayuda.html');
  check('la ayuda carga el CSS nuevo', ayuda.includes('/css/styles.css'));
  check('la ayuda carga geo.js y ui.js', ayuda.includes('/js/geo.js') && ayuda.includes('/js/ui.js'));
  check('la ayuda pinta los apartados', ayuda.includes('pintarAyuda'));
  check('la ayuda trae comprobador de GPS', ayuda.includes('probarGps'));
  check('el botón de GPS llama al GPS de forma síncrona (iOS)',
    /onclick = function \(\) \{[\s\S]{0,400}GEO\.pedirUbicacion/.test(ayuda));
  check('la ayuda permite relanzar el tour', ayuda.includes("tour({ forzar: true })"));

  const demo = leer('public/demo.html');
  check('la demo enseña las chinchetas nuevas', demo.includes('pin-cuerpo') && demo.includes('pin-onda'));
  check('la demo enseña el selector de estrellas', demo.includes('pickerEstrellas'));
  check('la demo enseña el reparto de votos', demo.includes('UI.reparto'));
  check('la demo tiene mapa real', demo.includes('L.map'));

  const parche = leer('PARCHE.md');
  check('el parche explica la regla del gesto de iOS', /gesto/i.test(parche) && /await/.test(parche));
  check('el parche avisa de no subir los stubs', /No subas.*logic\.js/i.test(parche));
  check('el parche cubre las 5 partes',
    ['ARREGLO DE IPHONE', 'Puntuar bares', 'Pestaña de bares', 'Chinchetas', 'instrucciones']
      .every(t => parche.includes(t)));
}

/* ============================================================ */
(async () => {
  console.log('🍺 BirraMap v4 — batería completa\n' + '='.repeat(60));
  try {
    testRatingsLogica();
    await testRatingsApi();
    await testGeo();
    testUI();
    testFicheros();
  } catch (e) { failed++; out.push(`\n  💥 ${e.stack}`); }
  console.log(out.join('\n'));
  console.log('\n' + '='.repeat(60));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
