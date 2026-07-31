const S = require('../shared/store');
const R = require('../shared/ratings');
const C = require('../shared/cache');

/* GET /api/ratings            → ranking de bares
   GET /api/ratings?place=X    → ficha de un bar + mi voto
   GET /api/ratings?pending=1  → bares visitados sin puntuar

   Antes esto escaneaba 2 años de filas y recalculaba el ranking en
   cada carga. Ahora la ventana es de 1 año y tanto las filas como el
   ranking ya calculado van en caché, con invalidación al votar. */
module.exports = S.withMember(async (context, req, p, m) => {
  const VENTANA = 365 * 86400000;
  const desde = Date.now() - VENTANA;

  if (req.query.place) {
    const k = R.clavePlace(req.query.place);
    /* ficha de un bar: se cachea por bar */
    const datos = await C.conCache(`${m.groupId}:agg:bar:${k}`, 45, async () => {
      const todas = await S.listRatings(m.groupId, desde);
      const delBar = todas.filter(r => R.clavePlace(r.place) === k);
      const bar = R.agruparPorBar(delBar)[0] || null;
      return { bar: bar ? { ...bar, etiqueta: R.etiqueta(bar.media, bar.votos) } : null, votos: delBar };
    });
    const mio = R.miVoto(datos.votos, p.userId, req.query.place);
    return S.ok(context, {
      place: req.query.place,
      bar: datos.bar,
      miVoto: mio ? { stars: mio.stars, note: mio.note || '', tsMs: mio.tsMs } : null
    });
  }

  if (req.query.pending === '1') {
    /* solo 60 días de check-ins: no hace falta más para sugerir */
    const [ch, todas] = await Promise.all([
      S.listCheckins(m.groupId, Date.now() - 60 * 86400000, 60),
      S.listRatings(m.groupId, desde)
    ]);
    return S.ok(context, { pendientes: R.sinPuntuar(ch, todas, p.userId).slice(0, 12) });
  }

  /* ranking completo: lo caro. Se calcula una vez y se comparte. */
  const base = await C.conCache(`${m.groupId}:agg:ranking`, 60, async () => {
    const todas = await S.listRatings(m.groupId, desde);
    return R.rankingBares(todas).map(b => ({
      place: b.place, media: b.media, votos: b.votos, puntuacion: b.puntuacion,
      reparto: b.reparto, etiqueta: R.etiqueta(b.media, b.votos),
      votantes: b.votantes.map(v => ({ userId: v.userId, nick: v.nick, stars: v.stars, note: v.note }))
    }));
  });

  /* la parte personal se añade encima, sin recalcular nada */
  const ranking = base.map(b => ({
    place: b.place, media: b.media, votos: b.votos, puntuacion: b.puntuacion,
    reparto: b.reparto, etiqueta: b.etiqueta,
    miVoto: (b.votantes.find(v => v.userId === p.userId) || {}).stars ?? null,
    ultimos: b.votantes.slice(0, 5).map(v => ({ nick: v.nick, stars: v.stars, note: v.note }))
  }));

  S.ok(context, {
    total: ranking.length, ranking,
    mejor: ranking[0] || null,
    peor: ranking.length > 1 ? ranking[ranking.length - 1] : null
  });
});
