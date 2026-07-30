const S = require('../shared/store');

/* GET /api/checkins?hours=12
   Devuelve: gente activa del grupo (posición + total de la sesión) y mis estadísticas */
module.exports = async function (context, req) {
  const p = S.principal(req);
  if (!p) return S.err(context, 401, 'No autenticado');
  const m = await S.getMember(p.userId);
  if (!m || !m.groupId) return S.err(context, 409, 'Sin grupo');

  const hours = Math.min(Math.max(parseInt(req.query.hours || '12', 10), 1), 24);
  const now = Date.now();
  const rows = await S.listCheckins(m.groupId, now - hours * 3600 * 1000);

  /* --- activos: agrupa por usuario --- */
  const byUser = new Map();
  for (const r of rows) {
    if (r.hiddenUntil && r.tsMs <= r.hiddenUntil) continue;
    const cur = byUser.get(r.userId);
    if (!cur) {
      byUser.set(r.userId, {
        userId: r.userId, nick: r.nick, drink: r.drink, lat: r.lat, lon: r.lon,
        place: r.place, note: r.note, ts: r.ts, tsMs: r.tsMs, total: r.qty
      });
    } else {
      cur.total += r.qty;                       // las filas llegan de la más nueva a la más vieja
    }
  }

  /* oculta a quien haya cerrado la noche */
  const members = new Map();
  for (const u of byUser.keys()) members.set(u, await S.getMember(u));
  const active = [...byUser.values()]
    .filter(c => { const mm = members.get(c.userId); return !(mm && mm.hiddenUntil && c.tsMs <= mm.hiddenUntil); })
    .map(c => { const mm = members.get(c.userId); return { ...c, nick: (mm && mm.nick) || c.nick }; })
    .sort((a, b) => b.tsMs - a.tsMs);

  /* --- mis estadísticas (últimos 30 días) --- */
  const mine = await S.listCheckins(m.groupId, now - 30 * 86400000);
  const own = mine.filter(r => r.userId === p.userId);
  const sum = from => own.filter(r => r.tsMs >= from).reduce((a, r) => a + r.qty, 0);

  const drinkCount = {}, placeCount = {}, days = new Set();
  own.forEach(r => {
    drinkCount[r.drink] = (drinkCount[r.drink] || 0) + r.qty;
    if (r.place) placeCount[r.place] = (placeCount[r.place] || 0) + 1;
    days.add(r.day);
  });
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (days.has(d.toISOString().slice(0, 10))) streak++;
    else if (i > 0) break;                       // el día de hoy puede estar aún vacío
    if (i > 60) break;
  }

  S.ok(context, {
    active,
    me: {
      today: sum(S.startOfDay()),
      week: sum(S.startOfWeek()),
      month: sum(S.startOfMonth()),
      avg30: Math.round((own.reduce((a, r) => a + r.qty, 0) / 30) * 10) / 10,
      favorite: top(drinkCount) || 'cana',
      topPlace: top(placeCount),
      streak
    }
  });
};
