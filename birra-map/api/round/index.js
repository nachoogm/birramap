const S = require('../shared/store');
const L = require('../shared/logic');

/* POST /api/round  → "invito yo"
   body: { drink, lat, lon, place, participants:[userId,...] }
   Crea un check-in por cada participante y registra la deuda.
   GET  /api/round?days=90 → histórico de rondas del grupo */
module.exports = S.withMember(async (context, req, p, m) => {
  if (req.method === 'GET') {
    const days = Math.min(Math.max(parseInt(req.query.days || '90', 10) || 90, 1), 365);
    const rounds = await S.listRounds(m.groupId, Date.now() - days * 86400000);
    return S.ok(context, rounds.map(r => ({
      id: r.rowKey, payerId: r.payerId, payerNick: r.payerNick, drink: r.drink,
      place: r.place, ts: r.ts, tsMs: r.tsMs,
      participants: typeof r.participants === 'string' ? JSON.parse(r.participants) : r.participants
    })));
  }

  const b = req.body || {};
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return S.err(context, 400, 'Coordenadas no válidas');

  const ids = [...new Set([p.userId, ...(Array.isArray(b.participants) ? b.participants : [])])];
  if (ids.length < 2) return S.err(context, 400, 'Una ronda de uno es un vicio, no una ronda 🍺');
  if (ids.length > 15) return S.err(context, 400, 'Máximo 15 personas por ronda');

  /* solo gente del mismo grupo */
  const members = await S.membersOf(ids);
  const valid = ids.filter(id => members[id] && members[id].groupId === m.groupId);
  if (valid.length < 2) return S.err(context, 400, 'Los participantes deben estar en tu grupo');

  const drink = L.DRINKS.includes(b.drink) ? b.drink : 'cana';
  const place = String(b.place || '').slice(0, 60);
  const tsMs = Date.now();
  const rlat = Math.round(lat * 1e5) / 1e5, rlon = Math.round(lon * 1e5) / 1e5;

  const cooldown = parseInt(process.env.ROUND_COOLDOWN_MS ?? '60000', 10);
  if (cooldown > 0) {
    const recent = await S.listRounds(m.groupId, tsMs - cooldown);
    if (recent.some(r => r.payerId === p.userId)) return S.err(context, 429, 'Acabas de invitar, espera un minuto');
  }

  const participants = valid.map(id => ({ userId: id, nick: members[id].nick }));

  /* un check-in por cabeza, marcado como parte de la ronda */
  let seq = 0;
  for (const id of valid) {
    await S.addCheckin(m.groupId, {
      userId: id, nick: members[id].nick, drink, qty: 1,
      lat: rlat, lon: rlon, place,
      note: id === p.userId ? 'invito yo 🤝' : `ronda de ${m.nick}`,
      ts: new Date(tsMs).toISOString(), tsMs, day: new Date(tsMs).toISOString().slice(0, 10),
      viaRound: true, seq: String(seq++)
    });
    if (members[id].hiddenUntil || members[id].homeAt) await S.saveMember(id, { hiddenUntil: 0, homeAt: 0 });
  }

  await S.addRound(m.groupId, {
    payerId: p.userId, payerNick: m.nick, drink, place,
    lat: rlat, lon: rlon, ts: new Date(tsMs).toISOString(), tsMs,
    day: new Date(tsMs).toISOString().slice(0, 10),
    participants: JSON.stringify(participants),
    size: participants.length
  });

  S.ok(context, { ok: true, participants, size: participants.length }, 201);
});
