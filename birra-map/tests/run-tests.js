/* Tests de BirraMap. No necesita Azure: usa el store en memoria.
   Ejecutar:  node tests/run-tests.js   */
process.env.BIRRAMAP_FAKE_STORE = '1';
process.env.PURGE_KEY = 'test-key';
process.env.RETENTION_DAYS = '30';

const path = require('path');
const L = require(path.join(__dirname, '../api/shared/logic.js'));
const { __resetMemory } = require(path.join(__dirname, '../api/shared/tables.js'));

const fn = name => require(path.join(__dirname, '../api', name, 'index.js'));

let passed = 0, failed = 0;
const results = [];

function check(name, cond, extra = '') {
  if (cond) { passed++; results.push(`  ✅ ${name}`); }
  else { failed++; results.push(`  ❌ ${name} ${extra}`); }
}
function group(title) { results.push(`\n▶ ${title}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- helpers para llamar a las funciones ---------- */
const principalHeader = userId =>
  Buffer.from(JSON.stringify({ userId, userDetails: userId, identityProvider: 'github' })).toString('base64');

async function call(name, { user, method = 'GET', body = null, query = {}, headers = {} } = {}) {
  const ctx = {};
  const req = {
    method, body, query,
    headers: { ...(user ? { 'x-ms-client-principal': principalHeader(user) } : {}), ...headers }
  };
  await fn(name)(ctx, req);
  return ctx.res;
}
const join = (user, nick, groupId) => call('me', { user, method: 'POST', body: { nick, groupId } });

/* ============================================================
   1. LÓGICA PURA
   ============================================================ */
async function testLogic() {
  group('Lógica pura');

  /* claves invertidas */
  const now = Date.now();
  const k1 = L.invKey(now), k2 = L.invKey(now - 3600000);
  check('RowKey invertido ordena del más nuevo al más viejo', k1 < k2);
  check('invKey siempre tiene 13 caracteres', L.invKey(0).length === 13 && L.invKey(now).length === 13);
  const keys = new Set(Array.from({ length: 500 }, () => L.rowKeyFor(now, 'u1')));
  check('500 fichajes en el mismo milisegundo no colisionan (bug que cazó la simulación)', keys.size === 500, `(${keys.size} únicas)`);
  check('la RowKey sigue empezando por el timestamp invertido', L.rowKeyFor(now, 'u1').startsWith(L.invKey(now)));

  /* distancias */
  const d = L.distanceM(40.4168, -3.7038, 40.4180, -3.7038);
  check('distancia ~133 m entre dos puntos de Madrid', d > 120 && d < 145, `(${d} m)`);
  check('distancia a sí mismo = 0', L.distanceM(40.4, -3.7, 40.4, -3.7) === 0);
  const lejos = L.distanceM(40.4168, -3.7038, 41.3874, 2.1686);
  check('Madrid-Barcelona ~505 km', lejos > 495000 && lejos < 515000, `(${Math.round(lejos / 1000)} km)`);

  /* agregación de activos */
  const rows = [
    { userId: 'u1', nick: 'Nacho', drink: 'ipa', qty: 2, lat: 40.41, lon: -3.70, place: 'Bar A', ts: '', tsMs: now - 60000, day: '2026-07-30' },
    { userId: 'u1', nick: 'Nacho', drink: 'cana', qty: 1, lat: 40.41, lon: -3.70, place: 'Bar A', ts: '', tsMs: now - 600000, day: '2026-07-30' },
    { userId: 'u2', nick: 'Juan', drink: 'vino', qty: 1, lat: 40.42, lon: -3.71, place: 'Bar B', ts: '', tsMs: now - 120000, day: '2026-07-30' }
  ];
  const act = L.aggregateActive(rows, {}, now);
  check('agrupa por usuario', act.length === 2);
  check('suma las consumiciones del mismo usuario', act.find(a => a.userId === 'u1').total === 3);
  check('se queda con la bebida del último fichaje', act.find(a => a.userId === 'u1').drink === 'ipa');
  check('ordena por más reciente primero', act[0].userId === 'u1');
  check('marca como stale lo de hace más de 3 h',
    L.aggregateActive([{ ...rows[0], tsMs: now - 5 * 3600000 }], {}, now)[0].stale === true);

  /* ocultos */
  const oculto = L.aggregateActive(rows, { u1: { nick: 'Nacho', hiddenUntil: now } }, now);
  check('quien cierra la noche desaparece del mapa', oculto.length === 1 && oculto[0].userId === 'u2');

  /* estadísticas personales */
  const hoy = new Date(now).toISOString().slice(0, 10);
  const ayer = new Date(now - 86400000).toISOString().slice(0, 10);
  const own = [
    { drink: 'cana', qty: 2, place: 'Manolo', tsMs: now - 1000, day: hoy },
    { drink: 'cana', qty: 1, place: 'Manolo', tsMs: now - 86400000, day: ayer },
    { drink: 'ipa', qty: 5, place: 'Otro', tsMs: now - 10 * 86400000, day: '2026-07-20' }
  ];
  const st = L.myStats(own, now);
  check('cuenta bien las de hoy', st.today === 2, `(${st.today})`);
  check('bebida favorita por cantidad total', st.favorite === 'ipa', `(${st.favorite})`);
  check('bar más pisado', st.topPlace === 'Manolo');
  check('racha de 2 días', st.streak === 2, `(${st.streak})`);
  check('media de 30 días', st.avg30 === Math.round((8 / 30) * 10) / 10);
  check('sin datos no revienta', L.myStats([], now).today === 0 && L.myStats([], now).streak === 0);

  /* ranking */
  const rk = L.ranking(rows);
  check('ranking ordena por total', rk[0].userId === 'u1' && rk[0].total === 3);
  check('ranking cuenta sesiones (días distintos)', rk[0].sessions === 1);

  /* rondas y deudas */
  const R = (payer, nick, parts) => ({ payerId: payer, payerNick: nick, participants: JSON.stringify(parts) });
  const P = (id, nick) => ({ userId: id, nick });
  const rounds = [
    R('u1', 'Nacho', [P('u1', 'Nacho'), P('u2', 'Juan'), P('u3', 'Ana')]),
    R('u1', 'Nacho', [P('u1', 'Nacho'), P('u2', 'Juan')]),
    R('u2', 'Juan', [P('u1', 'Nacho'), P('u2', 'Juan')])
  ];
  const debts = L.netDebts(rounds);
  const juanDebe = debts.find(d => d.fromId === 'u2' && d.toId === 'u1');
  check('deuda compensada: Juan debe 1 a Nacho (2 recibidas − 1 pagada)', juanDebe && juanDebe.rounds === 1, JSON.stringify(debts));
  const anaDebe = debts.find(d => d.fromId === 'u3');
  check('Ana debe 1 a Nacho', anaDebe && anaDebe.rounds === 1 && anaDebe.toId === 'u1');
  check('el que invita no se debe a sí mismo', !debts.some(d => d.fromId === d.toId));
  check('sin rondas, sin deudas', L.netDebts([]).length === 0);

  const bal = L.roundStats(rounds);
  const nacho = bal.find(b => b.userId === 'u1');
  check('balance de Nacho: puso 2 rondas, invitó a 3, le invitaron 1',
    nacho.paid === 2 && nacho.given === 3 && nacho.received === 1 && nacho.balance === 2, JSON.stringify(nacho));
  check('balance ordenado, el más generoso arriba', bal[0].userId === 'u1');
  check('el balance del grupo siempre suma cero',
    bal.reduce((a, b) => a + b.balance, 0) === 0, JSON.stringify(bal.map(b => b.balance)));
  check('lo invitado por unos es lo recibido por otros',
    bal.reduce((a, b) => a + b.given, 0) === bal.reduce((a, b) => a + b.received, 0));

  /* heatmap */
  const hm = L.heatmap([
    { lat: 40.4168, lon: -3.7038, qty: 2, place: 'Manolo', userId: 'u1' },
    { lat: 40.41681, lon: -3.70381, qty: 3, place: 'Manolo', userId: 'u2' },
    { lat: 40.5000, lon: -3.6000, qty: 1, place: 'Lejos', userId: 'u1' }
  ]);
  check('heatmap junta puntos cercanos en la misma celda', hm.length === 2, `(${hm.length})`);
  check('heatmap suma pesos', hm[0].weight === 5, `(${hm[0].weight})`);
  check('heatmap nombra la celda con el bar más repetido', hm[0].place === 'Manolo');

  const tp = L.topPlaces([
    { place: 'Manolo', qty: 2, userId: 'u1' }, { place: 'Manolo', qty: 1, userId: 'u2' }, { place: 'Otro', qty: 1, userId: 'u1' }
  ]);
  check('top de bares por consumiciones', tp[0].place === 'Manolo' && tp[0].drinks === 3 && tp[0].people === 2);

  /* proximidad */
  const near = L.nearbyPeople(act, 40.41, -3.70, 300, 4 * 3600000, now);
  check('nearby filtra por radio de 300 m', near.length === 1 && near[0].userId === 'u1', JSON.stringify(near.map(n => n.distance)));
  const near2 = L.nearbyPeople(act, 40.41, -3.70, 2000, 4 * 3600000, now);
  check('con 2 km entran los dos', near2.length === 2);
  check('nearby ignora fichajes viejos',
    L.nearbyPeople(act, 40.41, -3.70, 5000, 30000, now).length === 0);

  /* periodos */
  const t = new Date('2026-07-30T21:00:00Z').getTime();
  check('inicio de mes correcto', new Date(L.startOfMonth(t)).getDate() === 1);
  check('inicio de semana es lunes', new Date(L.startOfWeek(t)).getDay() === 1);
  check('inicio de año es enero', new Date(L.startOfYear(t)).getMonth() === 0);

  /* eventos */
  check('evento activo dentro de ventana', L.eventActive({ startsMs: t - 1000, endsMs: t + 1000 }, t));
  check('evento no activo fuera de ventana', !L.eventActive({ startsMs: t + 1000, endsMs: t + 2000 }, t));
}

/* ============================================================
   2. API DE PUNTA A PUNTA
   ============================================================ */
async function testApi() {
  group('API: cuentas y grupos');
  __resetMemory();

  check('sin login la API responde 401', (await call('me')).status === 401);
  check('usuario nuevo entra sin grupo', (await call('me', { user: 'u1' })).body.groupId === null);

  const bad = await call('me', { user: 'u1', method: 'POST', body: { nick: 'Nacho', groupId: 'AB' } });
  check('rechaza códigos de grupo inválidos', bad.status === 400, JSON.stringify(bad.body));

  const r1 = await join('u1', 'Nacho', 'LosPavos2026');
  check('se une al grupo y lo normaliza a minúsculas', r1.body.groupId === 'lospavos2026');
  await join('u2', 'Juan', 'lospavos2026');
  await join('u3', 'Ana', 'lospavos2026');
  await join('x1', 'Intruso', 'otrogrupo');

  check('endpoint protegido sin grupo devuelve 409',
    (await call('checkins', { user: 'zz' })).status === 409);

  group('API: fichar');
  const ci = await call('checkin', {
    user: 'u1', method: 'POST',
    body: { drink: 'ipa', qty: 2, lat: 40.4168, lon: -3.7038, place: 'Bar Manolo', note: 'vente' }
  });
  check('fichaje creado (201)', ci.status === 201, JSON.stringify(ci.body));

  const spam = await call('checkin', { user: 'u1', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7038 } });
  check('anti-spam: segundo fichaje seguido da 429', spam.status === 429);
  process.env.CHECKIN_COOLDOWN_MS = '0';   // el resto de tests corre en milisegundos
  process.env.ROUND_COOLDOWN_MS = '0';

  const badGeo = await call('checkin', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 999, lon: 0 } });
  check('coordenadas imposibles → 400', badGeo.status === 400);

  const badDrink = await call('checkin', { user: 'u2', method: 'POST', body: { drink: 'absenta-turbo', lat: 40.4168, lon: -3.7039 } });
  check('bebida desconocida cae a caña por defecto', badDrink.status === 201);

  const qtyMax = await call('checkin', { user: 'u3', method: 'POST', body: { drink: 'cana', qty: 999, lat: 40.4168, lon: -3.7040 } });
  check('cantidad se capa a 20', qtyMax.status === 201);

  const list = await call('checkins', { user: 'u1', query: { hours: '12' } });
  check('el grupo ve 3 personas activas', list.body.active.length === 3, `(${list.body.active.length})`);
  check('cantidad capada realmente a 20', list.body.active.find(a => a.userId === 'u3').total === 20);
  check('mis estadísticas se calculan', list.body.me.today === 2, `(${list.body.me.today})`);

  const intruso = await call('checkins', { user: 'x1' });
  check('otro grupo no ve nada de los Pavos', intruso.body.active.length === 0);

  group('API: rondas');
  const ronda = await call('round', {
    user: 'u1', method: 'POST',
    body: { drink: 'cana', lat: 40.4168, lon: -3.7038, place: 'Bar Manolo', participants: ['u2', 'u3'] }
  });
  check('ronda creada para 3 personas', ronda.status === 201 && ronda.body.size === 3, JSON.stringify(ronda.body));

  process.env.ROUND_COOLDOWN_MS = '60000';
  const dobleRonda = await call('round', {
    user: 'u1', method: 'POST',
    body: { drink: 'cana', lat: 40.4168, lon: -3.7038, participants: ['u2'] }
  });
  check('anti-spam de rondas: no puedes invitar dos veces seguidas', dobleRonda.status === 429, JSON.stringify(dobleRonda.body));
  process.env.ROUND_COOLDOWN_MS = '0';

  const sola = await call('round', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 40.41, lon: -3.70, participants: [] } });
  check('ronda de uno solo → 400', sola.status === 400);

  const conIntruso = await call('round', {
    user: 'u2', method: 'POST',
    body: { drink: 'cana', lat: 40.41, lon: -3.70, participants: ['x1'] }
  });
  check('no puedes meter a gente de otro grupo en la ronda', conIntruso.status === 400, JSON.stringify(conIntruso.body));

  const tras = await call('checkins', { user: 'u1' });
  const u2 = tras.body.active.find(a => a.userId === 'u2');
  check('la ronda suma una consumición a cada participante', u2.total === 2, `(${u2.total})`);
  check('la ronda aparece en el histórico', tras.body.rounds.length === 1);

  group('API: concurrencia');
  /* grupo aparte para no contaminar los datos de los Pavos */
  await join('c1', 'Conc1', 'grupoconcurrencia');
  await join('c2', 'Conc2', 'grupoconcurrencia');
  await Promise.all([1, 2, 3, 4, 5].map(() =>
    call('checkin', { user: 'c1', method: 'POST', body: { drink: 'cana', qty: 1, lat: 40.4168, lon: -3.7038, place: 'Bar Test' } })));
  const conc = (await call('checkins', { user: 'c1' })).body.active.find(a => a.userId === 'c1');
  check('5 fichajes simultáneos se guardan los 5', conc.total === 5, `(${conc.total})`);

  const [ra, rb] = await Promise.all([
    call('round', { user: 'c1', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7038, participants: ['c2'] } }),
    call('round', { user: 'c2', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7038, participants: ['c1'] } })
  ]);
  check('dos rondas en el mismo milisegundo no chocan', ra.status === 201 && rb.status === 201, `${ra.status}/${rb.status}`);
  const concDeb = await call('debts', { user: 'c1' });
  check('rondas cruzadas se compensan y nadie debe nada', concDeb.body.debts.length === 0, JSON.stringify(concDeb.body.debts));

  group('API: deudas');
  await call('round', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7038, participants: ['u1'] } });
  const deu = await call('debts', { user: 'u1' });
  const anaDebe = deu.body.debts.find(d => d.fromId === 'u3' && d.toId === 'u1');
  check('Ana debe 1 ronda a Nacho', anaDebe && anaDebe.rounds === 1, JSON.stringify(deu.body.debts));
  check('Nacho y Juan quedan en paz (1 y 1)', !deu.body.debts.some(d =>
    (d.fromId === 'u1' && d.toId === 'u2') || (d.fromId === 'u2' && d.toId === 'u1')), JSON.stringify(deu.body.debts));
  check('me dice a quién le debo yo', Array.isArray(deu.body.mine.owed));
  check('balance por persona disponible', deu.body.balance.length >= 3);

  group('API: proximidad');
  const near = await call('nearby', { user: 'u1', query: { lat: '40.4168', lon: '-3.7038', radius: '300' } });
  check('encuentra a los que están al lado', near.body.people.length >= 2, `(${near.body.people.length})`);
  check('devuelve la distancia en metros', typeof near.body.people[0].distance === 'number');
  const nearFar = await call('nearby', { user: 'u1', query: { lat: '41.3874', lon: '2.1686', radius: '300' } });
  check('desde Barcelona no ve a nadie de Madrid', nearFar.body.people.length === 0);
  check('sin coordenadas → 400', (await call('nearby', { user: 'u1', query: {} })).status === 400);

  group('API: ranking');
  const rk = await call('ranking', { user: 'u1', query: { period: 'day' } });
  check('ranking del día devuelve lista', rk.body.list.length === 3);
  check('ranking ordenado de mayor a menor', rk.body.list[0].total >= rk.body.list[1].total);
  check('ranking cuenta rondas pagadas', rk.body.list.find(x => x.userId === 'u1').roundsPaid === 1);
  check('ranking mensual también funciona', (await call('ranking', { user: 'u1', query: { period: 'month' } })).body.list.length === 3);

  group('API: eventos');
  const ahora = Date.now();
  const ev = await call('events', {
    user: 'u1', method: 'POST',
    body: { name: 'Oktoberfest 2026', startsAt: new Date(ahora - 3600000).toISOString(), endsAt: new Date(ahora + 86400000).toISOString() }
  });
  check('evento creado', ev.status === 201, JSON.stringify(ev.body));
  const evBad = await call('events', {
    user: 'u1', method: 'POST',
    body: { name: 'Mal', startsAt: new Date(ahora).toISOString(), endsAt: new Date(ahora - 1000).toISOString() }
  });
  check('evento con fechas al revés → 400', evBad.status === 400);
  const evs = await call('events', { user: 'u2' });
  check('el grupo ve el evento', evs.body.length === 1 && evs.body[0].active === true);

  const rkEv = await call('ranking', { user: 'u1', query: { eventId: ev.body.id } });
  check('ranking filtrado por evento', rkEv.body.label === 'Oktoberfest 2026' && rkEv.body.list.length === 3);
  check('evento inexistente → 404', (await call('ranking', { user: 'u1', query: { eventId: 'nope' } })).status === 404);
  check('solo el creador puede borrar el evento',
    (await call('events', { user: 'u2', method: 'DELETE', query: { id: ev.body.id } })).status === 403);

  group('API: heatmap');
  const hm = await call('heatmap', { user: 'u1', query: { days: '365' } });
  check('heatmap devuelve puntos', hm.body.points.length > 0);
  check('heatmap devuelve top de bares', hm.body.top.length > 0 && hm.body.top[0].place === 'Bar Manolo');
  check('heatmap cuenta el total de consumiciones', hm.body.totalDrinks > 0);
  const hmMe = await call('heatmap', { user: 'u3', query: { scope: 'me' } });
  check('heatmap personal filtra solo lo mío', hmMe.body.scope === 'me' && hmMe.body.totalDrinks === 21, `(${hmMe.body.totalDrinks})`);

  group('API: he llegado a casa');
  const casa = await call('home', { user: 'u3', method: 'POST' });
  check('marca llegada a casa', casa.status === 200 && casa.body.homeAt > 0);
  const trasCasa = await call('checkins', { user: 'u1' });
  check('quien llega a casa sale del mapa', !trasCasa.body.active.some(a => a.userId === 'u3'));
  check('el grupo ve que ha llegado bien', trasCasa.body.home.some(h => h.userId === 'u3'));

  await call('checkin', { user: 'u3', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7038 } });
  const vuelta = await call('checkins', { user: 'u1' });
  check('si vuelve a fichar, reaparece en el mapa', vuelta.body.active.some(a => a.userId === 'u3'));

  group('API: cerrar la noche');
  await call('checkin', { user: 'u2', method: 'DELETE' });
  const trasCerrar = await call('checkins', { user: 'u1' });
  check('cerrar la noche te quita del mapa', !trasCerrar.body.active.some(a => a.userId === 'u2'));
  const rkTras = await call('ranking', { user: 'u1', query: { period: 'day' } });
  check('pero conserva sus estadísticas en el ranking', rkTras.body.list.some(x => x.userId === 'u2'));

  group('API: purga');
  check('purga sin clave → 403', (await call('purge', { method: 'POST' })).status === 403);
  const pg = await call('purge', { method: 'POST', headers: { 'x-purge-key': 'test-key' } });
  check('purga con clave funciona', pg.status === 200, JSON.stringify(pg.body));
  check('no borra lo reciente', pg.body.deleted.checkins === 0, JSON.stringify(pg.body.deleted));
}

/* ============================================================
   3. FICHEROS DEL REPO (lo que rompió el deploy)
   ============================================================ */
async function testRepo() {
  group('Repo y despliegue');
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const exists = p => fs.existsSync(path.join(root, p));

  const pkg = JSON.parse(read('package.json'));
  check('existe package.json en la raíz con script build (esto es lo que fallaba en Oryx)',
    !!(pkg.scripts && pkg.scripts.build));

  const wf = read('.github/workflows/azure-static-web-apps.yml');
  check('el workflow apunta a /public', wf.includes('app_location: "/public"'));
  check('el workflow apunta a /api', wf.includes('api_location: "/api"'));
  check('el workflow salta el build del front', wf.includes('skip_app_build: true'));

  const cfg = JSON.parse(read('staticwebapp.config.json'));
  check('la API exige estar autenticado', cfg.routes.some(r => r.route === '/api/*' && r.allowedRoles.includes('authenticated')));

  const mani = JSON.parse(read('public/manifest.webmanifest'));
  check('el manifest tiene los dos iconos', mani.icons.length === 2);
  check('los iconos existen de verdad', exists('public/icons/icon-192.png') && exists('public/icons/icon-512.png'));

  const tablesSrc = read('api/shared/tables.js');
  check('acepta STORAGE_CONNECTION_STRING y STORE_CONNECTION_STRING (el nombre de tu portal)',
    tablesSrc.includes('STORAGE_CONNECTION_STRING') && tablesSrc.includes('STORE_CONNECTION_STRING'));

  const sw = read('public/sw.js');
  check('el service worker nunca cachea /api ni /.auth', sw.includes("startsWith('/api')") && sw.includes("/.auth"));

  for (const f of ['me', 'checkin', 'checkins', 'ranking', 'round', 'debts', 'events', 'heatmap', 'home', 'nearby', 'purge']) {
    check(`endpoint /api/${f} declarado correctamente`,
      exists(`api/${f}/function.json`) && JSON.parse(read(`api/${f}/function.json`)).bindings[0].route === f);
  }
}

/* ============================================================
   4. FRONTEND (sintaxis, rutas y enlaces)
   ============================================================ */
async function testFrontend() {
  group('Frontend');
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

  /* el JS compila */
  let syntaxOk = true, syntaxErr = '';
  try { new (require('vm').Script)(js); } catch (e) { syntaxOk = false; syntaxErr = e.message; }
  check('app.js no tiene errores de sintaxis', syntaxOk, syntaxErr);

  /* multipágina: cada entrada del menú tiene su página */
  for (const p of ['mapa', 'ranking', 'deudas', 'heat', 'perfil']) {
    check(`la pestaña "${p}" tiene su página en el HTML`, html.includes(`id="pg-${p}"`) && html.includes(`href="#/${p}"`));
  }
  check('la página de eventos existe', html.includes('id="pg-eventos"'));
  check('hay router por hash', js.includes("addEventListener('hashchange'"));

  /* cada endpoint que llama el front existe en la API */
  const llamadas = [...js.matchAll(/api\([`'"]\/([a-z]+)/g)].map(m => m[1]);
  const unicos = [...new Set(llamadas)];
  check('el front llama a los endpoints reales', unicos.every(u => fs.existsSync(path.join(root, 'api', u))), unicos.join(','));
  check('usa todos los endpoints nuevos', ['round', 'debts', 'events', 'heatmap', 'home', 'nearby'].every(e => unicos.includes(e)));

  /* elementos que el JS toca deben existir en el HTML */
  const ids = [...new Set([...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]))];
  const faltan = ids.filter(id => !html.includes(`id="${id}"`));
  check('todos los ids que usa el JS existen en el HTML', faltan.length === 0, faltan.join(', '));

  /* clases CSS clave */
  for (const c of ['.pin', '.sheet', '.fab', '.nav', '.modal', '.row', '.hero'])
    check(`el CSS define ${c}`, css.includes(c));

  /* seguridad básica: escapado de texto de usuario */
  check('escapa el HTML de los motes y mensajes', js.includes('const esc =') && js.includes('esc(c.nick)'));
  check('las notificaciones respetan el radio de 500 m', js.includes('NOTIF_RADIUS = 500'));
  check('carga la librería de heatmap', html.includes('leaflet-heat'));
  check('hay botón de he llegado a casa', html.includes('id="btnHome"') && js.includes("api('/home'"));
  check('hay botón de invito yo', html.includes('id="fabRound"') && js.includes("api('/round'"));
}

/* ============================================================ */
(async () => {
  console.log('🍺 BirraMap — batería de tests\n' + '='.repeat(52));
  try {
    await testLogic();
    await testApi();
    await testRepo();
    await testFrontend();
  } catch (e) {
    failed++;
    results.push(`\n  💥 EXCEPCIÓN: ${e.stack}`);
  }
  console.log(results.join('\n'));
  console.log('\n' + '='.repeat(52));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
