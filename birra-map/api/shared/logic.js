/* Lógica pura de BirraMap. Sin Azure, sin HTTP: todo testeable. */
const MAX_TS = 9999999999999;
const invKey = ms => String(MAX_TS - ms).padStart(13, '0');
const uniq = () => Math.random().toString(36).slice(2, 8);
const rowKeyFor = (ms, u, s = uniq()) => `${invKey(ms)}_${String(u).replace(/[/\\#?]/g, '')}_${s}`;

const DRINKS = ['cana','tercio','ipa','trigo','tostada','sin','vino','tinto','copa','gintonic','sidra','refresco'];

/* dinero en céntimos enteros: nada de flotantes */
function toCents(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < 0 || n > 1000) return 0;
  return Math.round(n * 100);
}
const rowCost = r => (r.priceCents || 0) * (r.qty || 0);

const startOfDay = (n = Date.now()) => { const x = new Date(n); x.setHours(0,0,0,0); return x.getTime(); };
const startOfWeek = (n = Date.now()) => { const x = new Date(n); const d = (x.getDay()+6)%7; x.setDate(x.getDate()-d); x.setHours(0,0,0,0); return x.getTime(); };
const startOfMonth = (n = Date.now()) => { const x = new Date(n); x.setDate(1); x.setHours(0,0,0,0); return x.getTime(); };
const startOfYear = (n = Date.now()) => { const x = new Date(n); x.setMonth(0,1); x.setHours(0,0,0,0); return x.getTime(); };
const periodStart = (p, n = Date.now()) => ({day:startOfDay,week:startOfWeek,month:startOfMonth,year:startOfYear}[p]||startOfDay)(n);

function distanceM(la1, lo1, la2, lo2) {
  const R = 6371000, r = x => x*Math.PI/180;
  const dLa = r(la2-la1), dLo = r(lo2-lo1);
  const a = Math.sin(dLa/2)**2 + Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(dLo/2)**2;
  return Math.round(2*R*Math.asin(Math.sqrt(a)));
}

/* quién está de birras ahora */
function aggregateActive(rows, members = {}, now = Date.now()) {
  const by = new Map();
  for (const r of rows) {
    let c = by.get(r.userId);
    if (!c) {
      c = { userId:r.userId, nick:r.nick, drink:r.drink, lat:r.lat, lon:r.lon,
            place:r.place||'', note:r.note||'', ts:r.ts, tsMs:r.tsMs, total:0, spentCents:0, rounds:0 };
      by.set(r.userId, c);
    } else if (r.tsMs > c.tsMs) {
      Object.assign(c, { drink:r.drink, lat:r.lat, lon:r.lon, place:r.place||'', note:r.note||'', ts:r.ts, tsMs:r.tsMs });
    }
    c.total += r.qty;
    if (r.viaRound) c.rounds++;
  }
  /* el gasto lo carga quien paga: en una ronda, el invitador */
  for (const r of rows) {
    const paga = r.viaRound ? (r.payerId || r.userId) : r.userId;
    const b = by.get(paga);
    if (b) b.spentCents += rowCost(r);
  }
  return [...by.values()]
    .filter(c => { const m = members[c.userId]; return !(m && m.hiddenUntil && c.tsMs <= m.hiddenUntil); })
    .map(c => { const m = members[c.userId]; return { ...c, nick:(m&&m.nick)||c.nick, stale:(now-c.tsMs) > 3*3600*1000 }; })
    .sort((a,b) => b.tsMs - a.tsMs);
}

function spentByUser(rows) {
  const s = {};
  for (const r of rows) {
    const paga = r.viaRound ? (r.payerId || r.userId) : r.userId;
    s[paga] = (s[paga] || 0) + rowCost(r);
  }
  return s;
}

