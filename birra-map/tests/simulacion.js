/* Simulación de una noche entera: 5 colegas, rondas, gente que se va a casa.
   Sirve para ver que los números cuadran de punta a punta.
   Ejecutar: node tests/simulacion.js */
process.env.BIRRAMAP_FAKE_STORE = '1';
process.env.CHECKIN_COOLDOWN_MS = '0';
process.env.ROUND_COOLDOWN_MS = '0';

const path = require('path');
const fn = n => require(path.join(__dirname, '../api', n, 'index.js'));
const hdr = u => Buffer.from(JSON.stringify({ userId: u, userDetails: u, identityProvider: 'github' })).toString('base64');

async function call(name, { user, method = 'GET', body = null, query = {} } = {}) {
  const ctx = {};
  await fn(name)(ctx, { method, body, query, headers: user ? { 'x-ms-client-principal': hdr(user) } : {} });
  return ctx.res;
}

const BARES = [
  { n: 'Bar Manolo', lat: 40.41680, lon: -3.70380 },
  { n: 'La Tasca', lat: 40.41720, lon: -3.70290 },
  { n: 'Cervecería El Tercio', lat: 40.41610, lon: -3.70450 }
];
const PEÑA = [
  ['u1', 'Nacho'], ['u2', 'Juan'], ['u3', 'Ana'], ['u4', 'Marcel'], ['u5', 'Fabian']
];

(async () => {
  console.log('🍺 Simulación: viernes noche en Madrid\n' + '='.repeat(52));

  for (const [id, nick] of PEÑA) await call('me', { user: id, method: 'POST', body: { nick, groupId: 'lospavos2026' } });
  console.log(`👥 ${PEÑA.length} en el grupo "lospavos2026"\n`);

  const beber = async (u, drink, qty, bar, note = '') => {
    const b = BARES[bar];
    await call('checkin', { user: u, method: 'POST', body: { drink, qty, lat: b.lat, lon: b.lon, place: b.n, note } });
  };

  console.log('20:30 · empiezan en el Bar Manolo');
  await beber('u1', 'cana', 1, 0, 'vente que hay sitio');
  await beber('u2', 'cana', 1, 0);
  await beber('u3', 'vino', 1, 0);

  console.log('21:00 · Nacho invita a una ronda');
  const r1 = await call('round', { user: 'u1', method: 'POST', body: { drink: 'cana', lat: BARES[0].lat, lon: BARES[0].lon, place: BARES[0].n, participants: ['u2', 'u3'] } });
  console.log(`        ronda de ${r1.body.size} 🤝`);

  console.log('21:30 · llega Marcel y se apunta Fabian desde La Tasca');
  await beber('u4', 'tercio', 2, 0);
  await beber('u5', 'ipa', 1, 1);

  console.log('22:00 · Juan devuelve la ronda');
  const r2 = await call('round', { user: 'u2', method: 'POST', body: { drink: 'tercio', lat: BARES[0].lat, lon: BARES[0].lon, place: BARES[0].n, participants: ['u1', 'u3', 'u4'] } });
  console.log(`        ronda de ${r2.body.size} 🤝`);

  console.log('23:00 · cambio de bar, Ana invita en El Tercio');
  await beber('u1', 'copa', 1, 2);
  await call('round', { user: 'u3', method: 'POST', body: { drink: 'gintonic', lat: BARES[2].lat, lon: BARES[2].lon, place: BARES[2].n, participants: ['u1', 'u4'] } });

  console.log('00:30 · Ana se va a casa');
  await call('home', { user: 'u3', method: 'POST' });

  console.log('01:00 · Fabian cierra la noche\n');
  await call('checkin', { user: 'u5', method: 'DELETE' });

  /* ---------- resultados ---------- */
  const st = await call('checkins', { user: 'u1' });
  console.log('🗺️  EN EL MAPA AHORA');
  st.body.active.forEach(a => console.log(`   ${a.nick.padEnd(8)} ${String(a.total).padStart(2)} copas · ${a.place}`));
  console.log('🏠 EN CASA: ' + (st.body.home.map(h => h.nick).join(', ') || '—'));

  const rk = await call('ranking', { user: 'u1', query: { period: 'day' } });
  console.log('\n🏆 RANKING DE LA NOCHE');
  rk.body.list.forEach((x, i) => console.log(`   ${['🥇', '🥈', '🥉'][i] || ' ' + (i + 1)} ${x.nick.padEnd(8)} ${String(x.total).padStart(2)} copas · ${x.roundsPaid} rondas pagadas`));

  const de = await call('debts', { user: 'u1' });
  console.log('\n💸 DEUDAS (ya compensadas)');
  de.body.debts.length ? de.body.debts.forEach(d => console.log(`   ${d.from} debe ${d.rounds} a ${d.to}`)) : console.log('   nadie debe nada');
  console.log('\n🏅 BALANCE DE GENEROSIDAD');
  de.body.balance.forEach(b => console.log(`   ${b.nick.padEnd(8)} pagó ${b.paid} · recibió ${b.received} · balance ${b.balance > 0 ? '+' : ''}${b.balance}`));

  const nb = await call('nearby', { user: 'u1', query: { lat: String(BARES[0].lat), lon: String(BARES[0].lon), radius: '300' } });
  console.log('\n📡 A MENOS DE 300 m DEL BAR MANOLO');
  nb.body.people.forEach(p => console.log(`   ${p.nick.padEnd(8)} a ${p.distance} m (${p.place})`));

  const hm = await call('heatmap', { user: 'u1', query: { days: '365' } });
  console.log('\n🔥 BARES MÁS PISADOS');
  hm.body.top.forEach((t, i) => console.log(`   ${i + 1}. ${t.place.padEnd(22)} ${t.drinks} copas · ${t.people} personas`));

  /* ---------- comprobaciones de coherencia ---------- */
  console.log('\n' + '='.repeat(52));
  const total = rk.body.list.reduce((a, x) => a + x.total, 0);
  const suma = hm.body.totalDrinks;
  const errs = [];
  if (total !== suma) errs.push(`ranking (${total}) y heatmap (${suma}) no cuadran`);
  if (st.body.active.some(a => a.userId === 'u3')) errs.push('Ana sigue en el mapa tras irse a casa');
  if (st.body.active.some(a => a.userId === 'u5')) errs.push('Fabian sigue en el mapa tras cerrar la noche');
  if (!rk.body.list.some(x => x.userId === 'u3')) errs.push('Ana ha perdido sus estadísticas');
  const neto = de.body.balance.reduce((a, b) => a + b.balance, 0);
  if (neto !== 0) errs.push(`el balance global debería ser 0 y es ${neto}`);
  if (de.body.debts.some(d => d.rounds <= 0)) errs.push('hay deudas de 0 o negativas sin compensar');

  console.log(errs.length ? '❌ ' + errs.join('\n❌ ') : `✅ Todo coherente: ${total} copas repartidas, balance global 0, nadie fantasma en el mapa.`);
  process.exit(errs.length ? 1 : 0);
})();
