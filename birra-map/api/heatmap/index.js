const S = require('../shared/store');
const L = require('../shared/logic');

/* GET /api/heatmap?days=365&scope=group|me */
module.exports = S.withMember(async (context, req, p, m) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '365', 10) || 365, 1), 730);
  const mineOnly = req.query.scope === 'me';
  let rows = await S.listCheckins(m.groupId, Date.now() - days * 86400000);
  if (mineOnly) rows = rows.filter(r => r.userId === p.userId);
  S.ok(context, {
    days, scope: mineOnly ? 'me' : 'group',
    points: L.heatmap(rows),
    top: L.topPlaces(rows),
    totalDrinks: rows.reduce((a, r) => a + r.qty, 0),
    totalCents: rows.reduce((a, r) => a + L.rowCost(r), 0)
  });
});
