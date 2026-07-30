/* Tests de BirraMap. No necesita Azure: usa el store en memoria.
   Ejecutar: node tests/run-tests.js */
process.env.BIRRAMAP_FAKE_STORE = '1';
process.env.PURGE_KEY = 'test-key';
process.env.RETENTION_DAYS = '30';

const path = require('path');
const fs = require('fs');
const L = require(path.join(__dirname, '../api/shared/logic.js'));
const { __resetMemory } = require(path.join(__dirname, '../api/shared/tables.js'));
const fn = name => require(path.join(__dirname, '../api', name, 'index.js'));

let passed = 0, failed = 0;
const results = [];
const check = (name, cond, extra = '') => {
  if (cond) { passed++; results.push(`  ✅ ${name}`); }
  else { failed++; results.push(`  ❌ ${name} ${extra}`); }
};
const group = t => results.push(`\n▶ ${t}`);

const principalHeader = u => Buffer.from(JSON.stringify({ userId: u, userDetails: u, identityProvider: 'github' })).toString('base64');
async function call(name, { user, method = 'GET', body = null, query = {}, headers = {} } = {}) {
  const ctx = {};
  await fn(name)(ctx, { method, body, query, headers: { ...(user ? { 'x-ms-client-principal': principalHeader(user) } : {}), ...headers } });
  return ctx.res;
}
const join = (user, nick, groupId, price) => call('me', { user, method: 'POST', body: { nick, groupId, defaultPrice: price } });

/* ============================================================
   1. LÓGICA PURA
   ============================================================ */