function myStats(own, now = Date.now()) {
  const sum = f => own.filter(r => r.tsMs >= f).reduce((a,r) => a+r.qty, 0);
  const dr = {}, pl = {}, days = new Set();
  for (const r of own) {
    dr[r.drink] = (dr[r.drink]||0) + r.qty;
    if (r.place) pl[r.place] = (pl[r.place]||0) + 1;
    days.add(r.day);
  }
  const top = o => Object.entries(o).sort((a,b) => b[1]-a[1])[0]?.[0] || null;
  let streak = 0;
  for (let i = 0; i <= 60; i++) {
    const d = new Date(now); d.setDate(d.getDate()-i);
    if (days.has(d.toISOString().slice(0,10))) streak++;
    else if (i > 0) break;
  }
  const hoy = own.filter(r => r.tsMs >= startOfDay(now));
  return {
    today: sum(startOfDay(now)), week: sum(startOfWeek(now)), month: sum(startOfMonth(now)),
    avg30: Math.round((own.reduce((a,r)=>a+r.qty,0)/30)*10)/10,
    favorite: top(dr) || 'cana', topPlace: top(pl), streak,
    spentCents: hoy.reduce((a,r) => a + rowCost(r), 0)
  };
}

function ranking(rows) {
  const agg = new Map();
  for (const r of rows) {
    const a = agg.get(r.userId) || { userId:r.userId, nick:r.nick, total:0, days:new Set(), drinks:{} };
    a.total += r.qty; a.days.add(r.day);
    a.drinks[r.drink] = (a.drinks[r.drink]||0) + r.qty;
    if (r.nick) a.nick = r.nick;
    agg.set(r.userId, a);
  }
  return [...agg.values()].map(a => ({
    userId:a.userId, nick:a.nick, total:a.total, sessions:a.days.size,
    favorite: Object.entries(a.drinks).sort((x,y)=>y[1]-x[1])[0][0]
  })).sort((a,b) => b.total-a.total || String(a.nick).localeCompare(String(b.nick)));
}

/* deudas compensadas */
function netDebts(rounds) {
  const owe = new Map(), nicks = {};
  for (const r of rounds) {
    nicks[r.payerId] = r.payerNick;
    const parts = typeof r.participants === 'string' ? JSON.parse(r.participants) : (r.participants||[]);
    const precio = r.priceCents || 0;
    for (const p of parts) {
      nicks[p.userId] = p.nick;
      if (p.userId === r.payerId) continue;
      const k = `${p.userId}|${r.payerId}`;
      const v = owe.get(k) || { rounds:0, cents:0 };
      v.rounds++; v.cents += precio; owe.set(k, v);
    }
  }
  const hecho = new Set(), out = [];
  for (const [k] of owe) {
    const [a,b] = k.split('|');
    if (hecho.has(`${a}|${b}`) || hecho.has(`${b}|${a}`)) continue;
    hecho.add(`${a}|${b}`);
    const ida = owe.get(`${a}|${b}`) || { rounds:0, cents:0 };
    const vue = owe.get(`${b}|${a}`) || { rounds:0, cents:0 };
    const nR = ida.rounds - vue.rounds, nC = ida.cents - vue.cents;
    if (nR > 0 || (nR === 0 && nC > 0)) out.push({ fromId:a, from:nicks[a], toId:b, to:nicks[b], rounds:nR, cents:nC });
    else if (nR < 0 || nC < 0) out.push({ fromId:b, from:nicks[b], toId:a, to:nicks[a], rounds:-nR, cents:-nC });
  }
  return out.filter(x => x.rounds !== 0 || x.cents !== 0).sort((x,y) => y.rounds-x.rounds || y.cents-x.cents);
}

function roundStats(rounds) {
  const s = {};
  const t = (id,nick) => (s[id] = s[id] || { userId:id, nick, paid:0, receivedRounds:0, given:0, received:0, givenCents:0, receivedCents:0 });
  for (const r of rounds) {
    const parts = typeof r.participants === 'string' ? JSON.parse(r.participants) : (r.participants||[]);
    const inv = parts.filter(p => p.userId !== r.payerId);
    const precio = r.priceCents || 0;
    const pay = t(r.payerId, r.payerNick);
    pay.paid++; pay.given += inv.length; pay.givenCents += inv.length*precio;
    for (const p of inv) { const x = t(p.userId, p.nick); x.received++; x.receivedRounds++; x.receivedCents += precio; }
  }
  return Object.values(s).map(x => ({ ...x, balance:x.given-x.received, balanceCents:x.givenCents-x.receivedCents }))
    .sort((a,b) => b.balance-a.balance || b.given-a.given);
}

