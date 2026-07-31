const S = require('../shared/store');
module.exports = S.withMember(async (context, req, p, m) => {
  const now = Date.now();
  if (req.method === 'POST') {
    const b = req.body || {};
    const name = String(b.name||'').trim().slice(0,40);
    const startsMs = Date.parse(b.startsAt), endsMs = Date.parse(b.endsAt);
    if (!name) return S.err(context, 400, 'Ponle nombre al evento');
    if (!isFinite(startsMs) || !isFinite(endsMs)) return S.err(context, 400, 'Fechas no válidas');
    if (endsMs <= startsMs) return S.err(context, 400, 'El final debe ser posterior al inicio');
    if (endsMs - startsMs > 31*86400000) return S.err(context, 400, 'Máximo 31 días por evento');
    const id = 'ev' + startsMs.toString(36) + Math.random().toString(36).slice(2,6);
    await S.addEvent(m.groupId, { id, name, startsMs, endsMs, createdBy:p.userId, createdByNick:m.nick,
      startsAt:new Date(startsMs).toISOString(), endsAt:new Date(endsMs).toISOString() });
    return S.ok(context, { ok:true, id, name, startsMs, endsMs }, 201);
  }
  if (req.method === 'DELETE') {
    const ev = await S.getEvent(m.groupId, req.query.id);
    if (!ev) return S.err(context, 404, 'Evento no encontrado');
    if (ev.createdBy !== p.userId) return S.err(context, 403, 'Solo lo borra quien lo creó');
    const t = await S.tbl(S.T.events);
    await t.deleteEntity(ev.partitionKey, ev.rowKey);
    return S.ok(context, { ok:true });
  }
  S.ok(context, (await S.listEvents(m.groupId)).map(e => ({ id:e.id, name:e.name,
    startsMs:e.startsMs, endsMs:e.endsMs, startsAt:e.startsAt, endsAt:e.endsAt,
    createdByNick:e.createdByNick, active: now>=e.startsMs && now<=e.endsMs, upcoming: now<e.startsMs })));
});
