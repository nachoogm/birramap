const S = require('../shared/store');
const L = require('../shared/logic');
const C = require('../shared/cache');

/* GET /api/ranking?period=day|week|month|year  |  ?eventId=... */
module.exports = S.withMember(async (context, req, p, m) => {
  const now = Date.now();
  let from, until = null, label, clave;

  if (req.query.eventId) {
    const ev = await S.getEvent(m.groupId, req.query.eventId);
    if (!ev) return S.err(context, 404, 'Evento no encontrado');
    from = ev.startsMs; until = Math.min(ev.endsMs, now); label = ev.name;
    clave = `${m.groupId}:agg:rank:ev:${ev.id}`;
  } else {
    const per = ['day','week','month','year'].includes(req.query.period) ? req.query.period : 'day';
    from = L.periodStart(per, now); label = per;
    clave = `${m.groupId}:agg:rank:${per}`;
  }

  const lista = await C.conCache(clave, 30, async () => {
    let rows = await S.listCheckins(m.groupId, from, 30);
    if (until) rows = rows.filter(r => r.tsMs <= until);
    const rounds = (await S.listRounds(m.groupId, from)).filter(r => !until || r.tsMs <= until);
    const paid = {};
    rounds.forEach(r => { paid[r.payerId] = (paid[r.payerId] || 0) + 1; });
    return L.ranking(rows).map(x => ({ ...x, roundsPaid: paid[x.userId] || 0 }));
  });

  S.ok(context, { label, from, until, list: lista });
});
