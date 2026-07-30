/* Simulación de una noche entera con precios reales.
   Ejecutar: node tests/simulacion.js */
process.env.BIRRAMAP_FAKE_STORE = '1';
process.env.CHECKIN_COOLDOWN_MS = '0';
process.env.ROUND_COOLDOWN_MS = '0';

const path = require('path');
const L = require(path.join(__dirname, '../api/shared/logic.js'));
const fn = n => require(path.join(__dirname, '../api', n, 'index.js'));
const hdr = u => Buffer.from(JSON.stringify({ userId: u, userDetails: u, identityProvider: 'github' })).toString('base64');

async function call(name, { user, method = 'GET', body = null, query = {} } = {}) {
  const ctx = {};
  await fn(name)(ctx, { method, body, query, headers: user ? { 'x-ms-client-principal': hdr(user) } : {} });
  return ctx.res;
}
const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';

/* Cada bar tiene sus precios: eso es justo lo que queríamos poder meter a mano */
const BARES = {
  manolo: { n: 'Bar Manolo', lat: 40.41680, lon: -3.70380, cana: 2.00, tercio: 2.50, vino: 2.20, copa: 6.00 },
  tasca: { n: 'La Tasca', lat: 40.41720, lon: -3.70290, cana: 2.80, tercio: 3.20, ipa: 4.50, copa: 8.00 },
  tercio: { n: 'Cervecería El Tercio', lat: 40.41610, lon: -3.70450, cana: 3.50, ipa: 5.00, gintonic: 9.50, copa: 9.00 }
};
const PEÑA = [['u1', 'Nacho'], ['u2', 'Juan'], ['u3', 'Ana'], ['u4', 'Marcel'], ['u5', 'Fabian']];

