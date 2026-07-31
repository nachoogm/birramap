const S = require('../shared/store');
const L = require('../shared/logic');
module.exports = S.withMember(async (context, req, p, m) => {
  if (req.method === 'DELETE') {
    await S.saveMember(p.userId, { hiddenUntil: Date.now() });
    return S.ok(context, { ok:true });
  }
  const b = req.body || {};
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return S.err(context, 400, 'Coordenadas no válidas');
  const drink = L.DRINKS.includes(b.drink) ? b.drink : 'cana';
  const qty = Math.min(Math.max(parseInt(b.qty||1,10)||1, 1), 20);
  const priceCents = L.toCents(b.price);
  const tsMs = Date.now();

  const cool = parseInt(process.env.CHECKIN_COOLDOWN_MS ?? '30000', 10);
  if (cool > 0) {
    const rec = await S.listCheckins(m.groupId, tsMs - cool);
    if (rec.some(r => r.userId === p.userId && !r.viaRound))
      return S.err(context, 429, `Tranquilo campeón, espera ${Math.round(cool/1000)} segundos`);
  }

  await S.addCheckin(m.groupId, {
    userId:p.userId, nick:m.nick, drink, qty, priceCents,
    lat:Math.round(lat*1e5)/1e5, lon:Math.round(lon*1e5)/1e5,
    place:String(b.place||'').slice(0,60), note:String(b.note||'').slice(0,80),
    ts:new Date(tsMs).toISOString(), tsMs, day:new Date(tsMs).toISOString().slice(0,10), viaRound:false
  });
  if (m.hiddenUntil || m.homeAt) await S.saveMember(p.userId, { hiddenUntil:0, homeAt:0 });
  S.ok(context, { ok:true, ts:new Date(tsMs).toISOString(), totalCents: priceCents*qty }, 201);
});
