const S = require('../shared/store');
const L = require('../shared/logic');
module.exports = S.withMember(async (context, req, p, m) => {
  const now = Date.now();
  const per = ['day','week','month','year'].includes(req.query.period) ? req.query.period : 'month';
  const rows = await S.listCheckins(m.groupId, L.periodStart(per, now));
  const gastos = L.spentByUser(rows);
  const members = await S.membersOf([...new Set([...rows.map(r=>r.userId), ...Object.keys(gastos)])]);
  const list = Object.entries(gastos).map(([userId, cents]) => {
    const mias = rows.filter(r => r.userId === userId);
    const copas = mias.reduce((a,r)=>a+r.qty,0);
    const res = L.spendSummary(rows, userId);
    return { userId, nick:(members[userId]&&members[userId].nick)||'¿?', spentCents:cents,
      drinks:copas, avgPriceCents: copas ? Math.round(cents/copas) : 0,
      myOwnCents:res.myOwnCents, treatedCents:res.treatedCents, savedCents:res.savedCents };
  }).sort((a,b) => b.spentCents - a.spentCents);
  const totalCents = Object.values(gastos).reduce((a,c)=>a+c,0);
  const conPrecio = rows.filter(r => r.priceCents > 0).reduce((a,r)=>a+r.qty,0);
  S.ok(context, { period:per, totalCents, list,
    totalDrinks: rows.reduce((a,r)=>a+r.qty,0),
    avgPriceCents: conPrecio ? Math.round(totalCents/conPrecio) : 0,
    byPlace: L.topPlaces(rows,20).map(t => ({ place:t.place, cents:t.cents, drinks:t.drinks, avgPriceCents:t.avgPriceCents })),
    mine: L.spendSummary(rows, p.userId) });
});
