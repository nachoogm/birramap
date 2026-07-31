/* BirraMap v4 · batería completa.
   Ejecutar: node tests/test.js */
process.env.BIRRAMAP_FAKE_STORE = '1';
process.env.CHECKIN_COOLDOWN_MS = '0';
process.env.ROUND_COOLDOWN_MS = '0';

const path = require('path'), fs = require('fs');
let passed = 0, failed = 0;
const out = [];
const check = (n, c, extra = '') => { c ? (passed++, out.push(`  ✅ ${n}`)) : (failed++, out.push(`  ❌ ${n} ${extra}`)); };
const group = t => out.push(`\n▶ ${t}`);
const setG = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });

const ROOT = path.join(__dirname, '..');
const leer = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const existe = p => fs.existsSync(path.join(ROOT, p));

const R = require(path.join(ROOT, 'api/shared/ratings.js'));
const L = require(path.join(ROOT, 'api/shared/logic.js'));
const S = require(path.join(ROOT, 'api/shared/store.js'));
const fn = n => require(path.join(ROOT, 'api', n, 'index.js'));
const hdr = u => Buffer.from(JSON.stringify({ userId: u, userDetails: u, identityProvider: 'github' })).toString('base64');
async function call(name, { user, method = 'GET', body = null, query = {} } = {}) {
  const ctx = {};
  await fn(name)(ctx, { method, body, query, headers: user ? { 'x-ms-client-principal': hdr(user) } : {} });
  return ctx.res;
}

/* ============================================================
   1 · ESTRELLAS (lo que no funcionaba)
   ============================================================ */
function testEstrellasLogica() {
  group('Estrellas · validación');
  check('acepta de 0 a 5', [0,1,2,3,4,5].every(v => R.normalizarEstrellas(v) === v));
  check('acepta medias', R.normalizarEstrellas(3.5) === 3.5);
  check('redondea 3,7 a 3,5', R.normalizarEstrellas(3.7) === 3.5);
  check('rechaza 6', R.normalizarEstrellas(6) === null);
  check('rechaza negativos', R.normalizarEstrellas(-1) === null);
  check('rechaza texto', R.normalizarEstrellas('mucho') === null);
  check('el 0 es válido (bar horrible)', R.normalizarEstrellas(0) === 0);
  check('acepta número en texto', R.normalizarEstrellas('4') === 4);

  group('Estrellas · agrupación de bares');
  check('normaliza mayúsculas', R.clavePlace('Bar Manolo') === R.clavePlace('BAR MANOLO'));
  check('normaliza espacios', R.clavePlace('  Bar   Manolo ') === 'bar manolo');
  const filas = [
    { userId:'u1', nick:'Nacho', place:'Bar Manolo', stars:2, tsMs:1000 },
    { userId:'u1', nick:'Nacho', place:'Bar Manolo', stars:5, tsMs:5000 },
    { userId:'u2', nick:'Juan', place:'bar manolo', stars:4, tsMs:2000 },
    { userId:'u3', nick:'Ana', place:'La Tasca', stars:1, tsMs:3000 }
  ];
  const bares = R.agruparPorBar(filas);
  check('junta "Bar Manolo" y "bar manolo"', bares.length === 2, String(bares.length));
  const man = bares.find(b => R.clavePlace(b.place) === 'bar manolo');
  check('un voto por persona', man.votos === 2, String(man.votos));
  check('vale el voto nuevo, no el viejo', man.media === 4.5, String(man.media));
  check('muestra la grafía más usada', man.place === 'Bar Manolo');

  group('Estrellas · ranking por confianza');
  const muchos = [
    ...Array.from({length:20}, (_,i) => ({ userId:'x'+i, nick:'x', place:'Sitio Bueno', stars:4.5, tsMs:i })),
    { userId:'y1', nick:'y', place:'Chiringuito', stars:5, tsMs:1 }
  ];
  const rk = R.rankingBares(muchos);
  check('20 votos de 4,5 ganan a 1 de 5', rk[0].place === 'Sitio Bueno',
    JSON.stringify(rk.map(x => [x.place, x.puntuacion])));
  check('la media real se conserva', rk.find(x => x.place === 'Chiringuito').media === 5);
  check('más votos = más confianza', R.wilsonInferior(5,20) > R.wilsonInferior(5,1));
  check('la confianza nunca supera la media', R.wilsonInferior(4.5,20) <= 4.5);
  check('sin votos, cero', R.wilsonInferior(5,0) === 0);

  group('Estrellas · etiquetas y pendientes');
  check('4,7 es un templo', R.etiqueta(4.7,5).txt === 'un templo');
  check('0,5 es para huir', /huid/.test(R.etiqueta(0.5,3).txt));
  check('sin votos lo dice', R.etiqueta(0,0).txt === 'sin votos todavía');
  const pend = R.sinPuntuar(
    [{userId:'u1',place:'Bar Manolo',tsMs:100},{userId:'u1',place:'La Tasca',tsMs:200},{userId:'u2',place:'Otro',tsMs:300}],
    [{userId:'u1',place:'Bar Manolo',stars:4,tsMs:150}], 'u1');
  check('propone solo lo no votado', pend.length === 1 && pend[0].place === 'La Tasca', JSON.stringify(pend));
}

