/* Mide el antes y el después en Bares y Deudas.
   Ejecutar: node tests/benchmark.js */
process.env.BIRRAMAP_FAKE_STORE = '1';
process.env.CHECKIN_COOLDOWN_MS = '0';
process.env.ROUND_COOLDOWN_MS = '0';
/* 25 ms por consulta: lo que tarda de verdad Table Storage desde una Function */
process.env.BIRRAMAP_FAKE_LATENCY_MS = process.env.BIRRAMAP_FAKE_LATENCY_MS || '25';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'api/shared/store.js'));
const R = require(path.join(ROOT, 'api/shared/ratings.js'));
const L = require(path.join(ROOT, 'api/shared/logic.js'));
const C = require(path.join(ROOT, 'api/shared/cache.js'));
const fn = n => require(path.join(ROOT, 'api', n, 'index.js'));
const hdr = u => Buffer.from(JSON.stringify({ userId: u, userDetails: u, identityProvider: 'github' })).toString('base64');

async function call(name, { user, method = 'GET', body = null, query = {} } = {}) {
  const ctx = {};
  await fn(name)(ctx, { method, body, query, headers: { 'x-ms-client-principal': hdr(user) } });
  return ctx.res;
}
const ms = t => `${(Date.now() - t).toString().padStart(5)} ms`;
const media = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);

