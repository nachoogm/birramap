const S = require('../shared/store');
const L = require('../shared/logic');
module.exports = S.withMember(async (context, req, p, m) => {
  const now = Date.now();
  let from, until = null, label;
  if (req.query.eventId) {
    const ev = await S.getEvent(m.groupId, req.query.eventId);
    if (!ev) return S.err(context, 404, 'Evento no encontrado');
    from = ev.startsMs; until = Math.min(ev.endsMs, now); label = ev.name;
  } else {
    const per = ['day','week','month','year'].includes(req.query.period) ? req.query.period : 'day';
    from = L.periodStart(per, now); label = per;
  }
  let rows = await S.listCheckins(m.groupId, from);
  if (until) rows = rows.filter(r => r.tsMs <= until);
  const rounds = (await S.listRounds(m.groupId, from)).filter(r => !until || r.tsMs <= until);
  const paid = {};
  rounds.forEach(r => { paid[r.payerId] = (paid[r.payerId]||0)+1; });
  S.ok(context, { label, from, until,
    list: L.ranking(rows).map(x => ({ ...x, roundsPaid: paid[x.userId]||0 })) });
});