async function testEstrellasApi() {
  group('Estrellas · API');
  require(path.join(ROOT, 'api/shared/tables.js')).__resetMemory();
  await S.saveMember('u1', { nick:'Nacho', groupId:'lospavos' });
  await S.saveMember('u2', { nick:'Juan', groupId:'lospavos' });
  await S.saveMember('u3', { nick:'Ana', groupId:'lospavos' });
  await S.saveMember('x1', { nick:'Otro', groupId:'otrogrupo' });

  check('sin login → 401', (await call('ratings', {})).status === 401);
  check('sin grupo → 409', (await call('ratings', { user:'zz' })).status === 409);

  let r = await call('rating', { user:'u1', method:'POST', body:{ place:'Bar Manolo', stars:5, note:'las más frías' } });
  check('guarda la puntuación (201)', r.status === 201, JSON.stringify(r.body));
  check('devuelve la media del bar', r.body.bar && r.body.bar.media === 5);
  check('sin bar → 400', (await call('rating', { user:'u1', method:'POST', body:{ stars:4 } })).status === 400);
  check('6 estrellas → 400', (await call('rating', { user:'u1', method:'POST', body:{ place:'X', stars:6 } })).status === 400);
  check('0 estrellas SÍ vale', (await call('rating', { user:'u1', method:'POST', body:{ place:'Antro', stars:0 } })).status === 201);

  await call('rating', { user:'u2', method:'POST', body:{ place:'bar manolo', stars:4 } });
  await call('rating', { user:'u3', method:'POST', body:{ place:'BAR MANOLO', stars:3 } });
  const ficha = await call('ratings', { user:'u1', query:{ place:'Bar Manolo' } });
  check('agrupa los 3 votos', ficha.body.bar.votos === 3, String(ficha.body.bar.votos));
  check('media (5+4+3)/3 = 4', ficha.body.bar.media === 4);
  check('me dice mi voto', ficha.body.miVoto.stars === 5);
  check('y mi comentario', /más frías/.test(ficha.body.miVoto.note));
  check('incluye reparto para las barras', Array.isArray(ficha.body.bar.reparto));

  await call('rating', { user:'u1', method:'POST', body:{ place:'Bar Manolo', stars:2 } });
  const tras = await call('ratings', { user:'u1', query:{ place:'Bar Manolo' } });
  check('revotar NO añade voto', tras.body.bar.votos === 3, String(tras.body.bar.votos));
  check('la media se recalcula a 3', tras.body.bar.media === 3, String(tras.body.bar.media));

  const lista = await call('ratings', { user:'u1' });
  check('el ranking lista los bares', lista.body.total >= 2);
  check('marca mi voto en cada bar', lista.body.ranking.some(b => b.miVoto !== null));
  check('señala mejor y peor', !!lista.body.mejor && !!lista.body.peor);
  check('otro grupo no ve nada', (await call('ratings', { user:'x1' })).body.total === 0);

  await S.addCheckin('lospavos', { userId:'u1', nick:'Nacho', place:'Sitio Nuevo', qty:1, tsMs:Date.now(), day:'2026-07-30' });
  const p = await call('ratings', { user:'u1', query:{ pending:'1' } });
  check('propone puntuar donde estuve', p.body.pendientes.some(x => x.place === 'Sitio Nuevo'));
}

/* ============================================================
   2 · GPS iOS
   ============================================================ */
