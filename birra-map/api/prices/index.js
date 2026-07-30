const S = require('../shared/store');
const L = require('../shared/logic');

/* GET /api/prices?place=Bar%20Manolo&drink=cana
   Sugiere precio a partir de lo que el grupo ha pagado ahí antes.
   Sin parámetros devuelve el listado de precios por bar. */
module.exports = S.withMember(async (context, req, p, m) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '180', 10) || 180, 1), 365);
  const rows = await S.listCheckins(m.groupId, Date.now() - days * 86400000);

  if (req.query.place) {
    const suggested = L.suggestPrice(rows, req.query.place, req.query.drink || null);
    return S.ok(context, {
      place: req.query.place,
      drink: req.query.drink || null,
      suggestedCents: suggested,
      myDefaultCents: m.defaultPriceCents || 0,
      source: suggested ? 'historial del grupo en ese bar' : 'sin datos, usa tu precio por defecto'
    });
  }

  const top = L.topPlaces(rows, 40).filter(t => t.avgPriceCents > 0);
  S.ok(context, {
    myDefaultCents: m.defaultPriceCents || 0,
    places: top.map(t => ({ place: t.place, avgPriceCents: t.avgPriceCents, drinks: t.drinks, visits: t.visits }))
      .sort((a, b) => a.avgPriceCents - b.avgPriceCents)
  });
});
