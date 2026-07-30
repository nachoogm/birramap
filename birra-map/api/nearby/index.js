const S = require('../shared/store');
const L = require('../shared/logic');

/* GET /api/nearby?lat=..&lon=..&radius=300 → con quién puedes compartir ronda ahora mismo */
module.exports = S.withMember(async (context, req, p, m) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!isFinite(lat) || !isFinite(lon)) return S.err(context, 400, 'Faltan lat/lon');
  const radius = Math.min(Math.max(parseInt(req.query.radius || '300', 10) || 300, 50), 5000);

  const now = Date.now();
  const rows = await S.listCheckins(m.groupId, now - 6 * 3600 * 1000);
  const members = await S.membersOf(rows.map(r => r.userId));
  const active = L.aggregateActive(rows, members, now);

  S.ok(context, {
    radius,
    people: L.nearbyPeople(active, lat, lon, radius, 4 * 3600 * 1000, now)
      .map(x => ({ userId: x.userId, nick: x.nick, drink: x.drink, place: x.place, distance: x.distance, total: x.total, tsMs: x.tsMs }))
  });
});
