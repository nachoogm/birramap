const S = require('../shared/store');
const R = require('../shared/ratings');
module.exports = S.withMember(async (context, req, p, m) => {
  const b = req.body || {};
  const place = String(b.place||'').trim().slice(0,60);
  if (!place) return S.err(context, 400, 'Dime qué bar estás puntuando');
  const stars = R.normalizarEstrellas(b.stars);
  if (stars === null) return S.err(context, 400, 'La nota va de 0 a 5 estrellas');
  const tsMs = Date.now();
  await S.addRating(m.groupId, {
    userId:p.userId, nick:m.nick, place, placeKey:R.clavePlace(place), stars,
    note:String(b.note||'').slice(0,120),
    lat: isFinite(Number(b.lat)) ? Math.round(Number(b.lat)*1e5)/1e5 : null,
    lon: isFinite(Number(b.lon)) ? Math.round(Number(b.lon)*1e5)/1e5 : null,
    ts:new Date(tsMs).toISOString(), tsMs, day:new Date(tsMs).toISOString().slice(0,10)
  });
  const todas = await S.listRatings(m.groupId, tsMs - 730*86400000);
  const bar = R.agruparPorBar(todas.filter(r => R.clavePlace(r.place) === R.clavePlace(place)))[0] || null;
  S.ok(context, { ok:true, place, stars,
    bar: bar ? { place:bar.place, media:bar.media, votos:bar.votos, etiqueta:R.etiqueta(bar.media,bar.votos) } : null }, 201);
});
