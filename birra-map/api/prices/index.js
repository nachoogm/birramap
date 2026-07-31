const S = require('../shared/store');
const L = require('../shared/logic');
module.exports = S.withMember(async (context, req, p, m) => {
  const rows = await S.listCheckins(m.groupId, Date.now() - 365*86400000);
  if (req.query.place) {
    return S.ok(context, { place:req.query.place,
      suggestedCents: L.suggestPrice(rows, req.query.place, req.query.drink || null) });
  }
  S.ok(context, { places: L.topPlaces(rows, 30).filter(t => t.avgPriceCents > 0)
    .map(t => ({ place:t.place, avgPriceCents:t.avgPriceCents, drinks:t.drinks }))
    .sort((a,b) => a.avgPriceCents - b.avgPriceCents) });
});