async function testGeo() {
  const GEO = require(path.join(ROOT, 'public/js/geo.js'));

  group('GPS · la regla del gesto de iOS');
  let dentroDelGesto = false, gestoVivo = true;
  const temps = [];
  setG('navigator', {
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1',
    geolocation: {
      getCurrentPosition(ok, err) {
        dentroDelGesto = gestoVivo;
        if (!gestoVivo) return;   /* iOS: silencio total */
        temps.push(setTimeout(() => ok({ coords:{ latitude:40.4168, longitude:-3.7038, accuracy:18 }, timestamp:Date.now() }), 50));
      },
      watchPosition(ok, err) { if (!gestoVivo) return 9; return 1; },
      clearWatch() { temps.forEach(clearTimeout); }
    }
  });
  setG('window', { isSecureContext:true, navigator:{standalone:false}, matchMedia:()=>({matches:false}) });

  /* método viejo: async con await antes */
  async function viejo() { await Promise.resolve(); gestoVivo = false;
    return GEO.pedirUbicacion({ opts:{ esperaMax:400, guardian:200 } }).promesa; }
  let fallaViejo = false;
  try { await viejo(); } catch { fallaViejo = true; }
  check('el método viejo (con await) falla en iOS', fallaViejo && dentroDelGesto === false);

  /* método nuevo: síncrono */
  gestoVivo = true; dentroDelGesto = false;
  const pos = await GEO.pedirUbicacion({ opts:{ esperaMax:3000, esperaMin:40, guardian:1500 } }).promesa;
  check('el nuevo llama al GPS dentro del gesto', dentroDelGesto === true);
  check('y consigue posición', !!pos && pos.accuracy === 18);
  check('pedirUbicacion NO es async', GEO.pedirUbicacion.constructor.name === 'Function');

  group('GPS · dos canales a la vez');
  let usoGet = false, usoWatch = false;
  const t2 = [];
  setG('navigator', { userAgent:'iPhone', geolocation:{
    getCurrentPosition(ok){ usoGet = true; },                 /* nunca responde */
    watchPosition(ok){ usoWatch = true;
      t2.push(setTimeout(() => ok({ coords:{latitude:40.4168,longitude:-3.7038,accuracy:25}, timestamp:Date.now() }), 60));
      return 1; },
    clearWatch(){ t2.forEach(clearTimeout); } } });
  const dos = await GEO.pedirUbicacion({ opts:{ esperaMax:2500, esperaMin:40, guardian:2000 } }).promesa;
  check('usa getCurrentPosition y watchPosition a la vez', usoGet && usoWatch);
  check('si uno calla, el otro salva la papeleta', dos.accuracy === 25);

  group('GPS · plan B cuando iOS enmudece');
  let alta = false, baja = false;
  const t3 = [];
  setG('navigator', { userAgent:'iPhone', geolocation:{
    getCurrentPosition(ok, err, o){ if (o.enableHighAccuracy) { alta = true; return; } baja = true;
      t3.push(setTimeout(() => ok({ coords:{latitude:40.4168,longitude:-3.7038,accuracy:480}, timestamp:Date.now() }), 40)); },
    watchPosition(){ return 1; }, clearWatch(){ t3.forEach(clearTimeout); } } });
  const rec = await GEO.pedirUbicacion({ opts:{ esperaMax:2500, esperaMin:40, guardian:250 } }).promesa;
  check('prueba primero alta precisión', alta);
  check('y lanza el plan B de baja', baja);
  check('recupera posición en vez de colgarse', rec.accuracy === 480);
  check('pero avisa de que es mala', ['mala','pesima'].includes(rec.calidad.nivel), rec.calidad.nivel);

  group('GPS · elegir la mejor lectura');
  const t4 = [];
  setG('navigator', { userAgent:'iPhone', geolocation:{
    getCurrentPosition(){}, watchPosition(ok){
      [{t:20,acc:3000,lat:40.42},{t:150,acc:700,lat:40.418},{t:380,acc:90,lat:40.417},{t:700,acc:14,lat:40.4168}]
        .forEach(f => t4.push(setTimeout(() => ok({ coords:{latitude:f.lat,longitude:-3.7038,accuracy:f.acc}, timestamp:Date.now() }), f.t)));
      return 1; }, clearWatch(){ t4.forEach(clearTimeout); } } });
  const prog = [];
  const fino = await GEO.pedirUbicacion({ onProgreso:(p,c)=>prog.push(Math.round(p.accuracy)),
    opts:{ objetivo:35, esperaMax:3000, esperaMin:250, guardian:2800 } }).promesa;
  check('descarta la primera lectura de 3 km', fino.accuracy < 100, `±${fino.accuracy} m`);
  check('se queda con la mejor', fino.accuracy === 14);
  check('informa del progreso', prog.length >= 3, JSON.stringify(prog));
  check('el progreso mejora', prog.every((v,i) => i === 0 || v < prog[i-1]), JSON.stringify(prog));

  group('GPS · permiso denegado corta al momento');
  setG('navigator', { userAgent:'iPhone', geolocation:{
    getCurrentPosition(ok, err){ setTimeout(() => err({ code:1 }), 10); },
    watchPosition(ok, err){ setTimeout(() => err({ code:1 }), 10); return 1; },
    clearWatch(){} } });
  const t0 = Date.now();
  let cap = null;
  try { await GEO.pedirUbicacion({ opts:{ esperaMax:9000, guardian:8000 } }).promesa; } catch (e) { cap = e; }
  check('no espera 9 segundos si el permiso está denegado', Date.now() - t0 < 1500, `${Date.now()-t0} ms`);
  check('da error explicado', !!(cap && cap.explicado));
  check('con pasos concretos', cap.explicado.pasos.length >= 4);
  check('menciona Ubicación precisa', cap.explicado.pasos.join(' ').includes('Ubicación precisa'));

  group('GPS · plataforma y calidad');
  setG('navigator', { userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  check('detecta iPhone', GEO.esIOS());
  setG('navigator', { userAgent:'Mozilla/5.0 (Linux; Android 14)' });
  check('no confunde Android', !GEO.esIOS() && GEO.esAndroid());
  setG('navigator', { userAgent:'Mac', platform:'MacIntel', maxTouchPoints:5 });
  check('detecta iPad moderno', GEO.esIOS());
  check('±15 m es excelente', GEO.calidad(15).nivel === 'excelente');
  check('±3 km no es usable', GEO.calidad(3000).usable === false);
  check('cada nivel tiene color y porcentaje', GEO.calidad(15).color !== GEO.calidad(3000).color && GEO.calidad(15).pct > GEO.calidad(3000).pct);
  check('~133 m en Madrid', (() => { const d = GEO.distancia(40.4168,-3.7038,40.4180,-3.7038); return d > 120 && d < 145; })());
}

/* ============================================================
   3 · ICONOS (sin emojis)
   ============================================================ */
function testIconos() {
  group('Iconos SVG · sin emojis');
  setG('document', { querySelectorAll: () => [] });
  const ICON = require(path.join(ROOT, 'public/js/icons.js'));

  check('hay más de 35 iconos', ICON.nombres.length >= 35, String(ICON.nombres.length));
  ['cana','tercio','ipa','vino','copa','gintonic','mapa','trofeo','estrella','monedas','persona',
   'pin','manos','casa','campana','ajustes','satelite','jarra']
    .forEach(n => check(`existe el icono "${n}"`, ICON.nombres.includes(n)));

  const svg = ICON.get('cana', 24);
  check('devuelve SVG válido', svg.startsWith('<svg') && svg.includes('</svg>'));
  check('respeta el tamaño pedido', ICON.get('cana', 40).includes('width="40"'));
  check('hereda el color del texto', svg.includes('currentColor'));
  check('icono inexistente devuelve vacío', ICON.get('noexiste') === '');

  /* la prueba de fuego: nada de emojis en el código del front */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  ['public/js/app.js','public/js/ui.js','public/js/icons.js','public/index.html']
    .forEach(f => {
      const txt = leer(f);
      const m = txt.match(new RegExp(EMOJI, 'gu'));
      check(`${f} no usa emojis`, !m, m ? `encontrados: ${[...new Set(m)].slice(0,8).join(' ')}` : '');
    });
}

/* ============================================================
   4 · EL FRONT ESTÁ CABLEADO (lo que falló la vez anterior)
   ============================================================ */
function testCableado() {
  group('Front · ficheros presentes');
  ['public/index.html','public/ayuda.html','public/css/styles.css','public/js/icons.js',
   'public/js/geo.js','public/js/ui.js','public/js/app.js','public/sw.js',
   'public/manifest.webmanifest','public/staticwebapp.config.json',
   'public/icons/icon-192.png','public/icons/icon-512.png']
    .forEach(f => check(`existe ${f}`, existe(f)));

  group('Front · index.html carga TODO lo nuevo');
  const html = leer('public/index.html');
  ['/css/styles.css','/js/icons.js','/js/geo.js','/js/ui.js','/js/app.js']
    .forEach(f => check(`index.html carga ${f}`, html.includes(f)));
  check('los scripts llevan ?v= para saltarse la caché', (html.match(/\?v=\d/g)||[]).length >= 5);
  check('icons.js va ANTES que app.js', html.indexOf('/js/icons.js') < html.indexOf('/js/app.js'));
  check('geo.js va ANTES que app.js', html.indexOf('/js/geo.js') < html.indexOf('/js/app.js'));
  check('ui.js va ANTES que app.js', html.indexOf('/js/ui.js') < html.indexOf('/js/app.js'));
  check('carga Leaflet', html.includes('leaflet.js'));
  check('carga leaflet.heat para el mapa de calor', html.includes('leaflet-heat'));

  group('Front · todas las páginas existen');
  ['mapa','ranking','bares','deudas','calor','perfil']
    .forEach(p => check(`página pg-${p}`, html.includes(`id="pg-${p}"`)));
  ['mapa','ranking','bares','deudas','perfil']
    .forEach(p => check(`entrada de menú a #/${p}`, html.includes(`href="#/${p}"`)));

  group('Front · botones de estrellas y GPS');
  check('botón de puntuar en el mapa', html.includes('id="fabPuntuar"'));
  check('botón de invitar ronda', html.includes('id="fabRonda"'));
  check('botón de fichar', html.includes('id="fabBeber"'));
  check('hueco para el estado del GPS', html.includes('id="geoStatus"'));

  group('Front · app.js cablea las funciones');
  const app = leer('public/js/app.js');
  check('define abrirPuntuar', /function abrirPuntuar\(/.test(app));
  check('el botón de puntuar la llama', /fabPuntuar[\s\S]{0,900}abrirPuntuar/.test(app));
  check('tras fichar ofrece puntuar', /Fichado[\s\S]{0,300}abrirPuntuar/.test(app));
  check('la página de bares tira de /api/ratings', /cargarBares[\s\S]{0,400}\/ratings/.test(app));
  check('guarda el voto en /api/rating', app.includes("api('/rating'"));
  check('usa el picker de estrellas de UI', app.includes('UI.pickerEstrellas'));

  check('define localizar()', /function localizar\(/.test(app));
  check('localizar NO es async (regla de iOS)', !/async function localizar/.test(app));
  check('el botón de fichar NO es async', !/\$\('#fabBeber'\)\.onclick = async/.test(app));
  check('llama a localizar ANTES de abrir el modal',
    /#fabBeber'\)\.onclick = function \(\) \{\s*localizar\(\);/.test(app),
    (app.match(/#fabBeber'\)\.onclick[\s\S]{0,120}/) || [''])[0]);
  check('usa UI.pedirUbicacionUI', app.includes('UI.pedirUbicacionUI'));
  check('el mapa usa la capa del tema', app.includes('TEMA.capaMapa'));
  check('las chinchetas son SVG, no emojis', app.includes('pin-cuerpo') && app.includes("ico(d.ico"));
  check('lanza el tour en el arranque', /UI\.tour\(\)/.test(app));

  group('Front · caché del service worker');
  const sw = leer('public/sw.js');
  check('el SW tiene versión', /const VERSION = '[^']+'/.test(sw));
  check('la versión del SW se ha subido', /VERSION = 'v5/.test(sw));
  check('el SW cachea tema.js', sw.includes('/js/tema.js'));
  check('usa skipWaiting para entrar ya', sw.includes('skipWaiting'));
  check('red primero en los ficheros propios', sw.includes('fetch(e.request)') && sw.includes('caches.match'));
  check('nunca cachea /api ni /.auth', sw.includes("startsWith('/api')") && sw.includes('/.auth'));
  check('app.js se recarga solo al detectar versión nueva', app.includes('updatefound') && app.includes('location.reload'));

  group('Front · estilos nuevos');
  const css = leer('public/css/styles.css');
  check('carga tipografías Outfit e Inter', css.includes('Outfit') && css.includes('Inter'));
  check('variables de color', css.includes('--oro') && css.includes('--surf'));
  ['subir','pulso','onda','flotar','brillo'].forEach(a => check(`animación ${a}`, css.includes(`@keyframes ${a}`)));
  check('estiliza las chinchetas', css.includes('.pin-cuerpo') && css.includes('.pin-onda'));
  check('estiliza el picker de estrellas', css.includes('.picker-est'));
  check('estiliza el tour', css.includes('.tour-card'));
  check('estiliza la ayuda plegable', css.includes('.ayuda-item'));
  check('respeta prefers-reduced-motion', css.includes('prefers-reduced-motion'));
  check('contempla el notch', css.includes('safe-area-inset'));
  check('el input usa 16px (evita el zoom de iOS)', /input[^}]*font-size:16px/.test(css));

  group('Front · mapa oscuro de verdad');
  const ui = leer('public/js/ui.js');
  check('usa teselas dark de CartoDB', ui.includes('cartocdn.com/dark_all'));
  check('ya no depende de un filtro CSS', !css.includes('hue-rotate(190deg)') || !css.includes('leaflet-tile-pane{filter'));
  check('la ayuda usa la misma capa', leer('public/ayuda.html').includes('UI.capaMapa'));

  group('API · endpoints presentes');
  ['me','checkin','checkins','ranking','round','debts','events','heatmap','home','nearby',
   'rating','ratings','prices','spend','health','purge']
    .forEach(e => check(`/api/${e}`, existe(`api/${e}/index.js`) && existe(`api/${e}/function.json`)));
  check('api/package.json con data-tables', JSON.parse(leer('api/package.json')).dependencies['@azure/data-tables']);
  const cfg = JSON.parse(leer('public/staticwebapp.config.json'));
  check('la API exige login', cfg.routes.some(r => r.route === '/api/*' && r.allowedRoles.includes('authenticated')));
  check('/api/health es público', cfg.routes.some(r => r.route === '/api/health' && r.allowedRoles.includes('anonymous')));
  check('el config está dentro de public/', existe('public/staticwebapp.config.json'));
  check('las cabeceras no cachean de más', /no-cache/.test(cfg.globalHeaders['Cache-Control']));

  group('Ayuda');
  const ay = leer('public/ayuda.html');
  check('carga los scripts nuevos', ay.includes('/js/icons.js') && ay.includes('/js/geo.js') && ay.includes('/js/ui.js'));
  check('pinta los apartados', ay.includes('pintarAyuda'));
  check('tiene comprobador de GPS', ay.includes('probarGps'));
  check('el botón de GPS es síncrono (iOS)', /#probarGps'\)\.onclick = function \(\)/.test(ay));
  check('permite relanzar el tour', ay.includes("tour({ forzar: true })"));
}

/* ============================================================
   5 · UI
   ============================================================ */
function testUI() {
  group('UI · componentes');
  const nodos = new Map();
  const nodo = () => ({ innerHTML:'', textContent:'', className:'', style:{}, dataset:{},
    classList:{ add(){}, remove(){}, toggle(){}, contains:()=>false },
    querySelectorAll:()=>[], querySelector:()=>null, appendChild(){}, remove(){}, onclick:null });
  setG('document', { querySelector: s => nodos.get(s) || null, querySelectorAll: () => [],
    createElement: () => nodo(), body:{ appendChild(){} }, addEventListener(){} });
  setG('localStorage', { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } });
  const ICON = require(path.join(ROOT, 'public/js/icons.js'));
  setG('ICON', ICON);
  const UI = require(path.join(ROOT, 'public/js/ui.js'));

  check('escapa HTML peligroso', UI.esc('<script>x</script>').includes('&lt;script&gt;'));
  const e4 = UI.estrellas(4);
  check('4 estrellas enciende 4', (e4.match(/class="ico on"/g)||[]).length === 4, e4.slice(0,120));
  check('pinta 5 en total', (e4.match(/<svg/g)||[]).length === 5);
  check('0 no enciende ninguna', !UI.estrellas(0).includes('ico on'));
  check('recorta por encima de 5', (UI.estrellas(9).match(/class="ico on"/g)||[]).length === 5);
  check('las estrellas son SVG', e4.includes('<svg'));

  const rep = UI.reparto([0,1,0,2,3,4], 10);
  check('el reparto pinta 5 filas', (rep.match(/reparto-fila/g)||[]).length === 5);
  check('calcula porcentajes', rep.includes('width:40%'));
  check('sin votos no pinta', UI.reparto([0,0,0,0,0,0], 0) === '');
  check('hay texto para cada nota', [0,1,2,3,4,5].every(n => !!UI.TEXTOS_NOTA[n]));

  group('UI · tour y ayuda');
  check('el tour tiene 5 pasos', UI.PASOS.length === 5);
  check('todos con icono y título', UI.PASOS.every(p => p.ico && p.tit));
  check('los pasos usan iconos, no emojis', UI.PASOS.every(p => !/[\u{1F300}-\u{1FAFF}]/u.test(p.ico)));
  check('el último es el final', UI.PASOS[UI.PASOS.length-1].final === true);
  check('la ayuda tiene 11 apartados', UI.AYUDA.length === 11, String(UI.AYUDA.length));
  const temas = UI.AYUDA.map(a => a.tit.toLowerCase()).join(' ');
  ['empiezo','fichar','ronda','puntuar','deuda','ranking','gps','aviso','noche','privacidad']
    .forEach(t => check(`la ayuda cubre "${t}"`, temas.includes(t)));
  const gps = UI.AYUDA.find(a => /gps/i.test(a.tit));
  check('la ayuda del GPS da los pasos de iPhone', /Ubicación precisa/i.test(gps.html));
  check('y los de Android', /Android/i.test(gps.html));
  check('vacío usa icono SVG', UI.vacio('jarra','x','y').includes('<svg'));
  check('cargando usa icono SVG', UI.cargando().includes('<svg'));
}

/* ============================================================
   6 · TEMAS
   ============================================================ */
function testTemas() {
  group('Temas · módulo');
  const store = {};
  let oscuroSistema = true;
  const raiz = { attrs:{}, style:{}, setAttribute(k,v){ this.attrs[k]=v; }, getAttribute(k){ return this.attrs[k]; } };
  const metas = [];
  setG('localStorage', { getItem:k=>store[k]??null, setItem(k,v){store[k]=v;} });
  setG('document', {
    documentElement: raiz,
    querySelector: s => s.includes('theme-color') ? (metas[0]||null) : null,
    createElement: () => { const m = { name:'', content:'' }; metas.push(m); return m; },
    head: { appendChild(){} }
  });
  setG('window', { matchMedia: q => ({ matches: /dark/.test(q) && oscuroSistema, addEventListener(){}, addListener(){} }) });

  for (const k of Object.keys(require.cache)) if (k.includes('tema.js')) delete require.cache[k];
  const TEMA = require(path.join(ROOT, 'public/js/tema.js'));

  check('por defecto está en automático', TEMA.modo() === 'auto');
  check('con el sistema en oscuro, resuelve oscuro', TEMA.efectivo() === 'oscuro');
  oscuroSistema = false;
  check('con el sistema en claro, resuelve claro', TEMA.efectivo() === 'claro');

  TEMA.set('claro');
  check('guarda el modo claro', store['birramap_tema'] === 'claro');
  check('lo pone en el html', raiz.getAttribute('data-tema') === 'claro');
  check('ajusta color-scheme', raiz.style.colorScheme === 'light');

  TEMA.set('oscuro');
  check('cambia a oscuro', raiz.getAttribute('data-tema') === 'oscuro' && raiz.style.colorScheme === 'dark');
  oscuroSistema = true;
  check('el modo fijo NO sigue al sistema', TEMA.efectivo() === 'oscuro');
  TEMA.set('auto');
  check('en auto vuelve a seguir al sistema', TEMA.efectivo() === 'oscuro');
  oscuroSistema = false;
  check('y reacciona si el sistema cambia', TEMA.efectivo() === 'claro');

  TEMA.set('oscuro');
  check('alternar pasa a claro', TEMA.alternar() === 'claro');
  check('y otra vez a oscuro', TEMA.alternar() === 'oscuro');
  check('rechaza modos inventados', (TEMA.set('fucsia'), TEMA.modo() === 'auto'));

  check('teselas distintas por tema', TEMA.urlTiles('oscuro') !== TEMA.urlTiles('claro'));
  check('oscuro usa dark_all', TEMA.urlTiles('oscuro').includes('dark_all'));
  check('claro usa light_all', TEMA.urlTiles('claro').includes('light_all'));
  check('actualiza la barra del navegador', metas.length > 0 && !!metas[0].content);

  let avisos = 0;
  const off = TEMA.alCambiar(() => avisos++);
  TEMA.set('claro'); TEMA.set('oscuro');
  check('avisa a los suscriptores', avisos === 2, String(avisos));
  off(); TEMA.set('claro');
  check('se puede desuscribir', avisos === 2);

  group('Temas · CSS');
  const css = leer('public/css/styles.css');
  check('define el tema oscuro', css.includes('[data-tema="oscuro"]'));
  check('define el tema claro', css.includes('[data-tema="claro"]'));
  ['--bg','--surf','--txt','--txt2','--txt3','--oro','--line']
    .forEach(v => check(`la variable ${v} existe en los dos temas`,
      (css.match(new RegExp(v.replace(/[-]/g,'\\-')+':','g'))||[]).length >= 2));
  check('el texto secundario sube de contraste', css.includes('--txt2:#c2d3ef'));
  check('hay color de texto dorado legible', css.includes('--oro-txt'));
  check('el fondo del mapa cambia con el tema', css.includes('--mapa-bg'));
  check('los estilos del selector de tema existen', css.includes('.tema-op'));
  check('hay estilos de esqueleto', css.includes('.skel-item') && css.includes('.skel-ico'));
  check('las transiciones de color son suaves', css.includes('transition:background-color .3s'));

  /* Contraste real: esto es lo que hacía que costase leer */
  const varsDe = sel => {
    const i = css.indexOf(sel);
    if (i < 0) return {};
    const b = css.slice(i, css.indexOf('}', i));
    const m = {};
    [...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].forEach(x => m[x[1]] = x[2].trim());
    return m;
  };
  const lum = h => {
    h = h.replace('#','');
    const c = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255)
      .map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  };
  const ratio = (a,b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  const esHex = v => /^#[0-9a-f]{6}$/i.test(v);

  const osc = varsDe(':root, [data-tema="oscuro"]');
  const cla = varsDe('[data-tema="claro"]');

  const faltan = Object.keys(osc).filter(k => !(k in cla));
  check('el tema claro define todas las variables del oscuro', faltan.length === 0, faltan.join(', '));

  [['oscuro', osc], ['claro', cla]].forEach(([nombre, v]) => {
    [['principal','--txt'], ['secundario','--txt2'], ['terciario','--txt3']].forEach(([et, k]) => {
      if (!esHex(v[k]) || !esHex(v['--surf'])) return;
      const r = ratio(v[k], v['--surf']);
      check(`${nombre}: texto ${et} legible (AA 4.5)`, r >= 4.5, `${r.toFixed(2)}:1`);
    });
  });

  group('Temas · HTML');
  const html = leer('public/index.html');
  check('script anti-destello antes del CSS',
    html.indexOf("data-tema") < html.indexOf('styles.css'), 'el script debe ir primero');
  check('el anti-destello lee localStorage', /localStorage\.getItem\('birramap_tema'\)/.test(html));
  check('carga tema.js', html.includes('/js/tema.js'));
  check('tema.js va antes que app.js', html.indexOf('/js/tema.js') < html.indexOf('/js/app.js'));
  check('botón de tema en la barra', html.includes('id="btnTema"'));
  check('selector de tema en Perfil', html.includes('id="temaSel"'));
  const ay = leer('public/ayuda.html');
  check('la ayuda también tiene anti-destello', ay.includes('birramap_tema'));
  check('y botón de tema', ay.includes('btnTemaAyuda'));

  const app = leer('public/js/app.js');
  check('app.js usa TEMA.capaMapa para el mapa', app.includes('TEMA.capaMapa()'));
  check('app.js pinta el selector de tema', app.includes('function pintarTema'));
  check('el botón alterna el tema', app.includes('TEMA.alternar()'));
  const ICON2 = require(path.join(ROOT, 'public/js/icons.js'));
  ['sol','luna','automatico'].forEach(n => check(`icono "${n}"`, ICON2.nombres.includes(n)));
}

/* ============================================================
   7 · RENDIMIENTO
   ============================================================ */
async function testRendimiento() {
  const C = require(path.join(ROOT, 'api/shared/cache.js'));

  group('Caché · comportamiento');
  C.reset();
  let llamadas = 0;
  const cargar = async () => { llamadas++; return { dato: 1 }; };
  await C.conCache('g1:agg:x', 30, cargar);
  await C.conCache('g1:agg:x', 30, cargar);
  await C.conCache('g1:agg:x', 30, cargar);
  check('3 lecturas = 1 sola consulta', llamadas === 1, String(llamadas));
  check('cuenta los aciertos', C.estado().aciertos === 2, JSON.stringify(C.estado()));

  C.set('g1:agg:y', { v: 1 }, 0);
  check('con TTL 0 caduca al momento', C.get('g1:agg:y') === null);

  C.set('g1:ratings:1', 'a', 60);
  C.set('g1:rounds:1', 'b', 60);
  C.set('g2:ratings:1', 'c', 60);
  C.invalidarGrupo('g1');
  check('invalidar un grupo no toca a los demás',
    C.get('g1:ratings:1') === null && C.get('g2:ratings:1') === 'c');

  C.set('g3:ratings:1', 'a', 60); C.set('g3:rounds:1', 'b', 60);
  C.invalidar('g3', 'ratings');
  check('se puede invalidar solo un tipo',
    C.get('g3:ratings:1') === null && C.get('g3:rounds:1') === 'b');

  group('Caché · la API no repite consultas');
  require(path.join(ROOT, 'api/shared/tables.js')).__resetMemory();
  C.reset();
  await S.saveMember('p1', { nick:'P1', groupId:'perf' });
  await S.saveMember('p2', { nick:'P2', groupId:'perf' });

  /* datos de una temporada entera */
  const ahora = Date.now();
  for (let i = 0; i < 60; i++) {
    await S.addRating('perf', { userId:'p'+((i%2)+1), nick:'P', place:`Bar ${i%12}`,
      placeKey:`bar ${i%12}`, stars:(i%5)+1, note:'', tsMs: ahora - i*3600000,
      ts:new Date(ahora-i*3600000).toISOString(), day:'2026-07-30' });
  }

  const t1 = Date.now();
  const r1 = await call('ratings', { user:'p1' });
  const ms1 = Date.now() - t1;
  const t2 = Date.now();
  const r2 = await call('ratings', { user:'p1' });
  const ms2 = Date.now() - t2;

  check('el ranking de bares sale bien', r1.body.total > 0, String(r1.body.total));
  check('la segunda carga da el mismo resultado', r1.body.total === r2.body.total);
  check('y es igual o más rápida (viene de caché)', ms2 <= ms1 + 2, `${ms1} ms → ${ms2} ms`);
  check('el caché tiene entradas', C.estado().entradas > 0);

  /* al votar, el caché se tira */
  const antes = r2.body.total;
  await call('rating', { user:'p2', method:'POST', body:{ place:'Bar Recién Abierto', stars:5 } });
  const r3 = await call('ratings', { user:'p1' });
  check('al votar aparece el bar nuevo al momento', r3.body.total === antes + 1,
    `${antes} → ${r3.body.total}`);

  group('Rendimiento · deudas');
  for (let i = 0; i < 30; i++) {
    await S.addRound('perf', { payerId:'p1', payerNick:'P1', drink:'cana', place:'Bar 1',
      priceCents:250, tsMs: ahora - i*3600000, ts:new Date().toISOString(), day:'2026-07-30',
      participants: JSON.stringify([{userId:'p1',nick:'P1'},{userId:'p2',nick:'P2'}]), size:2 });
  }
  const d1 = Date.now(); const dd1 = await call('debts', { user:'p1' }); const dms1 = Date.now()-d1;
  const d2 = Date.now(); const dd2 = await call('debts', { user:'p1' }); const dms2 = Date.now()-d2;
  check('las deudas se calculan', dd1.body.debts.length > 0);
  check('la segunda vez es igual o más rápida', dms2 <= dms1 + 2, `${dms1} ms → ${dms2} ms`);
  check('cada usuario ve su parte', Array.isArray(dd2.body.mine.owed));

  group('Rendimiento · miembros en paralelo');
  C.reset();
  const t3 = Date.now();
  const ms = await S.membersOf(['p1','p2','p1','p2','p1']);
  check('resuelve varios miembros', Object.keys(ms).length === 2);
  check('deduplica los repetidos', Date.now()-t3 < 200);

  group('Rendimiento · front');
  const app = leer('public/js/app.js');
  check('el front cachea las respuestas GET', app.includes('const _cache = new Map()'));
  check('deduplica peticiones simultáneas', app.includes('_enVuelo'));
  check('define TTL por ruta', /TTL = \{[\s\S]{0,200}'\/ratings'/.test(app));
  check('las escrituras invalidan el caché', app.includes('invalidarCache'));
  check('pinta lo cacheado y refresca por detrás', app.includes('apiRefresco'));
  check('usa esqueletos en vez de spinner', app.includes('UI.esqueleto'));
  check('precarga bares y deudas al arrancar', app.includes('function precargar'));
  const ui = leer('public/js/ui.js');
  check('UI.esqueleto existe', ui.includes('const esqueleto ='));
  check('el esqueleto imita la forma de la lista', ui.includes('skel-item') && ui.includes('skel-ico'));

  group('Rendimiento · ventanas de datos');
  const rat = leer('api/ratings/index.js');
  check('ratings ya no escanea 2 años', !rat.includes('730 * 86400000'));
  check('ratings usa ventana de 1 año', rat.includes('365 * 86400000'));
  check('ratings cachea el ranking calculado', rat.includes("agg:ranking"));
  check('los pendientes solo miran 60 días', rat.includes('60 * 86400000'));
  check('ratings pide en paralelo con Promise.all', rat.includes('Promise.all'));
  const deb = leer('api/debts/index.js');
  check('debts cachea el cálculo', deb.includes('agg:debts'));
  const heat = leer('api/heatmap/index.js');
  check('heatmap cachea', heat.includes('agg:heat'));
  const rank = leer('api/ranking/index.js');
  check('ranking cachea', rank.includes('agg:rank'));
  const store = leer('api/shared/store.js');
  check('store cachea los listados', store.includes('conCache'));
  check('escribir invalida el caché', store.includes('C.invalidar('));
  check('membersOf va en paralelo', store.includes('Promise.all'));
}

/* ============================================================ */
(async () => {
  console.log('🍺 BirraMap v4 · pruebas\n' + '='.repeat(62));
  try {
    testEstrellasLogica();
    await testEstrellasApi();
    await testGeo();
    testIconos();
    testCableado();
    testUI();
    testTemas();
    await testRendimiento();
  } catch (e) { failed++; out.push(`\n  💥 ${e.stack}`); }
  console.log(out.join('\n'));
  console.log('\n' + '='.repeat(62));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
