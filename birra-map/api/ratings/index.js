const S = require('../shared/store');
const R = require('../shared/ratings');

/* GET /api/ratings              → ranking de bares puntuados
   GET /api/ratings?place=X      → ficha de un bar concreto + mi voto
   GET /api/ratings?pending=1    → bares que he visitado y no he puntuado */
module.exports = S.withMember(async (context, req, p, m) => {
  const desde = Date.now() - 730 * 86400000;
  const todas = await S.listRatings(m.groupId, desde);

  if (req.query.place) {
    const k = R.clavePlace(req.query.place);
    const delBar = todas.filter(r => R.clavePlace(r.place) === k);
    const bar = R.agruparPorBar(delBar)[0] || null;
    const mio = R.miVoto(todas, p.userId, req.query.place);
    return S.ok(context, {
      place: req.query.place,
      bar: bar ? { ...bar, etiqueta: R.etiqueta(bar.media, bar.votos) } : null,
      miVoto: mio ? { stars: mio.stars, note: mio.note || '', tsMs: mio.tsMs } : null
    });
  }

  if (req.query.pending === '1') {
    const checkins = await S.listCheckins(m.groupId, Date.now() - 60 * 86400000);
    return S.ok(context, { pendientes: R.sinPuntuar(checkins, todas, p.userId).slice(0, 12) });
  }

  const ranking = R.rankingBares(todas).map(b => ({
    place: b.place, media: b.media, votos: b.votos, puntuacion: b.puntuacion,
    reparto: b.reparto, etiqueta: R.etiqueta(b.media, b.votos),
    miVoto: (b.votantes.find(v => v.userId === p.userId) || {}).stars ?? null,
    ultimos: b.votantes.slice(0, 5).map(v => ({ nick: v.nick, stars: v.stars, note: v.note }))
  }));

  S.ok(context, {
    total: ranking.length,
    ranking,
    mejor: ranking[0] || null,
    peor: ranking.length > 1 ? ranking[ranking.length - 1] : null
  });
});
