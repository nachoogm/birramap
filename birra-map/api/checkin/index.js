const S = require('../shared/store');
const L = require('../shared/logic');

/* POST /api/checkin  → ficha (con el precio que TÚ pones, varía según el bar)
   DELETE /api/checkin → cierra la noche */
module.exports = S.withMember(async (context, req, p, m) => {
  if (req.method === 'DELETE') {
    await S.saveMember(p.userId, { hiddenUntil: Date.now() });
    return S.ok(context, { ok: true });
  }

  const b = req.body || {};
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return S.err(context, 400, 'Coordenadas no válidas');

  const drink = L.DRINKS.includes(b.drink) ? b.drink : 'cana';
  const qty = Math.min(Math.max(parseInt(b.qty || 1, 10) || 1, 1), 20);
  /* precio unitario: el que manda el usuario; si no manda nada, su precio por defecto */
  const priceCents = b.price !== undefined && b.price !== null && b.price !== ''
    ? L.toCents(b.price) : (m.defaultPriceCents || 0);
  const tsMs = Date.now();

  const cooldown = parseInt(process.env.CHECKIN_COOLDOWN_MS ?? '30000', 10);
  if (cooldown > 0) {
    const recent = await S.listCheckins(m.groupId, tsMs - cooldown);
    if (recent.some(r => r.userId === p.userId && !r.viaRound))
      return S.err(context, 429, `Tranquilo campeón, espera ${Math.round(cooldown / 1000)} segundos`);
  }

  await S.addCheckin(m.groupId, {
    userId: p.userId, nick: m.nick, drink, qty, priceCents,
    lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
    place: String(b.place || '').slice(0, 60), note: String(b.note || '').slice(0, 80),
    ts: new Date(tsMs).toISOString(), tsMs, day: new Date(tsMs).toISOString().slice(0, 10),
    viaRound: false, payerId: p.userId
  });

  /* si marca "recordar este precio", se guarda como su precio por defecto */
  if (b.remember && priceCents > 0) await S.saveMember(p.userId, { defaultPriceCents: priceCents });
  if (m.hiddenUntil || m.homeAt) await S.saveMember(p.userId, { hiddenUntil: 0, homeAt: 0 });

  S.ok(context, { ok: true, ts: new Date(tsMs).toISOString(), priceCents, costCents: priceCents * qty }, 201);
});