function testLogic() {
  group('Lógica: claves y concurrencia');
  const now = Date.now();
  check('RowKey invertido ordena del más nuevo al más viejo', L.invKey(now) < L.invKey(now - 3600000));
  check('invKey siempre tiene 13 caracteres', L.invKey(0).length === 13 && L.invKey(now).length === 13);
  const keys = new Set(Array.from({ length: 500 }, () => L.rowKeyFor(now, 'u1')));
  check('500 fichajes en el mismo milisegundo no colisionan', keys.size === 500, `(${keys.size})`);
  check('la RowKey empieza por el timestamp invertido', L.rowKeyFor(now, 'u1').startsWith(L.invKey(now)));

  group('Lógica: dinero');
  check('2,50 € → 250 céntimos', L.toCents('2,50') === 250);
  check('acepta punto decimal', L.toCents('2.50') === 250);
  check('acepta número', L.toCents(2.5) === 250);
  check('vacío → 0', L.toCents('') === 0 && L.toCents(null) === 0 && L.toCents(undefined) === 0);
  check('negativos → 0', L.toCents(-5) === 0);
  check('texto basura → 0', L.toCents('gratis') === 0);
  check('redondea a céntimo', L.toCents(2.555) === 256 || L.toCents(2.555) === 255);
  check('tope de 1000 € por consumición', L.toCents(99999) === 100000);
  check('formatea en euros', L.eur(250) === '2,50 €');
  check('coste = precio × cantidad', L.rowCost({ priceCents: 250, qty: 3 }) === 750);
  check('sin precio, coste 0', L.rowCost({ qty: 3 }) === 0);

  group('Lógica: distancias');
  const d = L.distanceM(40.4168, -3.7038, 40.4180, -3.7038);
  check('~133 m entre dos puntos de Madrid', d > 120 && d < 145, `(${d} m)`);
  check('distancia a sí mismo = 0', L.distanceM(40.4, -3.7, 40.4, -3.7) === 0);
  const lejos = L.distanceM(40.4168, -3.7038, 41.3874, 2.1686);
  check('Madrid-Barcelona ~505 km', lejos > 495000 && lejos < 515000, `(${Math.round(lejos / 1000)} km)`);

  group('Lógica: activos y gasto');
  const rows = [
    { userId: 'u1', nick: 'Nacho', drink: 'ipa', qty: 2, priceCents: 350, lat: 40.41, lon: -3.70, place: 'Bar A', ts: '', tsMs: now - 60000, day: '2026-07-30', payerId: 'u1' },
    { userId: 'u1', nick: 'Nacho', drink: 'cana', qty: 1, priceCents: 250, lat: 40.41, lon: -3.70, place: 'Bar A', ts: '', tsMs: now - 600000, day: '2026-07-30', payerId: 'u1' },
    { userId: 'u2', nick: 'Juan', drink: 'vino', qty: 1, priceCents: 300, lat: 40.42, lon: -3.71, place: 'Bar B', ts: '', tsMs: now - 120000, day: '2026-07-30', payerId: 'u2' }
  ];
  const act = L.aggregateActive(rows, {}, now);
  check('agrupa por usuario', act.length === 2);
  check('suma consumiciones del mismo usuario', act.find(a => a.userId === 'u1').total === 3);
  check('suma el gasto (2×3,50 + 1×2,50 = 9,50)', act.find(a => a.userId === 'u1').spentCents === 950, `(${act.find(a => a.userId === 'u1').spentCents})`);
  check('se queda con la bebida del último fichaje', act.find(a => a.userId === 'u1').drink === 'ipa');
  check('ordena por más reciente', act[0].userId === 'u1');
  check('marca stale lo de hace más de 3 h', L.aggregateActive([{ ...rows[0], tsMs: now - 5 * 3600000 }], {}, now)[0].stale === true);
  check('quien cierra la noche desaparece', L.aggregateActive(rows, { u1: { nick: 'Nacho', hiddenUntil: now } }, now).length === 1);

  /* invitado: el gasto va al que paga, no al que bebe */
  const conRonda = [
    { userId: 'u2', nick: 'Juan', drink: 'cana', qty: 1, priceCents: 250, lat: 40.41, lon: -3.70, tsMs: now, day: 'x', viaRound: true, payerId: 'u1' },
    { userId: 'u1', nick: 'Nacho', drink: 'cana', qty: 1, priceCents: 250, lat: 40.41, lon: -3.70, tsMs: now, day: 'x', viaRound: true, payerId: 'u1' }
  ];
  const gastos = L.spentByUser(conRonda);
  check('el que invita carga con todo el gasto de la ronda', gastos.u1 === 500 && !gastos.u2, JSON.stringify(gastos));
  const actR = L.aggregateActive(conRonda, {}, now);
  check('al invitado le suma la copa pero no el gasto', actR.find(a => a.userId === 'u2').total === 1 && actR.find(a => a.userId === 'u2').spentCents === 0);

  group('Lógica: estadísticas personales');
  const hoy = new Date(now).toISOString().slice(0, 10);
  const ayer = new Date(now - 86400000).toISOString().slice(0, 10);
  const own = [
    { drink: 'cana', qty: 2, priceCents: 250, place: 'Manolo', tsMs: now - 1000, day: hoy },
    { drink: 'cana', qty: 1, priceCents: 250, place: 'Manolo', tsMs: now - 86400000, day: ayer },
    { drink: 'ipa', qty: 5, priceCents: 400, place: 'Otro', tsMs: now - 10 * 86400000, day: '2026-07-20' }
  ];
  const st = L.myStats(own, now);
  check('cuenta las de hoy', st.today === 2);
  check('gasto de hoy = 5,00 €', st.spentToday === 500, `(${st.spentToday})`);
  check('gasto 30 días = 27,50 €', st.spent30 === 2750, `(${st.spent30})`);
  check('precio medio ponderado', st.avgPriceCents === Math.round(2750 / 8), `(${st.avgPriceCents})`);
  check('bebida favorita', st.favorite === 'ipa');
  check('bar más pisado', st.topPlace === 'Manolo');
  check('racha de 2 días', st.streak === 2);
  check('sin datos no revienta', L.myStats([], now).today === 0 && L.myStats([], now).avgPriceCents === 0);

  group('Lógica: ranking y deudas');
  const rk = L.ranking(rows);
  check('ranking ordena por total', rk[0].userId === 'u1' && rk[0].total === 3);
  check('ranking incluye el gasto', rk[0].spentCents === 950);
  check('ranking cuenta sesiones', rk[0].sessions === 1);

  const R = (payer, nick, parts, price) => ({ payerId: payer, payerNick: nick, participants: JSON.stringify(parts), priceCents: price });
  const P = (id, nick) => ({ userId: id, nick });
  const rounds = [
    R('u1', 'Nacho', [P('u1', 'Nacho'), P('u2', 'Juan'), P('u3', 'Ana')], 250),
    R('u1', 'Nacho', [P('u1', 'Nacho'), P('u2', 'Juan')], 250),
    R('u2', 'Juan', [P('u1', 'Nacho'), P('u2', 'Juan')], 300)
  ];
  const debts = L.netDebts(rounds);
  const juan = debts.find(d => d.fromId === 'u2' && d.toId === 'u1');
  check('Juan debe 1 ronda a Nacho (2 recibidas − 1 puesta)', juan && juan.rounds === 1, JSON.stringify(debts));
  check('la deuda también va en euros (500 − 300 = 200)', juan && juan.cents === 200, JSON.stringify(juan));
  const ana = debts.find(d => d.fromId === 'u3');
  check('Ana debe 1 a Nacho', ana && ana.rounds === 1 && ana.toId === 'u1');
  check('el que invita no se debe a sí mismo', !debts.some(d => d.fromId === d.toId));
  check('sin rondas, sin deudas', L.netDebts([]).length === 0);

  const bal = L.roundStats(rounds);
  const n = bal.find(b => b.userId === 'u1');
  check('Nacho puso 2 rondas, invitó a 3, le invitaron 1', n.paid === 2 && n.given === 3 && n.received === 1 && n.balance === 2, JSON.stringify(n));
  check('el balance del grupo siempre suma cero', bal.reduce((a, b) => a + b.balance, 0) === 0, JSON.stringify(bal.map(b => b.balance)));
  check('el balance en euros también suma cero', bal.reduce((a, b) => a + b.balanceCents, 0) === 0);
  check('lo invitado por unos es lo recibido por otros', bal.reduce((a, b) => a + b.given, 0) === bal.reduce((a, b) => a + b.received, 0));

  group('Lógica: bares y precios');
  const hm = L.heatmap([
    { lat: 40.4168, lon: -3.7038, qty: 2, priceCents: 250, place: 'Manolo', userId: 'u1' },
    { lat: 40.41681, lon: -3.70381, qty: 3, priceCents: 250, place: 'Manolo', userId: 'u2' },
    { lat: 40.5, lon: -3.6, qty: 1, priceCents: 500, place: 'Lejos', userId: 'u1' }
  ]);
  check('junta puntos cercanos en la misma celda', hm.length === 2, `(${hm.length})`);
  check('suma pesos', hm[0].weight === 5);
  check('suma euros por celda', hm[0].cents === 1250);
  check('nombra la celda con el bar más repetido', hm[0].place === 'Manolo');

  const precios = [
    { place: 'Bar Manolo', drink: 'cana', priceCents: 200, qty: 1, userId: 'u1' },
    { place: 'Bar Manolo', drink: 'cana', priceCents: 250, qty: 1, userId: 'u2' },
    { place: 'bar manolo', drink: 'cana', priceCents: 300, qty: 1, userId: 'u3' },
    { place: 'Otro Bar', drink: 'cana', priceCents: 900, qty: 1, userId: 'u1' }
  ];
  check('sugiere la mediana del bar (2,50 €)', L.suggestPrice(precios, 'Bar Manolo') === 250, `(${L.suggestPrice(precios, 'Bar Manolo')})`);
  check('el nombre del bar no distingue mayúsculas', L.suggestPrice(precios, 'BAR MANOLO') === 250);
  check('bar desconocido → 0 (usarás tu precio)', L.suggestPrice(precios, 'Bar Nuevo') === 0);
  check('sin bar → 0', L.suggestPrice(precios, '') === 0);
  check('filtra por bebida si hay datos', L.suggestPrice(precios, 'Bar Manolo', 'cana') === 250);
  check('si no hay de esa bebida, usa las del bar', L.suggestPrice(precios, 'Otro Bar', 'gintonic') === 900);

  const tp = L.topPlaces(precios);
  /* 3 copas en el mismo bar: 2,00 + 2,50 + 3,00 = 7,50 -> media 2,50 */
  check('top de bares calcula precio medio real', tp.find(t => t.place === 'Bar Manolo').avgPriceCents === 250, JSON.stringify(tp[0]));
  check('agrupa el bar aunque se escriba con otras mayúsculas', tp.filter(t => t.place.toLowerCase() === 'bar manolo').length === 1);
  check('cuenta personas distintas por bar', tp.find(t => t.place === 'Bar Manolo').people === 3);

  group('Lógica: resumen de gasto');
  const noche = [
    { userId: 'u1', qty: 2, priceCents: 250, viaRound: false, payerId: 'u1' },
    { userId: 'u2', qty: 1, priceCents: 250, viaRound: true, payerId: 'u1' },
    { userId: 'u1', qty: 1, priceCents: 250, viaRound: true, payerId: 'u1' },
    { userId: 'u1', qty: 1, priceCents: 400, viaRound: true, payerId: 'u2' }
  ];
  const s1 = L.spendSummary(noche, 'u1');
  check('mis copas incluyen las que me invitan', s1.drinks === 4, `(${s1.drinks})`);
  check('lo que pago = lo mío + lo que invito', s1.spentCents === 500 + 250 + 250, `(${s1.spentCents})`);
  check('separa lo gastado en invitar', s1.treatedCents === 250);
  check('calcula lo que me han ahorrado', s1.savedCents === 400);

  group('Lógica: periodos y eventos');
  const t = new Date('2026-07-30T21:00:00Z').getTime();
  check('inicio de mes correcto', new Date(L.startOfMonth(t)).getDate() === 1);
  check('inicio de semana es lunes', new Date(L.startOfWeek(t)).getDay() === 1);
  check('inicio de año es enero', new Date(L.startOfYear(t)).getMonth() === 0);
  check('evento activo dentro de ventana', L.eventActive({ startsMs: t - 1000, endsMs: t + 1000 }, t));
  check('evento no activo fuera', !L.eventActive({ startsMs: t + 1000, endsMs: t + 2000 }, t));

  const near = L.nearbyPeople(act, 40.41, -3.70, 300, 4 * 3600000, now);
  check('nearby filtra por radio de 300 m', near.length === 1 && near[0].userId === 'u1');
  check('con 2 km entran los dos', L.nearbyPeople(act, 40.41, -3.70, 2000, 4 * 3600000, now).length === 2);
  check('nearby ignora fichajes viejos', L.nearbyPeople(act, 40.41, -3.70, 5000, 30000, now).length === 0);
}

