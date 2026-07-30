const S = require('../shared/store');

const DRINKS = ['cana', 'tercio', 'ipa', 'trigo', 'tostada', 'sin', 'vino', 'tinto', 'copa', 'gintonic', 'sidra', 'refresco'];

/* POST /api/checkin  → ficha una ronda
   DELETE /api/checkin → "cierro la noche", desaparece del mapa */
module.exports = async function (context, req) {
  const p = S.principal(req);
  if (!p) return S.err(context, 401, 'No autenticado');
  const m = await S.getMember(p.userId);
  if (!m || !m.groupId) return S.err(context, 409, 'Sin grupo');

  if (req.method === 'DELETE') {
    await S.saveMember(p.userId, { hiddenUntil: Date.now() });
    return S.ok(context, { ok: true });
  }

  const b = req.body || {};
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return S.err(context, 400, 'Coordenadas no válidas');

  const drink = DRINKS.includes(b.drink) ? b.drink : 'cana';
  const qty = Math.min(Math.max(parseInt(b.qty || 1, 10), 1), 20);
  const tsMs = Date.now();

  /* anti-spam simple: máximo 1 fichaje cada 30 s */
  const last = await S.listCheckins(m.groupId, tsMs - 30000);
  if (last.some(r => r.userId === p.userId)) return S.err(context, 429, 'Tranquilo campeón, espera 30 segundos');

  await S.addCheckin(m.groupId, {
    userId: p.userId,
    nick: m.nick || p.name,
    drink, qty,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    place: String(b.place || '').slice(0, 60),
    note: String(b.note || '').slice(0, 80),
    ts: new Date(tsMs).toISOString(),
    tsMs,
    day: new Date(tsMs).toISOString().slice(0, 10)
  });

  /* al fichar vuelves a ser visible */
  if (m.hiddenUntil) await S.saveMember(p.userId, { hiddenUntil: 0 });

  S.ok(context, { ok: true, ts: new Date(tsMs).toISOString() }, 201);
};