function heatmap(rows, precision = 3) {
  const g = new Map();
  for (const r of rows) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
    const k = `${r.lat.toFixed(precision)},${r.lon.toFixed(precision)}`;
    const x = g.get(k) || { lat:+r.lat.toFixed(precision), lon:+r.lon.toFixed(precision), weight:0, places:{} };
    x.weight += r.qty;
    if (r.place) x.places[r.place] = (x.places[r.place]||0)+1;
    g.set(k, x);
  }
  return [...g.values()].map(x => ({ lat:x.lat, lon:x.lon, weight:x.weight,
    place: Object.entries(x.places).sort((a,b)=>b[1]-a[1])[0]?.[0] || null }))
    .sort((a,b) => b.weight - a.weight);
}

function topPlaces(rows, limit = 15) {
  const p = {};
  for (const r of rows) {
    if (!r.place) continue;
    const k = String(r.place).trim().toLowerCase();
    if (!k) continue;
    const x = p[k] = p[k] || { names:{}, visits:0, drinks:0, people:new Set(), cents:0, conPrecio:0 };
    x.names[r.place] = (x.names[r.place]||0)+1;
    x.visits++; x.drinks += r.qty; x.people.add(r.userId);
    if (r.priceCents > 0) { x.cents += rowCost(r); x.conPrecio += r.qty; }
  }
  return Object.values(p).map(x => ({
    place: Object.entries(x.names).sort((a,b)=>b[1]-a[1])[0][0],
    visits:x.visits, drinks:x.drinks, people:x.people.size, cents:x.cents,
    avgPriceCents: x.conPrecio ? Math.round(x.cents/x.conPrecio) : 0
  })).sort((a,b) => b.drinks - a.drinks).slice(0, limit);
}

/* precio sugerido: mediana de lo pagado en ese bar */
function suggestPrice(rows, place, drinkId = null) {
  if (!place) return 0;
  const k = String(place).trim().toLowerCase();
  let c = rows.filter(r => r.priceCents > 0 && String(r.place||'').trim().toLowerCase() === k);
  if (drinkId) { const d = c.filter(r => r.drink === drinkId); if (d.length) c = d; }
  if (!c.length) return 0;
  const v = c.map(r => r.priceCents).sort((a,b)=>a-b);
  return v[Math.floor(v.length/2)];
}

function spendSummary(rows, userId) {
  const mias = rows.filter(r => r.userId === userId);
  const pagadas = rows.filter(r => (r.viaRound ? r.payerId : r.userId) === userId);
  const invit = mias.filter(r => r.viaRound && r.payerId && r.payerId !== userId);
  return {
    drinks: mias.reduce((a,r)=>a+r.qty,0),
    spentCents: pagadas.reduce((a,r)=>a+rowCost(r),0),
    myOwnCents: mias.filter(r=>!r.viaRound).reduce((a,r)=>a+rowCost(r),0),
    treatedCents: pagadas.filter(r=>r.viaRound && r.userId!==userId).reduce((a,r)=>a+rowCost(r),0),
    savedCents: invit.reduce((a,r)=>a+rowCost(r),0)
  };
}

const eventActive = (e, n = Date.now()) => n >= e.startsMs && n <= e.endsMs;

function nearbyPeople(active, lat, lon, radio = 300, maxEdad = 4*3600*1000, now = Date.now()) {
  return active.filter(a => (now-a.tsMs) <= maxEdad)
    .map(a => ({ ...a, distance: distanceM(lat, lon, a.lat, a.lon) }))
    .filter(a => a.distance <= radio)
    .sort((a,b) => a.distance - b.distance);
}

module.exports = {
  MAX_TS, invKey, uniq, rowKeyFor, DRINKS, toCents, rowCost,
  startOfDay, startOfWeek, startOfMonth, startOfYear, periodStart,
  distanceM, aggregateActive, spentByUser, myStats, ranking,
  netDebts, roundStats, heatmap, topPlaces, suggestPrice, spendSummary,
  eventActive, nearbyPeople
};