/* ============================================================
   2. API DE PUNTA A PUNTA
   ============================================================ */
async function testApi() {
  group('API: cuentas y grupos');
  __resetMemory();

  check('sin login la API responde 401', (await call('me')).status === 401);
  check('usuario nuevo entra sin grupo', (await call('me', { user: 'u1' })).body.groupId === null);
  check('rechaza códigos de grupo inválidos', (await call('me', { user: 'u1', method: 'POST', body: { nick: 'Nacho', groupId: 'AB' } })).status === 400);

  const r1 = await join('u1', 'Nacho', 'LosPavos2026', '2,50');
  check('se une al grupo y lo normaliza a minúsculas', r1.body.groupId === 'lospavos2026');
  check('guarda el precio por defecto que puso el usuario', r1.body.defaultPriceCents === 250, `(${r1.body.defaultPriceCents})`);
  await join('u2', 'Juan', 'lospavos2026', '2,50');
  await join('u3', 'Ana', 'lospavos2026');
  await join('x1', 'Intruso', 'otrogrupo', '5');
  check('endpoint protegido sin grupo devuelve 409', (await call('checkins', { user: 'zz' })).status === 409);

  const upd = await call('me', { user: 'u3', method: 'POST', body: { defaultPrice: '3,20' } });
  check('se puede cambiar solo el precio sin tocar el grupo', upd.body.defaultPriceCents === 320 && upd.body.groupId === 'lospavos2026');

  group('API: fichar con precio propio');
  const ci = await call('checkin', { user: 'u1', method: 'POST', body: { drink: 'ipa', qty: 2, price: '3,50', lat: 40.4168, lon: -3.7038, place: 'Bar Manolo', note: 'vente' } });
  check('fichaje creado (201)', ci.status === 201, JSON.stringify(ci.body));
  check('devuelve el coste total (2 × 3,50 = 7,00)', ci.body.costCents === 700, JSON.stringify(ci.body));

  check('anti-spam: segundo fichaje seguido da 429',
    (await call('checkin', { user: 'u1', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7038 } })).status === 429);
  process.env.CHECKIN_COOLDOWN_MS = '0';
  process.env.ROUND_COOLDOWN_MS = '0';

  check('coordenadas imposibles → 400', (await call('checkin', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 999, lon: 0 } })).status === 400);

  const sinPrecio = await call('checkin', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 40.4168, lon: -3.7039, place: 'Bar Manolo' } });
  check('sin precio usa el que tienes por defecto (2,50)', sinPrecio.body.priceCents === 250, JSON.stringify(sinPrecio.body));

  const caro = await call('checkin', { user: 'u3', method: 'POST', body: { drink: 'gintonic', qty: 1, price: '9', lat: 40.4168, lon: -3.7040, place: 'Garito Caro' } });
  check('puedes poner un precio distinto en otro sitio', caro.body.priceCents === 900);

  const rec = await call('checkin', { user: 'u3', method: 'POST', body: { drink: 'cana', price: '1,80', remember: true, lat: 40.4168, lon: -3.7041, place: 'Bar Barato' } });
  check('"recordar precio" lo guarda como tu nuevo defecto', rec.body.priceCents === 180 && (await call('me', { user: 'u3' })).body.defaultPriceCents === 180);

  const gratis = await call('checkin', { user: 'u2', method: 'POST', body: { drink: 'cana', price: '0', lat: 40.4168, lon: -3.7042, place: 'Boda' } });
  check('precio 0 (barra libre) se acepta', gratis.status === 201 && gratis.body.costCents === 0);

  const list = await call('checkins', { user: 'u1', query: { hours: '12' } });
  check('el grupo ve a los 3', list.body.active.length === 3, `(${list.body.active.length})`);
  check('cada uno con su gasto', list.body.active.find(a => a.userId === 'u1').spentCents === 700);
  check('resumen de la noche para mí', list.body.tonight.spentCents === 700 && list.body.tonight.drinks === 2, JSON.stringify(list.body.tonight));
  check('mis estadísticas con dinero', list.body.me.spentToday === 700, `(${list.body.me.spentToday})`);
  check('otro grupo no ve nada', (await call('checkins', { user: 'x1' })).body.active.length === 0);

  group('API: precios sugeridos');
  const sug = await call('prices', { user: 'u2', query: { place: 'Bar Manolo', drink: 'cana' } });
  check('sugiere el precio a partir del historial del bar', sug.body.suggestedCents === 250, JSON.stringify(sug.body));
  const sugNueva = await call('prices', { user: 'u1', query: { place: 'Bar Que No Existe' } });
  check('bar sin historial → sin sugerencia, te dice tu defecto', sugNueva.body.suggestedCents === 0 && sugNueva.body.myDefaultCents === 250);
  const lista = await call('prices', { user: 'u1' });
  check('lista de precios por bar ordenada de barato a caro', lista.body.places.length >= 2 && lista.body.places[0].avgPriceCents <= lista.body.places[1].avgPriceCents, JSON.stringify(lista.body.places));

  group('API: rondas con precio');
  const ronda = await call('round', { user: 'u1', method: 'POST', body: { drink: 'cana', price: '2', lat: 40.4168, lon: -3.7038, place: 'Bar Manolo', participants: ['u2', 'u3'] } });
  check('ronda creada para 3', ronda.status === 201 && ronda.body.size === 3);
  check('calcula lo que te cuesta la ronda (3 × 2 = 6)', ronda.body.totalCents === 600, JSON.stringify(ronda.body));
  check('ronda de uno solo → 400', (await call('round', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 40.41, lon: -3.70, participants: [] } })).status === 400);
  check('no puedes meter a gente de otro grupo', (await call('round', { user: 'u2', method: 'POST', body: { drink: 'cana', lat: 40.41, lon: -3.70, participants: ['x1'] } })).status === 400);

  const tras = await call('checkins', { user: 'u1' });
  check('la ronda suma una copa a cada participante', tras.body.active.find(a => a.userId === 'u2').total === 3, `(${tras.body.active.find(a => a.userId === 'u2').total})`);
  check('el gasto de la ronda lo carga solo quien invita', tras.body.active.find(a => a.userId === 'u1').spentCents === 700 + 600, `(${tras.body.active.find(a => a.userId === 'u1').spentCents})`);
  check('al invitado le suben las copas pero no el gasto', tras.body.active.find(a => a.userId === 'u2').spentCents === 250 + 0);
  check('el invitado ve lo que le han ahorrado', (await call('checkins', { user: 'u2' })).body.tonight.savedCents === 200);

  group('API: concurrencia');
  await join('c1', 'Conc1', 'grupoconcurrencia', '2');
  await join('c2', 'Conc2', 'grupoconcurrencia', '2');
  await Promise.all([1, 2, 3, 4, 5].map(() =>
    call('checkin', { user: 'c1', method: 'POST', body: { drink: 'cana', qty: 1, price: '2', lat: 40.4168, lon: -3.7038, place: 'Bar Test' } })));
  const conc = (await call('checkins', { user: 'c1' })).body.active.find(a => a.userId === 'c1');
  check('5 fichajes simultáneos se guardan los 5', conc.total === 5, `(${conc.total})`);
  check('y el gasto acumulado es correcto', conc.spentCents === 1000, `(${conc.spentCents})`);
  const [ra, rb] = await Promise.all([
    call('round', { user: 'c1', method: 'POST', body: { drink: 'cana', price: '2', lat: 40.4168, lon: -3.7038, participants: ['c2'] } }),
    call('round', { user: 'c2', method: 'POST', body: { drink: 'cana', price: '2', lat: 40.4168, lon: -3.7038, participants: ['c1'] } })
  ]);
  check('dos rondas en el mismo milisegundo no chocan', ra.status === 201 && rb.status === 201, `${ra.status}/${rb.status}`);
  check('rondas cruzadas se compensan solas', (await call('debts', { user: 'c1' })).body.debts.length === 0);

  group('API: deudas');
  await call('round', { user: 'u2', method: 'POST', body: { drink: 'cana', price: '2', lat: 40.4168, lon: -3.7038, participants: ['u1'] } });
  const deu = await call('debts', { user: 'u1' });
  const anaDebe = deu.body.debts.find(d => d.fromId === 'u3' && d.toId === 'u1');
  check('Ana debe 1 ronda a Nacho', anaDebe && anaDebe.rounds === 1, JSON.stringify(deu.body.debts));
  check('la deuda viene con su importe', anaDebe && anaDebe.cents === 200, JSON.stringify(anaDebe));
  check('Nacho y Juan quedan en paz', !deu.body.debts.some(d => (d.fromId === 'u1' && d.toId === 'u2') || (d.fromId === 'u2' && d.toId === 'u1')));
  check('me dice a quién le debo', Array.isArray(deu.body.mine.owed));
  check('balance del grupo suma cero', deu.body.balance.reduce((a, b) => a + b.balance, 0) === 0);

  group('API: gasto');
  const sp = await call('spend', { user: 'u1', query: { period: 'day' } });
  check('devuelve el total del grupo', sp.body.totalCents > 0);
  check('desglose por persona ordenado de mayor a menor', sp.body.byPerson.length >= 3 && sp.body.byPerson[0].spentCents >= sp.body.byPerson[1].spentCents);
  check('desglose por bar', sp.body.byPlace.some(p => p.place === 'Bar Manolo'));
  check('mi resumen personal', sp.body.mine.spentCents === 1300, `(${sp.body.mine.spentCents})`);
  check('avisa de las copas sin precio', typeof sp.body.drinksWithoutPrice === 'number');
  const spTotal = sp.body.byPerson.reduce((a, p) => a + p.spentCents, 0);
  check('la suma por persona cuadra con el total', spTotal === sp.body.totalCents, `${spTotal} vs ${sp.body.totalCents}`);

  group('API: proximidad');
  const near = await call('nearby', { user: 'u1', query: { lat: '40.4168', lon: '-3.7038', radius: '300', place: 'Bar Manolo' } });
  check('encuentra a los que están al lado', near.body.people.length >= 2);
  check('devuelve la distancia en metros', typeof near.body.people[0].distance === 'number');
  check('sugiere precio del bar para la ronda', near.body.suggestedPriceCents > 0, `(${near.body.suggestedPriceCents})`);
  check('desde Barcelona no ve a nadie', (await call('nearby', { user: 'u1', query: { lat: '41.3874', lon: '2.1686', radius: '300' } })).body.people.length === 0);
  check('sin coordenadas → 400', (await call('nearby', { user: 'u1', query: {} })).status === 400);

  group('API: ranking');
  const rk = await call('ranking', { user: 'u1', query: { period: 'day' } });
  check('ranking del día devuelve lista', rk.body.list.length === 3);
  check('ordenado de mayor a menor', rk.body.list[0].total >= rk.body.list[1].total);
  check('incluye rondas pagadas', rk.body.list.find(x => x.userId === 'u1').roundsPaid === 1);
  check('incluye gasto por persona', rk.body.list.every(x => typeof x.spentCents === 'number'));
  check('trae el total gastado del grupo', rk.body.totalCents > 0);

  group('API: eventos');
  const ahora = Date.now();
  const ev = await call('events', { user: 'u1', method: 'POST', body: { name: 'Oktoberfest 2026', startsAt: new Date(ahora - 3600000).toISOString(), endsAt: new Date(ahora + 86400000).toISOString() } });
  check('evento creado', ev.status === 201);
  check('fechas al revés → 400', (await call('events', { user: 'u1', method: 'POST', body: { name: 'Mal', startsAt: new Date(ahora).toISOString(), endsAt: new Date(ahora - 1000).toISOString() } })).status === 400);
  check('el grupo ve el evento activo', (await call('events', { user: 'u2' })).body[0].active === true);
  const rkEv = await call('ranking', { user: 'u1', query: { eventId: ev.body.id } });
  check('ranking filtrado por evento', rkEv.body.label === 'Oktoberfest 2026' && rkEv.body.list.length === 3);
  check('evento inexistente → 404', (await call('ranking', { user: 'u1', query: { eventId: 'nope' } })).status === 404);
  check('solo el creador puede borrarlo', (await call('events', { user: 'u2', method: 'DELETE', query: { id: ev.body.id } })).status === 403);

  group('API: heatmap');
  const hm = await call('heatmap', { user: 'u1', query: { days: '365' } });
  check('devuelve puntos', hm.body.points.length > 0);
  check('devuelve top de bares con precio medio', hm.body.top.some(t => t.avgPriceCents > 0));
  check('cuenta copas y euros', hm.body.totalDrinks > 0 && hm.body.totalCents > 0);
  check('heatmap personal filtra solo lo mío', (await call('heatmap', { user: 'u3', query: { scope: 'me' } })).body.scope === 'me');

  group('API: he llegado a casa');
  check('marca llegada', (await call('home', { user: 'u3', method: 'POST' })).body.homeAt > 0);
  const trasCasa = await call('checkins', { user: 'u1' });
  check('sale del mapa', !trasCasa.body.active.some(a => a.userId === 'u3'));
  check('el grupo ve que llegó bien', trasCasa.body.home.some(h => h.userId === 'u3'));
  await call('checkin', { user: 'u3', method: 'POST', body: { drink: 'cana', price: '2', lat: 40.4168, lon: -3.7038 } });
  check('si vuelve a fichar, reaparece', (await call('checkins', { user: 'u1' })).body.active.some(a => a.userId === 'u3'));

  group('API: cerrar la noche');
  await call('checkin', { user: 'u2', method: 'DELETE' });
  check('cerrar la noche te quita del mapa', !(await call('checkins', { user: 'u1' })).body.active.some(a => a.userId === 'u2'));
  check('pero conserva estadísticas', (await call('ranking', { user: 'u1', query: { period: 'day' } })).body.list.some(x => x.userId === 'u2'));

  group('API: purga');
  check('sin clave → 403', (await call('purge', { method: 'POST' })).status === 403);
  const pg = await call('purge', { method: 'POST', headers: { 'x-purge-key': 'test-key' } });
  check('con clave funciona', pg.status === 200);
  check('no borra lo reciente', pg.body.deleted.checkins === 0);
}

