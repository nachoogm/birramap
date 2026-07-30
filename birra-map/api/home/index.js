const S = require('../shared/store');

/* POST /api/home → "he llegado a casa". Sale del mapa y el grupo se queda tranquilo.
   GET  /api/home → quién ha llegado ya en las últimas 12 h */
module.exports = S.withMember(async (context, req, p, m) => {
  const now = Date.now();
  if (req.method === 'POST') {
    await S.saveMember(p.userId, { homeAt: now, hiddenUntil: now });
    return S.ok(context, { ok: true, homeAt: now });
  }
  const rows = await S.listCheckins(m.groupId, now - 12 * 3600 * 1000);
  const members = await S.membersOf(rows.map(r => r.userId));
  S.ok(context, Object.values(members)
    .filter(x => x.homeAt && (now - x.homeAt) < 12 * 3600 * 1000)
    .map(x => ({ userId: x.rowKey, nick: x.nick, homeAt: x.homeAt }))
    .sort((a, b) => b.homeAt - a.homeAt));
});
