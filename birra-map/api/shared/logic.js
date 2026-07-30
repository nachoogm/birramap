/* Lógica pura, sin Azure ni HTTP. Todo esto es testeable a pelo. */

const MAX_TS = 9999999999999;
const invKey = ms => String(MAX_TS - ms).padStart(13, '0');
/* Sufijo aleatorio: dos fichajes en el mismo milisegundo no pueden chocar
   (pasa de verdad al repartir una ronda entre varios). */
const uniq = () => Math.random().toString(36).slice(2, 8);
const rowKeyFor = (ms, userId, suffix = uniq()) => `${invKey(ms)}_${String(userId).replace(/[/\\#?]/g, '')}_${suffix}`;

const DRINKS = ['cana', 'tercio', 'ipa', 'trigo', 'tostada', 'sin', 'vino', 'tinto', 'copa', 'gintonic', 'sidra', 'refresco'];

/* --- dinero: guardamos céntimos enteros, nada de decimales flotantes --- */
const toCents = v => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(String(v).replace(',', '.')) : Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100), 100000);          // tope 1.000 € por consumición
};
const eur = cents => (cents / 100).toFixed(2).replace('.', ',') + ' €';

/* --- tiempo --- */
const startOfDay = (now = Date.now()) => { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfWeek = (now = Date.now()) => { const x = new Date(now); const d = (x.getDay() + 6) % 7; x.setDate(x.getDate() - d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfMonth = (now = Date.now()) => { const x = new Date(now); x.setDate(1); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfYear = (now = Date.now()) => { const x = new Date(now); x.setMonth(0, 1); x.setHours(0, 0, 0, 0); return x.getTime(); };
const periodStart = (period, now = Date.now()) => ({ day: startOfDay, week: startOfWeek, month: startOfMonth, year: startOfYear }[period] || startOfDay)(now);

/* --- distancia (haversine, metros) --- */
function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/* --- coste de una fila: precio unitario × cantidad --- */
const rowCost = r => (r.priceCents || 0) * (r.qty || 0);

/* --- quién está de birras ahora --- */
function aggregateActive(rows, membersById = {}, now = Date.now()) {
  const byUser = new Map();
  for (const r of rows) {
    let cur = byUser.get(r.userId);
    if (!cur) {
      cur = {
        userId: r.userId, nick: r.nick, drink: r.drink, lat: r.lat, lon: r.lon,
        place: r.place || '', note: r.note || '', ts: r.ts, tsMs: r.tsMs,
        total: 0, spentCents: 0, rounds: 0
      };
      byUser.set(r.userId, cur);
    } else if (r.tsMs > cur.tsMs) {
      Object.assign(cur, { drink: r.drink, lat: r.lat, lon: r.lon, place: r.place || '', note: r.note || '', ts: r.ts, tsMs: r.tsMs });
    }
    cur.total += r.qty;
    if (r.viaRound) cur.rounds++;
  }
  /* Segunda pasada: el gasto se carga a quien paga de verdad.
     En una ronda, TODAS las copas las paga el invitador, no cada participante. */
  for (const r of rows) {
    const quienPaga = r.viaRound ? (r.payerId || r.userId) : r.userId;
    const b = byUser.get(quienPaga);
    if (b) b.spentCents += rowCost(r);
  }
  return [...byUser.values()]
    .filter(c => { const m = membersById[c.userId]; return !(m && m.hiddenUntil && c.tsMs <= m.hiddenUntil); })
    .map(c => { const m = membersById[c.userId]; return { ...c, nick: (m && m.nick) || c.nick, stale: (now - c.tsMs) > 3 * 3600 * 1000 }; })
    .sort((a, b) => b.tsMs - a.tsMs);
}

/* --- lo que ha pagado realmente cada uno (invitaciones incluidas) --- */
function spentByUser(rows) {
  const s = {};
  for (const r of rows) {
    const quienPaga = r.viaRound ? (r.payerId || r.userId) : r.userId;
    s[quienPaga] = (s[quienPaga] || 0) + rowCost(r);
  }
  return s;
}

/* --- estadísticas personales --- */
function myStats(ownRows, now = Date.now(), paidRows = null) {
  const sum = from => ownRows.filter(r => r.tsMs >= from).reduce((a, r) => a + r.qty, 0);
  const pagadas = paidRows || ownRows;
  const gasto = from => pagadas.filter(r => r.tsMs >= from).reduce((a, r) => a + rowCost(r), 0);

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
    if (days.has(d.toISOString().slice(0, 10))) streak++;
    else if (i > 0) break;
  }
  const total30 = ownRows.reduce((a, r) => a + r.qty, 0);
  const gasto30 = pagadas.reduce((a, r) => a + rowCost(r), 0);
  const conPrecio = ownRows.filter(r => r.priceCents > 0);
  const copasConPrecio = conPrecio.reduce((a, r) => a + r.qty, 0);

  return {
    today: sum(startOfDay(now)), week: sum(startOfWeek(now)), month: sum(startOfMonth(now)),
    avg30: Math.round((total30 / 30) * 10) / 10,
    spentToday: gasto(startOfDay(now)), spentWeek: gasto(startOfWeek(now)),
    spentMonth: gasto(startOfMonth(now)), spent30: gasto30,
    avgPriceCents: copasConPrecio ? Math.round(conPrecio.reduce((a, r) => a + rowCost(r), 0) / copasConPrecio) : 0,
    favorite: top(drinks) || 'cana', topPlace: top(places), streak
  };
}

/* --- ranking del grupo --- */
function ranking(rows) {
  const gastos = spentByUser(rows);
  const agg = new Map();
  for (const r of rows) {
    const a = agg.get(r.userId) || { userId: r.userId, nick: r.nick, total: 0, days: new Set(), drinks: {} };
    a.total += r.qty;
    a.days.add(r.day);
    a.drinks[r.drink] = (a.drinks[r.drink] || 0) + r.qty;
    if (r.nick) a.nick = r.nick;
    agg.set(r.userId, a);
  }
  return [...agg.values()].map(a => ({
    userId: a.userId, nick: a.nick, total: a.total, sessions: a.days.size,
    spentCents: gastos[a.userId] || 0,
    favorite: Object.entries(a.drinks).sort((x, y) => y[1] - x[1])[0][0]
  })).sort((a, b) => b.total - a.total || a.nick.localeCompare(b.nick));
}

/* --- deudas: en rondas y en euros, ya compensadas --- */
function netDebts(rounds) {
  const owe = new Map();          // "deudor|acreedor" -> { rounds, cents }
  const nicks = {};
  for (const r of rounds) {
    nicks[r.payerId] = r.payerNick;
    const parts = typeof r.participants === 'string' ? JSON.parse(r.participants) : (r.participants || []);
    const precio = r.priceCents || 0;
    for (const p of parts) {
      nicks[p.userId] = p.nick;
      if (p.userId === r.payerId) continue;
      const k = `${p.userId}|${r.payerId}`;
      const v = owe.get(k) || { rounds: 0, cents: 0 };
      v.rounds++; v.cents += precio;
      owe.set(k, v);
    }
  }
  const done = new Set(), out = [];
  for (const [k] of owe) {
    const [a, b] = k.split('|');
    if (done.has(`${a}|${b}`) || done.has(`${b}|${a}`)) continue;
    done.add(`${a}|${b}`);
    const ida = owe.get(`${a}|${b}`) || { rounds: 0, cents: 0 };
    const vuelta = owe.get(`${b}|${a}`) || { rounds: 0, cents: 0 };
    const netR = ida.rounds - vuelta.rounds, netC = ida.cents - vuelta.cents;
    if (netR > 0 || (netR === 0 && netC > 0)) out.push({ fromId: a, from: nicks[a], toId: b, to: nicks[b], rounds: netR, cents: netC });
    else if (netR < 0 || netC < 0) out.push({ fromId: b, from: nicks[b], toId: a, to: nicks[a], rounds: -netR, cents: -netC });
  }
  return out.filter(x => x.rounds !== 0 || x.cents !== 0).sort((x, y) => y.rounds - x.rounds || y.cents - x.cents);
}

/* --- balance por persona: consumiciones invitadas vs recibidas (suma cero) --- */
function roundStats(rounds) {
  const s = {};
  const touch = (id, nick) => (s[id] = s[id] || { userId: id, nick, paid: 0, receivedRounds: 0, given: 0, received: 0, givenCents: 0, receivedCents: 0 });
  for (const r of rounds) {
    const parts = typeof r.participants === 'string' ? JSON.parse(r.participants) : (r.participants || []);
    const invitados = parts.filter(p => p.userId !== r.payerId);
    const precio = r.priceCents || 0;
    const payer = touch(r.payerId, r.payerNick);
    payer.paid++; payer.given += invitados.length; payer.givenCents += invitados.length * precio;
    for (const p of invitados) {
      const x = touch(p.userId, p.nick);
      x.received++; x.receivedRounds++; x.receivedCents += precio;
    }
  }
  return Object.values(s)
    .map(x => ({ ...x, balance: x.given - x.received, balanceCents: x.givenCents - x.receivedCents }))
    .sort((a, b) => b.balance - a.balance || b.given - a.given);
}

/* --- heatmap: rejilla de ~55 m --- */
function heatmap(rows, precision = 3) {
  const grid = new Map();
  for (const r of rows) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
    const k = `${r.lat.toFixed(precision)},${r.lon.toFixed(precision)}`;
    const g = grid.get(k) || { lat: +r.lat.toFixed(precision), lon: +r.lon.toFixed(precision), weight: 0, cents: 0, places: {} };
    g.weight += r.qty; g.cents += rowCost(r);
    if (r.place) g.places[r.place] = (g.places[r.place] || 0) + 1;
    grid.set(k, g);
  }
  return [...grid.values()].map(g => ({
    lat: g.lat, lon: g.lon, weight: g.weight, cents: g.cents,
    place: Object.entries(g.places).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  })).sort((a, b) => b.weight - a.weight);
}

/* --- top de bares, con precio medio real de cada sitio --- */
function topPlaces(rows, limit = 15) {
  const p = {};
  for (const r of rows) {
    if (!r.place) continue;
    /* "Bar Manolo" y "bar manolo" son el mismo garito */
    const key = String(r.place).trim().toLowerCase();
    if (!key) continue;
    const x = p[key] = p[key] || { place: r.place, names: {}, visits: 0, drinks: 0, people: new Set(), cents: 0, pricedDrinks: 0 };
    x.names[r.place] = (x.names[r.place] || 0) + 1;
    x.visits++; x.drinks += r.qty; x.people.add(r.userId);
    if (r.priceCents > 0) { x.cents += rowCost(r); x.pricedDrinks += r.qty; }
  }
  return Object.values(p).map(x => ({
    /* se muestra la forma de escribirlo más usada */
    place: Object.entries(x.names).sort((a, b) => b[1] - a[1])[0][0],
    visits: x.visits, drinks: x.drinks, people: x.people.size, cents: x.cents,
    avgPriceCents: x.pricedDrinks ? Math.round(x.cents / x.pricedDrinks) : 0
  })).sort((a, b) => b.drinks - a.drinks).slice(0, limit);
}

/* --- precio sugerido para un bar: la mediana de lo que se ha pagado allí --- */
function suggestPrice(rows, place, drinkId = null) {
  if (!place) return 0;
  const key = String(place).trim().toLowerCase();
  let cand = rows.filter(r => r.priceCents > 0 && String(r.place || '').trim().toLowerCase() === key);
  if (drinkId) { const d = cand.filter(r => r.drink === drinkId); if (d.length) cand = d; }
  if (!cand.length) return 0;
  const v = cand.map(r => r.priceCents).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

/* --- resumen de gasto de la noche/periodo --- */
function spendSummary(rows, userId) {
  const mias = rows.filter(r => r.userId === userId);
  const pagadoPorMi = rows.filter(r => (r.viaRound ? r.payerId : r.userId) === userId);
  const invitadoAMi = mias.filter(r => r.viaRound && r.payerId && r.payerId !== userId);
  return {
    drinks: mias.reduce((a, r) => a + r.qty, 0),
    spentCents: pagadoPorMi.reduce((a, r) => a + rowCost(r), 0),
    myOwnCents: mias.filter(r => !r.viaRound).reduce((a, r) => a + rowCost(r), 0),
    treatedCents: pagadoPorMi.filter(r => r.viaRound && r.userId !== userId).reduce((a, r) => a + rowCost(r), 0),
    savedCents: invitadoAMi.reduce((a, r) => a + rowCost(r), 0)
  };
}

const eventActive = (ev, now = Date.now()) => now >= ev.startsMs && now <= ev.endsMs;

function nearbyPeople(active, lat, lon, radiusM = 300, maxAgeMs = 4 * 3600 * 1000, now = Date.now()) {
  return active
    .filter(a => (now - a.tsMs) <= maxAgeMs)
    .map(a => ({ ...a, distance: distanceM(lat, lon, a.lat, a.lon) }))
    .filter(a => a.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance);
}

module.exports = {
  MAX_TS, invKey, rowKeyFor, uniq, DRINKS, toCents, eur, rowCost,
  startOfDay, startOfWeek, startOfMonth, startOfYear, periodStart,
  distanceM, aggregateActive, spentByUser, myStats, ranking, netDebts, roundStats,
  heatmap, topPlaces, suggestPrice, spendSummary, eventActive, nearbyPeople
};
