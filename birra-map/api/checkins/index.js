const S = require('../shared/store');
const L = require('../shared/logic');

/* GET /api/checkins?hours=12
   Gente activa del grupo + mis estadísticas + quién ha llegado a casa */
module.exports = S.withMember(async (context, req, p, m) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours || '12', 10) || 12, 1), 24);
  const now = Date.now();

  const rows = await S.listCheckins(m.groupId, now - hours * 3600 * 1000);
  const members = await S.membersOf(rows.map(r => r.userId));
  const active = L.aggregateActive(rows, members, now);

  const rounds = await S.listRounds(m.groupId, now - hours * 3600 * 1000);

  const home = Object.values(members)
    .filter(x => x.homeAt && (now - x.homeAt) < 12 * 3600 * 1000)
    .map(x => ({ userId: x.rowKey, nick: x.nick, homeAt: x.homeAt }))
    .sort((a, b) => b.homeAt - a.homeAt);

  const mine = (await S.listCheckins(m.groupId, now - 30 * 86400000)).filter(r => r.userId === p.userId);

  S.ok(context, {
    now,
    active,
    home,
    rounds: rounds.slice(0, 20).map(r => ({
      id: r.rowKey, payerId: r.payerId, payerNick: r.payerNick, drink: r.drink,
      place: r.place, ts: r.ts, tsMs: r.tsMs,
      participants: typeof r.participants === 'string' ? JSON.parse(r.participants) : r.participants
    })),
    me: L.myStats(mine, now)
  });
});
