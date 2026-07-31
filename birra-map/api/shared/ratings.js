/* Puntuaciones de bares, 0-5 estrellas. Lógica pura. */
const clavePlace = p => String(p||'').trim().toLowerCase().replace(/\s+/g,' ');
const aMedias = n => Math.round(n*2)/2;

function normalizarEstrellas(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  const r = Math.round(n*2)/2;
  if (r < 0 || r > 5) return null;
  return r;
}

function mediaDe(votos) {
  if (!votos.length) return { media:0, votos:0, reparto:[0,0,0,0,0,0] };
  const suma = votos.reduce((a,v)=>a+v.stars,0);
  const reparto = [0,0,0,0,0,0];
  votos.forEach(v => { reparto[Math.round(v.stars)]++; });
  return { media: Math.round((suma/votos.length)*10)/10, votos: votos.length, reparto };
}

/* solo el ÚLTIMO voto de cada persona en cada bar */
function agruparPorBar(filas) {
  const porBar = new Map();
  for (const f of filas) {
    const k = clavePlace(f.place);
    if (!k) continue;
    if (!porBar.has(k)) porBar.set(k, { clave:k, nombres:{}, ultimos:new Map() });
    const b = porBar.get(k);
    b.nombres[f.place] = (b.nombres[f.place]||0)+1;
    const prev = b.ultimos.get(f.userId);
    if (!prev || f.tsMs > prev.tsMs) b.ultimos.set(f.userId, { userId:f.userId, nick:f.nick, stars:f.stars, tsMs:f.tsMs, note:f.note||'' });
  }
  return [...porBar.values()].map(b => {
    const votos = [...b.ultimos.values()];
    return {
      place: Object.entries(b.nombres).sort((a,c)=>c[1]-a[1])[0][0],
      clave: b.clave, ...mediaDe(votos),
      votantes: votos.sort((a,c)=>c.tsMs-a.tsMs)
    };
  });
}

/* Límite inferior de Wilson: ordena por confianza, no por media pelada.
   Un bar con 1 voto de 5 no adelanta a otro con 20 de 4,5. */
function wilsonInferior(media, votos, z = 1.28) {
  if (!votos) return 0;
  const p = Math.max(0, Math.min(1, media/5));
  const z2 = z*z, den = 1 + z2/votos;
  const centro = p + z2/(2*votos);
  const margen = z*Math.sqrt((p*(1-p))/votos + z2/(4*votos*votos));
  return Math.max(0, ((centro-margen)/den)*5);
}

function rankingBares(filas, { z = 1.28 } = {}) {
  const b = agruparPorBar(filas);
  if (!b.length) return [];
  return b.map(x => ({ ...x, puntuacion: Math.round(wilsonInferior(x.media, x.votos, z)*100)/100 }))
    .sort((a,c) => c.puntuacion-a.puntuacion || c.votos-a.votos || a.place.localeCompare(c.place));
}

function miVoto(filas, userId, place) {
  const k = clavePlace(place);
  const m = filas.filter(f => f.userId === userId && clavePlace(f.place) === k);
  return m.length ? m.sort((a,b)=>b.tsMs-a.tsMs)[0] : null;
}

function etiqueta(media, votos) {
  if (!votos) return { txt:'sin votos todavía', nivel:0 };
  if (media >= 4.5) return { txt:'un templo', nivel:5 };
  if (media >= 4) return { txt:'muy bueno', nivel:4 };
  if (media >= 3) return { txt:'cumple', nivel:3 };
  if (media >= 2) return { txt:'regulero', nivel:2 };
  if (media >= 1) return { txt:'flojito', nivel:1 };
  return { txt:'huid de ahí', nivel:0 };
}

/* bares visitados y sin puntuar */
function sinPuntuar(checkins, ratings, userId) {
  const votados = new Set(ratings.filter(r => r.userId === userId).map(r => clavePlace(r.place)));
  const v = new Map();
  for (const c of checkins) {
    if (c.userId !== userId || !c.place) continue;
    const k = clavePlace(c.place);
    if (votados.has(k)) continue;
    const p = v.get(k);
    if (!p || c.tsMs > p.tsMs) v.set(k, { place:c.place, tsMs:c.tsMs, veces:(p?p.veces:0)+1 });
    else p.veces++;
  }
  return [...v.values()].sort((a,b) => b.tsMs - a.tsMs);
}

module.exports = { clavePlace, aMedias, normalizarEstrellas, mediaDe, agruparPorBar,
  wilsonInferior, rankingBares, miVoto, etiqueta, sinPuntuar };
