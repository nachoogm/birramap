const S = require('../shared/store');
const L = require('../shared/logic');
const C = require('../shared/cache');

/* GET /api/debts?days=90 → deudas compensadas + balance
   El cálculo (que recorre todas las rondas) va en caché: era el
   otro punto lento junto con el ranking de bares. */
module.exports = S.withMember(async (context, req, p, m) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '90', 10) || 90, 1), 365);

  const base = await C.conCache(`${m.groupId}:agg:debts:${days}`, 60, async () => {
    const rounds = await S.listRounds(m.groupId, Date.now() - days * 86400000);
    return { totalRounds: rounds.length, debts: L.netDebts(rounds), balance: L.roundStats(rounds) };
  });

  S.ok(context, {
    days, totalRounds: base.totalRounds, debts: base.debts, balance: base.balance,
    mine: {
      owes: base.debts.filter(d => d.fromId === p.userId),
      owed: base.debts.filter(d => d.toId === p.userId)
    }
  });
});
