const S = require('../shared/store');
const L = require('../shared/logic');

/* GET /api/debts?days=90 → quién debe a quién (ya compensado) + balance por persona */
module.exports = S.withMember(async (context, req, p, m) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '90', 10) || 90, 1), 365);
  const rounds = await S.listRounds(m.groupId, Date.now() - days * 86400000);
  const debts = L.netDebts(rounds);
  S.ok(context, {
    days,
    totalRounds: rounds.length,
    debts,
    balance: L.roundStats(rounds),
    mine: {
      owes: debts.filter(d => d.fromId === p.userId),
      owed: debts.filter(d => d.toId === p.userId)
    }
  });
});