(async () => {
  console.log('⏱  BirraMap · rendimiento de Bares y Deudas');
  console.log('='.repeat(60));
  console.log(`Simulando ${process.env.BIRRAMAP_FAKE_LATENCY_MS} ms por consulta a Table Storage`);
  console.log('(es lo que tarda de verdad desde una Azure Function)');

  /* ---- un grupo con un año de uso real ---- */
  const G = 'grupogrande';
  const PEÑA = ['u1','u2','u3','u4','u5','u6','u7','u8'];
  const BARES = ['Bar Manolo','La Tasca','El Tercio','Casa Paco','El Rincón','La Bodega',
                 'Cervecería Central','El Txoko','La Taberna','Bar Pepe','El Sótano','La Esquina'];

  for (const u of PEÑA) await S.saveMember(u, { nick: 'Nick' + u, groupId: G });

  const ahora = Date.now();
  console.log('\nGenerando un año de datos…');

  /* 1200 check-ins */
  for (let i = 0; i < 1200; i++) {
    const u = PEÑA[i % PEÑA.length];
    await S.addCheckin(G, {
      userId: u, nick: 'Nick' + u, drink: L.DRINKS[i % L.DRINKS.length],
      qty: 1 + (i % 3), priceCents: 200 + (i % 8) * 50,
      lat: 40.41 + (i % 20) / 1000, lon: -3.70 - (i % 20) / 1000,
      place: BARES[i % BARES.length],
      ts: new Date(ahora - i * 6 * 3600000).toISOString(),
      tsMs: ahora - i * 6 * 3600000,
      day: new Date(ahora - i * 6 * 3600000).toISOString().slice(0, 10),
      viaRound: false
    });
  }
  /* 300 rondas */
  for (let i = 0; i < 300; i++) {
    const pagador = PEÑA[i % PEÑA.length];
    const invitados = PEÑA.filter((_, n) => n !== (i % PEÑA.length)).slice(0, 3);
    await S.addRound(G, {
      payerId: pagador, payerNick: 'Nick' + pagador, drink: 'cana',
      place: BARES[i % BARES.length], priceCents: 250,
      ts: new Date(ahora - i * 12 * 3600000).toISOString(),
      tsMs: ahora - i * 12 * 3600000,
      day: new Date(ahora - i * 12 * 3600000).toISOString().slice(0, 10),
      participants: JSON.stringify([{ userId: pagador, nick: 'Nick' + pagador },
        ...invitados.map(u => ({ userId: u, nick: 'Nick' + u }))]),
      size: 4
    });
  }
  /* 400 puntuaciones */
  for (let i = 0; i < 400; i++) {
    const u = PEÑA[i % PEÑA.length];
    await S.addRating(G, {
      userId: u, nick: 'Nick' + u, place: BARES[i % BARES.length],
      placeKey: R.clavePlace(BARES[i % BARES.length]),
      stars: 1 + (i % 5), note: '',
      ts: new Date(ahora - i * 18 * 3600000).toISOString(),
      tsMs: ahora - i * 18 * 3600000,
      day: '2026-07-30'
    });
  }
  console.log('  1200 consumiciones · 300 rondas · 400 puntuaciones · 8 personas · 12 bares\n');

  /* ============ SIN CACHÉ (lo de antes) ============ */
  console.log('SIN CACHÉ (como estaba)');
  console.log('-'.repeat(60));
  const sinCache = { bares: [], deudas: [], calor: [] };
  for (let i = 0; i < 5; i++) {
    C.reset();
    let t = Date.now(); await call('ratings', { user: 'u1' }); sinCache.bares.push(Date.now() - t);
    C.reset();
    t = Date.now(); await call('debts', { user: 'u1' }); sinCache.deudas.push(Date.now() - t);
    C.reset();
    t = Date.now(); await call('heatmap', { user: 'u1' }); sinCache.calor.push(Date.now() - t);
  }
  console.log(`  Bares   ${String(media(sinCache.bares)).padStart(4)} ms`);
  console.log(`  Deudas  ${String(media(sinCache.deudas)).padStart(4)} ms`);
  console.log(`  Calor   ${String(media(sinCache.calor)).padStart(4)} ms`);

  /* ============ CON CACHÉ ============ */
  console.log('\nCON CACHÉ (como queda)');
  console.log('-'.repeat(60));
  C.reset();
  await call('ratings', { user: 'u1' });
  await call('debts', { user: 'u1' });
  await call('heatmap', { user: 'u1' });

  const conCache = { bares: [], deudas: [], calor: [] };
  for (let i = 0; i < 5; i++) {
    let t = Date.now(); await call('ratings', { user: 'u1' }); conCache.bares.push(Date.now() - t);
    t = Date.now(); await call('debts', { user: 'u1' }); conCache.deudas.push(Date.now() - t);
    t = Date.now(); await call('heatmap', { user: 'u1' }); conCache.calor.push(Date.now() - t);
  }
  console.log(`  Bares   ${String(media(conCache.bares)).padStart(4)} ms`);
  console.log(`  Deudas  ${String(media(conCache.deudas)).padStart(4)} ms`);
  console.log(`  Calor   ${String(media(conCache.calor)).padStart(4)} ms`);

  /* ============ resumen ============ */
  console.log('\n' + '='.repeat(60));
  const mejora = (a, b) => a === 0 ? '—' : `${Math.round(((a - b) / a) * 100)}% más rápido`;
  console.log(`  Bares   ${media(sinCache.bares)} ms → ${media(conCache.bares)} ms   ${mejora(media(sinCache.bares), media(conCache.bares))}`);
  console.log(`  Deudas  ${media(sinCache.deudas)} ms → ${media(conCache.deudas)} ms   ${mejora(media(sinCache.deudas), media(conCache.deudas))}`);
  console.log(`  Calor   ${media(sinCache.calor)} ms → ${media(conCache.calor)} ms   ${mejora(media(sinCache.calor), media(conCache.calor))}`);
  console.log(`\n  Aciertos de caché: ${C.estado().ratio}%`);

  /* ---- comprobación: el caché no puede mentir ---- */
  console.log('\nComprobando que los datos siguen siendo correctos…');
  const antes = (await call('ratings', { user: 'u1' })).body.total;
  await call('rating', { user: 'u2', method: 'POST', body: { place: 'Bar Estrenado Hoy', stars: 5 } });
  const despues = (await call('ratings', { user: 'u1' })).body.total;
  const okNuevo = despues === antes + 1;

  const dAntes = (await call('debts', { user: 'u1' })).body.totalRounds;
  await call('round', { user: 'u3', method: 'POST',
    body: { drink: 'cana', price: '3', lat: 40.41, lon: -3.70, place: 'Bar Manolo', participants: ['u4'] } });
  const dDespues = (await call('debts', { user: 'u1' })).body.totalRounds;
  const okRonda = dDespues === dAntes + 1;

  console.log(`  ${okNuevo ? '✅' : '❌'} al votar, el bar nuevo aparece al momento (${antes} → ${despues})`);
  console.log(`  ${okRonda ? '✅' : '❌'} al invitar, la ronda aparece al momento (${dAntes} → ${dDespues})`);

  const bien = okNuevo && okRonda;
  console.log('\n' + (bien
    ? '✅ Más rápido y sin datos rancios: al escribir se invalida el caché.'
    : '❌ El caché está sirviendo datos viejos.'));
  process.exit(bien ? 0 : 1);
})();
