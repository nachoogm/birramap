const S = require('../shared/store');
const L = require('../shared/logic');

/* GET /api/spend?period=day|week|month|year  → quién se ha gastado cuánto */
module.exports = S.withMember(async (context, req, p, m) => {
  const now = Date.now();
  const period = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const from = L.periodStart(period, now);

  const rows = await S.listCheckins(m.groupId, from);
  const gastos = L.spentByUser(rows);
  const members = await S.membersOf([...new Set([...rows.map(r => r.userId), ...Object.keys(gastos)])]);

  const porPersona = Object.entries(gastos).map(([userId, cents]) => {
    const mias = rows.filter(r => r.userId === userId);
    const copas = mias.reduce((a, r) => a + r.qty, 0);
    const resumen = L.spendSummary(rows, userId);
    return {
      userId,
      nick: (members[userId] && members[userId].nick) || '¿?',
      spentCents: cents,
      drinks: copas,
      avgPriceCents: copas ? Math.round(cents / copas) : 0,
      myOwnCents: resumen.myOwnCents,      // lo que te has bebido tú y has pagado tú
      treatedCents: resumen.treatedCents,  // lo que has invitado a otros
      savedCents: resumen.savedCents       // lo que te has ahorrado porque te invitaron
    };
  }).sort((a, b) => b.spentCents - a.spentCents);

  const totalCents = Object.values(gastos).reduce((a, c) => a + c, 0);
  const sinPrecio = rows.filter(r => !r.priceCents).reduce((a, r) => a + r.qty, 0);

  const totalCopas = rows.reduce((a, r) => a + r.qty, 0);
  const copasConPrecio = rows.filter(r => r.priceCents > 0).reduce((a, r) => a + r.qty, 0);

  S.ok(context, {
    period, from,
    totalCents,
    totalDrinks: totalCopas,
    avgPriceCents: copasConPrecio ? Math.round(totalCents / copasConPrecio) : 0,
    list: porPersona,
    drinksWithoutPrice: sinPrecio,
    byPerson: porPersona,
    byPlace: L.topPlaces(rows, 20).map(t => ({ place: t.place, cents: t.cents, drinks: t.drinks, avgPriceCents: t.avgPriceCents })),
    mine: L.spendSummary(rows, p.userId)
  });
});
