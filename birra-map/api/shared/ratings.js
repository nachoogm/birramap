/* Puntuaciones de bares, 0 a 5 estrellas. Lógica pura y testeable. */

/* Nombre canónico: "Bar Manolo", "bar manolo " y "BAR MANOLO" son el mismo sitio */
function clavePlace(place) {
  return String(place || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Redondeo a medias estrellas para pintar */
const aMedias = n => Math.round(n * 2) / 2;

/* Valida y normaliza una puntuación */
function normalizarEstrellas(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  const r = Math.round(n * 2) / 2;          // admite medias
  if (r < 0 || r > 5) return null;
  return r;
}

/* Media de un bar a partir de sus votos (uno por persona, el último manda) */
function mediaDe(votos) {
  if (!votos.length) return { media: 0, votos: 0, reparto: [0, 0, 0, 0, 0, 0] };
  const suma = votos.reduce((a, v) => a + v.stars, 0);
  const reparto = [0, 0, 0, 0, 0, 0];       // índices 0..5 por estrellas enteras
  votos.forEach(v => { reparto[Math.round(v.stars)]++; });
  return {
    media: Math.round((suma / votos.length) * 10) / 10,
    votos: votos.length,
    reparto
  };
}

/* Agrupa todas las filas de puntuación por bar.
   Solo cuenta el ÚLTIMO voto de cada persona en cada bar. */
function agruparPorBar(filas) {
  const porBar = new Map();
  for (const f of filas) {
    const k = clavePlace(f.place);
    if (!k) continue;
    if (!porBar.has(k)) porBar.set(k, { clave: k, nombres: {}, ultimos: new Map(), comentarios: [] });
    const b = porBar.get(k);
    b.nombres[f.place] = (b.nombres[f.place] || 0) + 1;

    const previo = b.ultimos.get(f.userId);
    if (!previo || f.tsMs > previo.tsMs) {
      b.ultimos.set(f.userId, { userId: f.userId, nick: f.nick, stars: f.stars, tsMs: f.tsMs, note: f.note || '' });
    }
  }

  return [...porBar.values()].map(b => {
    const votos = [...b.ultimos.values()];
    const stats = mediaDe(votos);
    return {
      place: Object.entries(b.nombres).sort((a, c) => c[1] - a[1])[0][0],
      clave: b.clave,
      ...stats,
      votantes: votos.sort((a, c) => c.tsMs - a.tsMs)
        .map(v => ({ userId: v.userId, nick: v.nick, stars: v.stars, tsMs: v.tsMs, note: v.note }))
    };
  });
}

/* Límite inferior del intervalo de Wilson.
   Es la forma correcta de ordenar por valoración: responde a
   "¿cuál es la nota mínima que puedo afirmar con confianza?".
   Un bar con 1 voto de 5 tiene una media preciosa pero muy poca
   confianza, así que su límite inferior es bajo y no adelanta a
   uno con 20 votos de 4,5. */
function wilsonInferior(media, votos, z = 1.28) {
  if (!votos) return 0;
  const p = Math.max(0, Math.min(1, media / 5));      // a escala 0..1
  const z2 = z * z;
  const denom = 1 + z2 / votos;
  const centro = p + z2 / (2 * votos);
  const margen = z * Math.sqrt((p * (1 - p)) / votos + z2 / (4 * votos * votos));
  return Math.max(0, ((centro - margen) / denom) * 5);  // vuelta a 0..5
}

/* Ranking de bares, ordenado por confianza y no por media pelada. */
function rankingBares(filas, { z = 1.28 } = {}) {
  const bares = agruparPorBar(filas);
  if (!bares.length) return [];
  return bares.map(b => ({
    ...b,
    puntuacion: Math.round(wilsonInferior(b.media, b.votos, z) * 100) / 100
  })).sort((a, b) => b.puntuacion - a.puntuacion || b.votos - a.votos || a.place.localeCompare(b.place));
}

/* Mi voto en un bar concreto */
function miVoto(filas, userId, place) {
  const k = clavePlace(place);
  const mios = filas.filter(f => f.userId === userId && clavePlace(f.place) === k);
  if (!mios.length) return null;
  return mios.sort((a, b) => b.tsMs - a.tsMs)[0];
}

/* Pinta las estrellas: "★★★★☆" con media estrella si toca */
function pintarEstrellas(n) {
  const v = aMedias(Math.max(0, Math.min(5, Number(n) || 0)));
  const llenas = Math.floor(v);
  const media = v - llenas >= 0.5;
  return '★'.repeat(llenas) + (media ? '⯨' : '') + '☆'.repeat(5 - llenas - (media ? 1 : 0));
}

/* Etiqueta simpática según la nota */
function etiqueta(media, votos) {
  if (!votos) return { txt: 'sin votos todavía', em: '🤷' };
  if (media >= 4.5) return { txt: 'templo', em: '🏆' };
  if (media >= 4) return { txt: 'muy bueno', em: '😍' };
  if (media >= 3) return { txt: 'cumple', em: '👍' };
  if (media >= 2) return { txt: 'regulero', em: '😐' };
  if (media >= 1) return { txt: 'flojito', em: '😬' };
  return { txt: 'huid', em: '☠️' };
}

/* Los bares que he visitado pero no he puntuado (para pedirlo con tacto) */
function sinPuntuar(checkins, ratings, userId) {
  const votados = new Set(ratings.filter(r => r.userId === userId).map(r => clavePlace(r.place)));
  const visitados = new Map();
  for (const c of checkins) {
    if (c.userId !== userId || !c.place) continue;
    const k = clavePlace(c.place);
    if (votados.has(k)) continue;
    const prev = visitados.get(k);
    if (!prev || c.tsMs > prev.tsMs) visitados.set(k, { place: c.place, tsMs: c.tsMs, veces: (prev ? prev.veces : 0) + 1 });
    else prev.veces++;
  }
  return [...visitados.values()].sort((a, b) => b.tsMs - a.tsMs);
}

module.exports = {
  clavePlace, aMedias, normalizarEstrellas, mediaDe, agruparPorBar,
  wilsonInferior, rankingBares, miVoto, pintarEstrellas, etiqueta, sinPuntuar
};
