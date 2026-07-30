const S = require('../shared/store');

/* GET /api/ranking?period=day|week|month */
module.exports = async function (context, req) {
  const p = S.principal(req);
  if (!p) return S.err(context, 401, 'No autenticado');
  const m = await S.getMember(p.userId);
  if (!m || !m.groupId) return S.err(context, 409, 'Sin grupo');

  const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
  const from = period === 'day' ? S.startOfDay() : period === 'week' ? S.startOfWeek() : S.startOfMonth();

  const rows = await S.listCheckins(m.groupId, from);
  const agg = new Map();
  for (const r of rows) {
    const a = agg.get(r.userId) || { userId: r.userId, nick: r.nick, total: 0, days: new Set(), drinks: {} };
    a.total += r.qty;
    a.days.add(r.day);
    a.drinks[r.drink] = (a.drinks[r.drink] || 0) + r.qty;
    a.nick = a.nick || r.nick;
    agg.set(r.userId, a);
  }

  const list = [...agg.values()].map(a => ({
    userId: a.userId,
    nick: a.nick,
    total: a.total,
    sessions: a.days.size,
    favorite: Object.entries(a.drinks).sort((x, y) => y[1] - x[1])[0][0]
  })).sort((a, b) => b.total - a.total);

  S.ok(context, list);
};
