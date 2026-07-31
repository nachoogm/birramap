const S = require('../shared/store');
const L = require('../shared/logic');
const C = require('../shared/cache');

/* GET /api/heatmap?days=365&scope=group|me */
module.exports = S.withMember(async (context, req, p, m) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '365', 10) || 365, 1), 730);
  const soloMio = req.query.scope === 'me';
  const clave = `${m.groupId}:agg:heat:${days}:${soloMio ? p.userId : 'all'}`;

  const datos = await C.conCache(clave, 90, async () => {
    let rows = await S.listCheckins(m.groupId, Date.now() - days * 86400000, 90);
    if (soloMio) rows = rows.filter(r => r.userId === p.userId);
    return {
      points: L.heatmap(rows), top: L.topPlaces(rows),
      totalDrinks: rows.reduce((a, r) => a + r.qty, 0),
      totalCents: rows.reduce((a, r) => a + L.rowCost(r), 0)
    };
  });

  S.ok(context, { days, scope: soloMio ? 'me' : 'group', ...datos });
});