/* ============================================================
   3. ESTRUCTURA DEL REPO (lo que rompió los dos deploys)
   ============================================================ */
function testRepo() {
  group('Estructura del repo (causa de los fallos de deploy)');
  const root = path.join(__dirname, '..');
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const exists = p => fs.existsSync(path.join(root, p));

  check('public/index.html está en la RAÍZ del repo, sin carpeta contenedora', exists('public/index.html'));
  check('api/host.json está en la RAÍZ del repo', exists('api/host.json'));
  check('staticwebapp.config.json está en la RAÍZ', exists('staticwebapp.config.json'));
  check('NO hay una carpeta contenedora tipo birra-map/', !exists('birra-map') && !exists('birramap'));

  /* ---- lo que rompió el despliegue: el index.html DEBE estar en app_location ---- */
  const wfRaw = read('.github/workflows/azure-static-web-apps.yml');
  const appLoc = (wfRaw.match(/app_location:\s*"([^"]+)"/) || [])[1];
  check('el workflow declara app_location', !!appLoc, String(appLoc));
  const appDir = path.join(root, appLoc.replace(/^\//, ''));
  check(`existe ${appLoc} y contiene index.html (error "Failed to find a default file")`,
    fs.existsSync(path.join(appDir, 'index.html')), appDir);
  const apiLoc = (wfRaw.match(/api_location:\s*"([^"]+)"/) || [])[1];
  check(`existe ${apiLoc} con host.json`, fs.existsSync(path.join(root, apiLoc.replace(/^\//, ''), 'host.json')));
  check('la raíz del repo NO tiene una carpeta que envuelva el proyecto (tu caso: birramap/birra-map/…)',
    fs.existsSync(path.join(root, 'public')) && fs.existsSync(path.join(root, 'api')) &&
    fs.existsSync(path.join(root, 'staticwebapp.config.json')));
  check('staticwebapp.config.json está en la raíz, no dentro de /public',
    fs.existsSync(path.join(root, 'staticwebapp.config.json')));
  check('solo hay UN workflow de Static Web Apps',
    fs.readdirSync(path.join(root, '.github/workflows')).filter(f => /static-web-apps/i.test(f)).length === 1,
    fs.readdirSync(path.join(root, '.github/workflows')).join(', '));

  const pkg = JSON.parse(read('package.json'));
  check('package.json en la raíz con script build (evita el error de Oryx)', !!(pkg.scripts && pkg.scripts.build));

  const wfDir = path.join(root, '.github/workflows');
  const wfs = fs.readdirSync(wfDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  check('hay exactamente UN workflow (dos se pisan entre sí)', wfs.length === 1, wfs.join(', '));

  const wf = read('.github/workflows/' + wfs[0]);
  check('el workflow apunta a /public', wf.includes('app_location: "/public"'));
  check('el workflow apunta a /api', wf.includes('api_location: "/api"'));
  check('el workflow salta el build del front', wf.includes('skip_app_build: true'));
  check('el workflow valida la estructura antes de desplegar', wf.includes('public/index.html'));

  const cfg = JSON.parse(read('staticwebapp.config.json'));
  check('la API exige estar autenticado', cfg.routes.some(r => r.route === '/api/*' && r.allowedRoles.includes('authenticated')));

  const mani = JSON.parse(read('public/manifest.webmanifest'));
  check('el manifest tiene los dos iconos', mani.icons.length === 2);
  check('los iconos existen', exists('public/icons/icon-192.png') && exists('public/icons/icon-512.png'));

  const tablesSrc = read('api/shared/tables.js');
  check('acepta STORAGE_CONNECTION_STRING y STORE_CONNECTION_STRING', tablesSrc.includes('STORAGE_CONNECTION_STRING') && tablesSrc.includes('STORE_CONNECTION_STRING'));

  const sw = read('public/sw.js');
  check('el service worker nunca cachea /api ni /.auth', sw.includes("startsWith('/api')") && sw.includes('/.auth'));

  for (const f of ['me', 'checkin', 'checkins', 'ranking', 'round', 'debts', 'events', 'heatmap', 'home', 'nearby', 'prices', 'spend', 'purge'])
    check(`endpoint /api/${f} declarado`, exists(`api/${f}/function.json`) && JSON.parse(read(`api/${f}/function.json`)).bindings[0].route === f);
}

/* ============================================================
   4. FRONTEND
   ============================================================ */
function testFrontend() {
  group('Frontend');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

  let syntaxOk = true, syntaxErr = '';
  try { new (require('vm').Script)(js); } catch (e) { syntaxOk = false; syntaxErr = e.message; }
  check('app.js no tiene errores de sintaxis', syntaxOk, syntaxErr);

  for (const p of ['mapa', 'ranking', 'gasto', 'deudas', 'heat', 'perfil'])
    check(`la pestaña "${p}" tiene su página`, html.includes(`id="pg-${p}"`) && html.includes(`href="#/${p}"`));
  check('la página de eventos existe', html.includes('id="pg-eventos"'));
  check('hay router por hash', js.includes("addEventListener('hashchange'"));

  const llamadas = [...new Set([...js.matchAll(/api\([`'"]\/([a-z]+)/g)].map(m => m[1]))];
  check('el front llama a endpoints reales', llamadas.every(u => fs.existsSync(path.join(root, 'api', u))), llamadas.join(','));
  check('usa los endpoints de precio y gasto', llamadas.includes('prices') && llamadas.includes('spend'));

  const ids = [...new Set([...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]))];
  const faltan = ids.filter(id => !html.includes(`id="${id}"`));
  check('todos los ids que usa el JS existen en el HTML', faltan.length === 0, faltan.join(', '));

  for (const c of ['.pin', '.sheet', '.fab', '.nav', '.modal', '.row', '.hero', '.total', '.tonight'])
    check(`el CSS define ${c}`, css.includes(c));

  check('escapa el HTML de motes y mensajes', js.includes('const esc =') && js.includes('esc(c.nick)'));
  check('formatea euros en el front', js.includes('const eur =') && js.includes("',')"));
  check('hay campo de precio al fichar', html.includes('id="priceInput"'));
  check('hay campo de precio en la ronda', html.includes('id="roundPrice"'));
  check('muestra el total antes de confirmar', html.includes('id="checkinTotal"') && html.includes('id="roundTotal"'));
  check('permite recordar el precio', html.includes('id="rememberPrice"'));
  check('el radio de aviso es 500 m', js.includes('NOTIF_RADIUS = 500'));
  check('carga la librería de heatmap', html.includes('leaflet-heat'));
}

/* ============================================================ */
(async () => {
  console.log('🍺 BirraMap — batería de tests\n' + '='.repeat(54));
  try {
    testLogic();
    await testApi();
    testRepo();
    testFrontend();
  } catch (e) { failed++; results.push(`\n  💥 EXCEPCIÓN: ${e.stack}`); }
  console.log(results.join('\n'));
  console.log('\n' + '='.repeat(54));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
