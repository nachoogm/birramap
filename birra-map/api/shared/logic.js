/* Lógica pura, sin Azure ni HTTP. Todo lo que hay aquí es testeable a pelo. */

const MAX_TS = 9999999999999;
const invKey = ms => String(MAX_TS - ms).padStart(13, '0');
/* Sufijo aleatorio: dos fichajes en el mismo milisegundo no pueden chocar
   (pasa de verdad cuando se reparte una ronda entre varios). */
const uniq = () => Math.random().toString(36).slice(2, 8);
const rowKeyFor = (ms, userId, suffix = uniq()) => `${invKey(ms)}_${String(userId).replace(/[/\\#?]/g, '')}_${suffix}`;

const DRINKS = ['cana', 'tercio', 'ipa', 'trigo', 'tostada', 'sin', 'vino', 'tinto', 'copa', 'gintonic', 'sidra', 'refresco'];

/* --- tiempo --- */
const startOfDay = (now = Date.now()) => { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfWeek = (now = Date.now()) => { const x = new Date(now); const d = (x.getDay() + 6) % 7; x.setDate(x.getDate() - d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfMonth = (now = Date.now()) => { const x = new Date(now); x.setDate(1); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfYear = (now = Date.now()) => { const x = new Date(now); x.setMonth(0, 1); x.setHours(0, 0, 0, 0); return x.getTime(); };
const periodStart = (period, now = Date.now()) => ({
  day: startOfDay, week: startOfWeek, month: startOfMonth, year: startOfYear
}[period] || startOfDay)(now);

/* --- distancia (haversine, metros) --- */
function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/* --- quién está de birras ahora --- */
function aggregateActive(rows, membersById = {}, now = Date.now()) {
  const byUser = new Map();
  for (const r of rows) {
    const cur = byUser.get(r.userId);
    if (!cur) {
      byUser.set(r.userId, {
        userId: r.userId, nick: r.nick, drink: r.drink, lat: r.lat, lon: r.lon,
        place: r.place || '', note: r.note || '', ts: r.ts, tsMs: r.tsMs, total: r.qty, rounds: 0
      });
    } else if (r.tsMs > cur.tsMs) {
      Object.assign(cur, { drink: r.drink, lat: r.lat, lon: r.lon, place: r.place || '', note: r.note || '', ts: r.ts, tsMs: r.tsMs });
      cur.total += r.qty;
    } else {
      cur.total += r.qty;
    }
    const c = byUser.get(r.userId);
    if (r.viaRound) c.rounds++;
  }
  return [...byUser.values()]
    .filter(c => {
      const m = membersById[c.userId];
      if (m && m.hiddenUntil && c.tsMs <= m.hiddenUntil) return false;   // cerró la noche / llegó a casa
      return true;
    })
    .map(c => {
      const m = membersById[c.userId];
      return { ...c, nick: (m && m.nick) || c.nick, stale: (now - c.tsMs) > 3 * 3600 * 1000 };
    })
    .sort((a, b) => b.tsMs - a.tsMs);
}

/* --- estadísticas personales --- */
function myStats(ownRows, now = Date.now()) {
  const sum = from => ownRows.filter(r => r.tsMs >= from).reduce((a, r) => a + r.qty, 0);
  const drinks = {}, places = {}, days = new Set();
  for (const r of ownRows) {
    drinks[r.drink] = (drinks[r.drink] || 0) + r.qty;
    if (r.place) places[r.place] = (places[r.place] || 0) + 1;
    days.add(r.day);
  }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  let streak = 0;
  for (let i = 0; i <= 60; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) streak++;
    else if (i > 0) break;
  }
  const total30 = ownRows.reduce((a, r) => a + r.qty, 0);
  return {
    today: sum(startOfDay(now)),
    week: sum(startOfWeek(now)),
    month: sum(startOfMonth(now)),
    avg30: Math.round((total30 / 30) * 10) / 10,
    favorite: top(drinks) || 'cana',
    topPlace: top(places),
    streak
  };
}

/* --- ranking del grupo --- */
function ranking(rows) {
  const agg = new Map();
  for (const r of rows) {
    const a = agg.get(r.userId) || { userId: r.userId, nick: r.nick, total: 0, days: new Set(), drinks: {}, paid: 0 };
    a.total += r.qty;
    a.days.add(r.day);
    a.drinks[r.drink] = (a.drinks[r.drink] || 0) + r.qty;
    if (r.nick) a.nick = r.nick;
    agg.set(r.userId, a);
  }
  return [...agg.values()].map(a => ({
    userId: a.userId, nick: a.nick, total: a.total, sessions: a.days.size,
    favorite: Object.entries(a.drinks).sort((x, y) => y[1] - x[1])[0][0]
  })).sort((a, b) => b.total - a.total || a.nick.localeCompare(b.nick));
}

/* --- deuda de rondas: quién debe cuántas a quién, ya compensado --- */
function netDebts(rounds) {
  const owe = new Map();                       // "deudor|acreedor" -> nº de rondas
  const nicks = {};
  for (const r of rounds) {
    nicks[r.payerId] = r.payerNick;
    const parts = typeof r.participants === 'string' ? JSON.parse(r.participants) : (r.participants || []);
    for (const p of parts) {
      nicks[p.userId] = p.nick;
      if (p.userId === r.payerId) continue;    // el que invita no se debe a sí mismo
      const k = `${p.userId}|${r.payerId}`;
      owe.set(k, (owe.get(k) || 0) + 1);
    }
  }
  const done = new Set(), out = [];
  for (const [k, v] of owe) {
    const [a, b] = k.split('|');
    if (done.has(`${a}|${b}`) || done.has(`${b}|${a}`)) continue;
    done.add(`${a}|${b}`);
    const back = owe.get(`${b}|${a}`) || 0;
    const net = v - back;
    if (net > 0) out.push({ fromId: a, from: nicks[a], toId: b, to: nicks[b], rounds: net });
    else if (net < 0) out.push({ fromId: b, from: nicks[b], toId: a, to: nicks[a], rounds: -net });
  }
  return out.sort((x, y) => y.rounds - x.rounds);
}

/* --- resumen por persona --- 
   paid/receivedRounds = nº de rondas (informativo)
   given/received      = consumiciones invitadas y recibidas (esto sí suma cero en el grupo)
   balance             = given - received  */
function roundStats(rounds) {
  const s = {};
  const touch = (id, nick) => (s[id] = s[id] || { userId: id, nick, paid: 0, receivedRounds: 0, given: 0, received: 0 });
  for (const r of rounds) {
    const parts = typeof r.participants === 'string' ? JSON.parse(r.participants) : (r.participants || []);
    const invitados = parts.filter(p => p.userId !== r.payerId);
    const payer = touch(r.payerId, r.payerNick);
    payer.paid++;
    payer.given += invitados.length;
    for (const p of invitados) { const x = touch(p.userId, p.nick); x.received++; x.receivedRounds++; }
  }
  return Object.values(s)
    .map(x => ({ ...x, balance: x.given - x.received }))
    .sort((a, b) => b.balance - a.balance || b.given - a.given);
}

/* --- heatmap: agrupa por rejilla de ~55 m --- */
function heatmap(rows, precision = 3) {
  const grid = new Map();
  for (const r of rows) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
    const k = `${r.lat.toFixed(precision)},${r.lon.toFixed(precision)}`;
    const g = grid.get(k) || { lat: +r.lat.toFixed(precision), lon: +r.lon.toFixed(precision), weight: 0, places: {} };
    g.weight += r.qty;
    if (r.place) g.places[r.place] = (g.places[r.place] || 0) + 1;
    grid.set(k, g);
  }
  return [...grid.values()].map(g => ({
    lat: g.lat, lon: g.lon, weight: g.weight,
    place: Object.entries(g.places).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  })).sort((a, b) => b.weight - a.weight);
}

/* --- top de bares --- */
function topPlaces(rows, limit = 15) {
  const p = {};
  for (const r of rows) {
    if (!r.place) continue;
    const x = p[r.place] = p[r.place] || { place: r.place, visits: 0, drinks: 0, people: new Set() };
    x.visits++; x.drinks += r.qty; x.people.add(r.userId);
  }
  return Object.values(p).map(x => ({ place: x.place, visits: x.visits, drinks: x.drinks, people: x.people.size }))
    .sort((a, b) => b.drinks - a.drinks).slice(0, limit);
}

/* --- ¿está el evento activo ahora? --- */
const eventActive = (ev, now = Date.now()) => now >= ev.startsMs && now <= ev.endsMs;

/* --- quién está a tiro para meterlo en la ronda --- */
function nearbyPeople(active, lat, lon, radiusM = 300, maxAgeMs = 4 * 3600 * 1000, now = Date.now()) {
  return active
    .filter(a => (now - a.tsMs) <= maxAgeMs)
    .map(a => ({ ...a, distance: distanceM(lat, lon, a.lat, a.lon) }))
    .filter(a => a.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance);
}

module.exports = {
  MAX_TS, invKey, rowKeyFor, uniq, DRINKS,
  startOfDay, startOfWeek, startOfMonth, startOfYear, periodStart,
  distanceM, aggregateActive, myStats, ranking, netDebts, roundStats,
  heatmap, topPlaces, eventActive, nearbyPeople
};