(async () => {
  console.log('🍺 Simulación: viernes noche en Madrid, con precios reales');
  console.log('='.repeat(60));

  for (const [id, nick] of PEÑA) await call('me', { user: id, method: 'POST', body: { nick, groupId: 'lospavos2026' } });
  console.log(`👥 ${PEÑA.length} en el grupo\n`);

  const beber = async (u, drink, qty, bar, note = '') => {
    const b = BARES[bar];
    const r = await call('checkin', { user: u, method: 'POST', body: { drink, qty, price: b[drink], lat: b.lat, lon: b.lon, place: b.n, note } });
    if (r.status !== 201) console.log('   ⚠️', r.body.error);
  };
  const invitar = async (u, drink, bar, gente) => {
    const b = BARES[bar];
    const r = await call('round', { user: u, method: 'POST', body: { drink, price: b[drink], lat: b.lat, lon: b.lon, place: b.n, participants: gente } });
    if (r.status === 201) console.log(`        ronda de ${r.body.size} en ${b.n} → le cuesta ${eur(r.body.totalCents)}`);
    else console.log('   ⚠️', r.body.error);
  };

  console.log('20:30 · arrancan en el Bar Manolo (caña a 2,00 €)');
  await beber('u1', 'cana', 1, 'manolo', 'vente que hay sitio');
  await beber('u2', 'cana', 1, 'manolo');
  await beber('u3', 'vino', 1, 'manolo');

  console.log('21:00 · Nacho invita');
  await invitar('u1', 'cana', 'manolo', ['u2', 'u3']);

  console.log('21:30 · llega Marcel; Fabian anda por La Tasca (más cara)');
  await beber('u4', 'tercio', 2, 'manolo');
  await beber('u5', 'ipa', 1, 'tasca');

  console.log('22:00 · Juan devuelve la ronda');
  await invitar('u2', 'tercio', 'manolo', ['u1', 'u3', 'u4']);

  console.log('23:00 · se mudan a El Tercio (gin-tonic a 9,50 €, ojo)');
  await beber('u1', 'copa', 1, 'tercio');
  await invitar('u3', 'gintonic', 'tercio', ['u1', 'u4']);

  console.log('00:30 · Ana se va a casa');
  await call('home', { user: 'u3', method: 'POST' });
  console.log('01:00 · Fabian cierra la noche\n');
  await call('checkin', { user: 'u5', method: 'DELETE' });

  /* ---------- resultados ---------- */
  const st = await call('checkins', { user: 'u1' });
  console.log('🗺️  EN EL MAPA AHORA');
  st.body.active.forEach(a => console.log(`   ${a.nick.padEnd(8)} ${String(a.total).padStart(2)} copas · lleva gastado ${eur(a.spentCents).padStart(8)} · ${a.place}`));
  console.log('🏠 EN CASA: ' + (st.body.home.map(h => h.nick).join(', ') || '—'));

  const sp = await call('spend', { user: 'u1', query: { period: 'day' } });
  console.log('\n💶 GASTO DE LA NOCHE');
  sp.body.list.forEach(x => console.log(`   ${x.nick.padEnd(8)} pagó ${eur(x.spentCents).padStart(8)} · bebió ${x.drinks} · le invitaron ${eur(x.savedCents)}`));
  console.log(`   ${'TOTAL'.padEnd(8)}      ${eur(sp.body.totalCents)} entre todos · media por copa ${eur(sp.body.avgPriceCents)}`);

  const de = await call('debts', { user: 'u1' });
  console.log('\n💸 DEUDAS (compensadas, en rondas y en dinero)');
  de.body.debts.length
    ? de.body.debts.forEach(d => console.log(`   ${d.from} debe ${d.rounds} ronda(s) a ${d.to}  →  ${eur(d.cents)}`))
    : console.log('   nadie debe nada');

  console.log('\n🏅 BALANCE');
  de.body.balance.forEach(b => console.log(`   ${b.nick.padEnd(8)} invitó a ${b.given} (${eur(b.givenCents)}) · le invitaron ${b.received} (${eur(b.receivedCents)}) · saldo ${b.balance > 0 ? '+' : ''}${b.balance}`));

  const pr = await call('prices', { user: 'u1' });
  console.log('\n🏷️  PRECIOS APRENDIDOS POR BAR (mediana de lo que habéis pagado)');
  pr.body.places.forEach(p => console.log(`   ${p.place.padEnd(24)} media ${eur(p.avgPriceCents)} · ${p.drinks} copas`));

  const sug = await call('prices', { user: 'u1', query: { place: 'bar manolo', drink: 'cana' } });
  console.log(`\n   → Al fichar en "bar manolo" una caña, te propondrá ${eur(sug.body.suggestedCents)} automáticamente`);

  const hm = await call('heatmap', { user: 'u1', query: { days: '365' } });
  console.log('\n🔥 BARES MÁS PISADOS');
  hm.body.top.forEach((t, i) => console.log(`   ${i + 1}. ${t.place.padEnd(24)} ${t.drinks} copas · ${eur(t.cents).padStart(8)} · media ${eur(t.avgPriceCents)}`));

  /* ---------- coherencia ---------- */
  console.log('\n' + '='.repeat(60));
  const errs = [];
  const totalGastado = sp.body.list.reduce((a, x) => a + x.spentCents, 0);
  if (totalGastado !== sp.body.totalCents) errs.push(`la suma por persona (${totalGastado}) no cuadra con el total (${sp.body.totalCents})`);
  const totalBarras = hm.body.top.reduce((a, t) => a + t.cents, 0);
  if (totalBarras !== sp.body.totalCents) errs.push(`lo cobrado en las barras (${totalBarras}) no cuadra con lo pagado (${sp.body.totalCents})`);
  const invitado = de.body.balance.reduce((a, b) => a + b.givenCents, 0);
  const recibido = de.body.balance.reduce((a, b) => a + b.receivedCents, 0);
  if (invitado !== recibido) errs.push(`lo invitado (${invitado}) no es igual a lo recibido (${recibido})`);
  if (de.body.balance.reduce((a, b) => a + b.balance, 0) !== 0) errs.push('el balance de rondas no suma cero');
  if (st.body.active.some(a => a.userId === 'u3')) errs.push('Ana sigue en el mapa tras irse a casa');
  if (st.body.active.some(a => a.userId === 'u5')) errs.push('Fabian sigue en el mapa tras cerrar la noche');
  if (!sp.body.list.some(x => x.userId === 'u3')) errs.push('Ana ha perdido sus estadísticas de gasto');
  if (sug.body.suggestedCents !== 200) errs.push(`el precio sugerido debería ser 2,00 € y es ${eur(sug.body.suggestedCents)}`);

  console.log(errs.length
    ? '❌ ' + errs.join('\n❌ ')
    : `✅ Todo cuadra: ${eur(sp.body.totalCents)} gastados, lo que pagan las personas = lo que cobran las barras, y el balance de rondas suma cero.`);
  process.exit(errs.length ? 1 : 0);
})();
