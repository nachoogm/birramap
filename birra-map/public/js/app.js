/* ===================== BirraMap v3 ===================== */
const DRINKS = [
  { id: 'cana', em: '🍺', name: 'Caña' }, { id: 'tercio', em: '🍻', name: 'Tercio' },
  { id: 'ipa', em: '🌿', name: 'IPA' }, { id: 'trigo', em: '🌾', name: 'Trigo' },
  { id: 'tostada', em: '🟤', name: 'Tostada' }, { id: 'sin', em: '🚱', name: 'Sin' },
  { id: 'vino', em: '🍷', name: 'Vino' }, { id: 'tinto', em: '🍹', name: 'Tinto v.' },
  { id: 'copa', em: '🥃', name: 'Copa' }, { id: 'gintonic', em: '🍸', name: 'Gin-tonic' },
  { id: 'sidra', em: '🍏', name: 'Sidra' }, { id: 'refresco', em: '🥤', name: 'Refresco' }
];
const POLL_MS = 20000, NOTIF_RADIUS = 500;

let me = null, map, heatMap, heatLayer, markers = new Map(), timer = null;
let lastData = { active: [], home: [], rounds: [], me: null, tonight: null };
let myPos = null, seenCheckins = new Set(), notifOn = localStorage.getItem('birramap_notif') === '1';
const state = { drink: 'cana', qty: 1, lat: null, lon: null, roundDrink: 'cana', roundSel: new Set(), nearby: [] };

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const drink = id => DRINKS.find(d => d.id === id) || DRINKS[0];
const eur = c => (Number(c || 0) / 100).toFixed(2).replace('.', ',') + ' €';
const toCents = v => { const n = Number(String(v ?? '').replace(',', '.')); return isFinite(n) && n >= 0 ? Math.round(n * 100) : 0; };
const fromCents = c => c ? (c / 100).toFixed(2) : '';

const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) { screen('login'); throw new Error('401'); }
  if (!r.ok) { let m = 'Error'; try { m = (await r.json()).error; } catch {} throw new Error(m); }
  return r.status === 204 ? null : r.json();
};
const screen = id => ['login', 'onboarding', 'app'].forEach(s => $('#scr-' + s).classList.toggle('hidden', s !== id));
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(t._x); t._x = setTimeout(() => t.classList.add('hidden'), 2800); };
const ago = ts => { const mn = Math.floor((Date.now() - new Date(ts).getTime()) / 60000); if (mn < 1) return 'ahora mismo'; if (mn < 60) return `hace ${mn} min`; const h = Math.floor(mn / 60); return `hace ${h}h${mn % 60 ? ' ' + (mn % 60) + 'm' : ''}`; };
const fmtDate = ms => new Date(ms).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const openModal = id => $('#' + id).classList.remove('hidden');
const closeModal = id => $('#' + id).classList.add('hidden');

/* ===================== ARRANQUE ===================== */
(async function boot() {
  let p = null;
  try { p = (await (await fetch('/.auth/me')).json()).clientPrincipal; } catch {}
  if (!p) return screen('login');
  try { me = await api('/me'); } catch { return screen('login'); }
  if (!me.groupId || !me.nick) {
    $('#ob-nick').value = me.nick || p.userDetails || '';
    return screen('onboarding');
  }
  start();
})();

$('#ob-save').onclick = async () => {
  const nick = $('#ob-nick').value.trim(), groupId = $('#ob-group').value.trim().toLowerCase();
  if (!nick || !groupId) return toast('Rellena el mote y el grupo 😉');
  try {
    me = await api('/me', { method: 'POST', body: JSON.stringify({ nick, groupId, defaultPrice: $('#ob-price').value }) });
    start();
  } catch (e) { toast(e.message); }
};

function start() {
  screen('app');
  $('#groupChip').textContent = '👥 ' + me.groupId;
  renderDrinkPickers();
  route(); refresh();
  clearInterval(timer); timer = setInterval(refresh, POLL_MS);
  trackPosition();
  $('#notifToggle').checked = notifOn;
  updateNotifState();
  loadEvents();
}

/* ===================== ROUTER ===================== */
const PAGES = {
  mapa: { title: 'BirraMap', init: initMap },
  ranking: { title: 'Ranking', init: () => loadRanking() },
  gasto: { title: 'Gasto', init: () => loadSpend() },
  deudas: { title: 'Deudas', init: () => loadDebts() },
  heat: { title: 'Mapa de calor', init: () => initHeat() },
  eventos: { title: 'Eventos', init: () => loadEvents() },
  perfil: { title: 'Perfil', init: () => renderProfile() }
};
function route() {
  const name = (location.hash.replace('#/', '') || 'mapa');
  const page = PAGES[name] ? name : 'mapa';
  $$('.page').forEach(p => p.classList.add('hidden'));
  $('#pg-' + page).classList.remove('hidden');
  $$('.nav-i').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  $('#pageTitle').textContent = PAGES[page].title;
  PAGES[page].init();
}
window.addEventListener('hashchange', route);
$('#btnMenu').onclick = () => { location.hash = '#/perfil'; };

/* ===================== MAPA ===================== */
const tiles = () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
function initMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 60); return; }
  map = L.map('map', { zoomControl: false }).setView([40.4168, -3.7038], 13);
  tiles().addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  if (myPos) map.setView([myPos.lat, myPos.lon], 15);
  paintMarkers(lastData.active);
}
function paintMarkers(list) {
  if (!map) return;
  const seen = new Set();
  list.forEach(c => {
    seen.add(c.userId);
    const d = drink(c.drink);
    const cls = `pin${c.stale ? ' stale' : ''}${c.userId === me.userId ? ' me' : ''}`;
    const icon = L.divIcon({ html: `<div class="${cls}">${d.em}<small>${c.total}</small></div>`, className: '', iconSize: [44, 44], iconAnchor: [22, 22] });
    const pop = `<div class="pop"><b>${esc(c.nick)}</b>${c.total} × ${d.name}<br>📍 ${esc(c.place) || 'por ahí'}<br>🕒 ${ago(c.ts)}${c.spentCents ? '<br>💰 ' + eur(c.spentCents) : ''}${c.note ? '<br>💬 ' + esc(c.note) : ''}</div>`;
    if (markers.has(c.userId)) markers.get(c.userId).setLatLng([c.lat, c.lon]).setIcon(icon).setPopupContent(pop);
    else markers.set(c.userId, L.marker([c.lat, c.lon], { icon }).addTo(map).bindPopup(pop));
  });
  [...markers.keys()].filter(k => !seen.has(k)).forEach(k => { map.removeLayer(markers.get(k)); markers.delete(k); });
}

/* ===================== DATOS ===================== */
async function refresh() {
  try {
    const d = await api('/checkins?hours=12');
    checkProximity(d.active);
    lastData = d;
    paintMarkers(d.active);
    renderLive(d);
    if (!$('#pg-perfil').classList.contains('hidden')) renderProfile();
  } catch (e) { console.warn(e); }
}

function renderLive(d) {
  const t = d.tonight;
  $('#tonightBar').innerHTML = t && (t.drinks || t.spentCents) ? `<div class="tonight">
      <div><b>${t.drinks}</b><span>tus copas</span></div>
      <div><b class="money">${eur(t.spentCents)}</b><span>llevas gastado</span></div>
      <div><b class="money">${eur(t.savedCents)}</b><span>te han invitado</span></div>
    </div>` : '';

  const el = $('#liveList');
  if (!d.active.length) {
    el.innerHTML = `<div class="empty">Nadie ha fichado todavía.<br>Sé tú quien abra la veda 🍺</div>`;
  } else {
    el.innerHTML = d.active.map(c => {
      const dk = drink(c.drink);
      const dist = myPos ? ` · ${fmtDist(haversine(myPos.lat, myPos.lon, c.lat, c.lon))}` : '';
      return `<div class="row" data-uid="${c.userId}">
        <div class="em">${dk.em}</div>
        <div class="who"><b>${esc(c.nick)}${c.userId === me.userId ? ' (tú)' : ''}</b>
          <span>${c.total} × ${dk.name} · 📍 ${esc(c.place) || 'por ahí'} · ${ago(c.ts)}${dist}</span></div>
        <div class="cnt">${c.total}${c.spentCents ? `<small>${eur(c.spentCents)}</small>` : ''}</div></div>`;
    }).join('');
    el.querySelectorAll('.row').forEach(r => r.onclick = () => showPerson(r.dataset.uid));
  }
  $('#homeList').innerHTML = d.home && d.home.length
    ? `<h3 class="h">Ya en casa</h3>` + d.home.map(h =>
      `<div class="row home"><div class="em">🏠</div><div class="who"><b>${esc(h.nick)}</b><span>llegó bien · ${ago(h.homeAt)}</span></div></div>`).join('')
    : '';
}

function showPerson(uid) {
  const c = lastData.active.find(a => a.userId === uid);
  if (!c) return;
  const d = drink(c.drink);
  const rondas = lastData.rounds.filter(r => (r.participants || []).some(p => p.userId === uid));
  const invitadas = lastData.rounds.filter(r => r.payerId === uid);
  $('#detailBody').innerHTML = `
    <h3>${d.em} ${esc(c.nick)}</h3>
    <div class="stat"><span>Lleva</span><b>${c.total} consumiciones</b></div>
    <div class="stat"><span>Bebiendo</span><b>${d.name}</b></div>
    <div class="stat"><span>Dónde</span><b>${esc(c.place) || 'por ahí'}</b></div>
    <div class="stat"><span>Se ha dejado</span><b class="money">${eur(c.spentCents)}</b></div>
    <div class="stat"><span>Rondas que ha puesto</span><b>${invitadas.length}</b></div>
    <div class="stat"><span>Rondas en las que entró</span><b>${rondas.length}</b></div>
    <div class="stat"><span>Último fichaje</span><b>${ago(c.ts)}</b></div>
    ${myPos ? `<div class="stat"><span>A</span><b>${fmtDist(haversine(myPos.lat, myPos.lon, c.lat, c.lon))} de ti</b></div>` : ''}
    ${c.note ? `<div class="stat"><span>Dice</span><b>${esc(c.note)}</b></div>` : ''}
    <div class="row-btn">
      <button class="btn btn-ghost" data-close="mdDetail">Cerrar</button>
      <a class="btn btn-primary" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}">Cómo llegar 🚶</a>
    </div>`;
  openModal('mdDetail');
}

/* ===================== FICHAR ===================== */
function renderDrinkPickers() {
  const build = (sel, key, after) => {
    $(sel).innerHTML = DRINKS.map(d => `<div class="drink ${state[key] === d.id ? 'sel' : ''}" data-id="${d.id}"><b>${d.em}</b>${d.name}</div>`).join('');
    $(sel).querySelectorAll('.drink').forEach(e => e.onclick = () => { state[key] = e.dataset.id; build(sel, key, after); after && after(); });
  };
  build('#drinks', 'drink', () => { suggestFor('checkin'); updateTotals(); });
  build('#roundDrinks', 'roundDrink', () => { suggestFor('round'); updateTotals(); });
}

function updateTotals() {
  const pc = toCents($('#priceInput').value);
  $('#checkinTotal').innerHTML = pc
    ? `Total: ${eur(pc * state.qty)}<small>${state.qty} × ${eur(pc)}</small>`
    : `Sin precio<small>Puedes fichar igual, pero no contará para el gasto</small>`;
  const rp = toCents($('#roundPrice').value), n = state.roundSel.size + 1;
  $('#roundTotal').innerHTML = rp
    ? `Te va a costar ${eur(rp * n)}<small>${n} personas × ${eur(rp)}</small>`
    : `Sin precio<small>Pon cuánto vale aquí la consumición</small>`;
}

/* precio sugerido según el bar que hayas escrito */
async function suggestFor(which) {
  const place = which === 'checkin' ? $('#placeName').value.trim() : $('#roundPlace').value.trim();
  const dk = which === 'checkin' ? state.drink : state.roundDrink;
  const hint = which === 'checkin' ? $('#priceHint') : $('#roundPriceHint');
  const input = which === 'checkin' ? $('#priceInput') : $('#roundPrice');
  if (!place) { hint.textContent = ''; return; }
  try {
    const r = await api(`/prices?place=${encodeURIComponent(place)}&drink=${encodeURIComponent(dk)}`);
    if (r.suggestedCents) {
      hint.textContent = `aquí soléis pagar ${eur(r.suggestedCents)}`;
      if (!input.value) input.value = fromCents(r.suggestedCents);
    } else {
      hint.textContent = r.myDefaultCents ? `tu precio: ${eur(r.myDefaultCents)}` : '';
      if (!input.value && r.myDefaultCents) input.value = fromCents(r.myDefaultCents);
    }
    updateTotals();
  } catch {}
}

$('#fabDrink').onclick = () => {
  openModal('mdCheckin');
  $('#priceInput').value = fromCents(me.defaultPriceCents);
  $('#priceHint').textContent = me.defaultPriceCents ? `tu precio: ${eur(me.defaultPriceCents)}` : '';
  updateTotals();
  $('#geoStatus').textContent = 'buscando GPS…';
  locate(async (lat, lon) => {
    state.lat = lat; state.lon = lon;
    $('#geoStatus').textContent = '✅ ubicación lista';
    if (!$('#placeName').value) { $('#placeName').value = await guessPlace(lat, lon); suggestFor('checkin'); }
  });
};
$('#placeName').addEventListener('change', () => suggestFor('checkin'));
$('#priceInput').addEventListener('input', updateTotals);
$('#roundPlace').addEventListener('change', () => suggestFor('round'));
$('#roundPrice').addEventListener('input', updateTotals);

$('#saveCheckin').onclick = async () => {
  if (state.lat == null) return toast('Espera al GPS un segundo 📡');
  try {
    const r = await api('/checkin', {
      method: 'POST',
      body: JSON.stringify({
        drink: state.drink, qty: state.qty, lat: state.lat, lon: state.lon,
        place: $('#placeName').value.trim(), note: $('#note').value.trim(),
        price: $('#priceInput').value, remember: $('#rememberPrice').checked
      })
    });
    if ($('#rememberPrice').checked && r.priceCents) me.defaultPriceCents = r.priceCents;
    closeModal('mdCheckin');
    state.qty = 1; $('#qtyVal').textContent = 1; $('#note').value = '';
    toast(r.costCents ? `¡Fichado! 🍻 ${eur(r.costCents)}` : '¡Fichado! 🍻');
    refresh();
  } catch (e) { toast(e.message); }
};
$$('.qty-btn').forEach(b => b.onclick = () => {
  state.qty = Math.max(1, Math.min(20, state.qty + (+b.dataset.d)));
  $('#qtyVal').textContent = state.qty; updateTotals();
});

/* ===================== RONDA ===================== */
$('#fabRound').onclick = () => {
  openModal('mdRound');
  state.roundSel.clear();
  $('#roundPrice').value = fromCents(me.defaultPriceCents);
  $('#nearStatus').textContent = 'buscando gente…';
  $('#nearList').innerHTML = '';
  updateTotals();
  locate(async (lat, lon) => {
    state.lat = lat; state.lon = lon;
    if (!$('#roundPlace').value) $('#roundPlace').value = await guessPlace(lat, lon);
    suggestFor('round');
    try {
      const r = await api(`/nearby?lat=${lat}&lon=${lon}&radius=500&place=${encodeURIComponent($('#roundPlace').value)}&drink=${state.roundDrink}`);
      state.nearby = r.people.filter(p => p.userId !== me.userId);
      state.nearby.forEach(p => state.roundSel.add(p.userId));
      if (r.suggestedPriceCents && !$('#roundPrice').value) $('#roundPrice').value = fromCents(r.suggestedPriceCents);
      renderNear();
    } catch (e) { $('#nearStatus').textContent = e.message; }
  });
};
function renderNear() {
  $('#nearStatus').textContent = state.nearby.length ? `${state.nearby.length} a menos de 500 m` : '';
  $('#nearList').innerHTML = state.nearby.length
    ? state.nearby.map(p => `<div class="row ${state.roundSel.has(p.userId) ? 'sel' : ''}" data-uid="${p.userId}">
        <div class="chk">${state.roundSel.has(p.userId) ? '✅' : '⬜'}</div>
        <div class="who"><b>${esc(p.nick)}</b><span>${esc(p.place) || 'por ahí'} · a ${fmtDist(p.distance)}</span></div></div>`).join('')
    : `<div class="empty">No hay nadie del grupo cerca ahora mismo.<br>Que fichen ellos primero 😅</div>`;
  $('#nearList').querySelectorAll('.row').forEach(r => r.onclick = () => {
    const id = r.dataset.uid;
    state.roundSel.has(id) ? state.roundSel.delete(id) : state.roundSel.add(id);
    renderNear(); updateTotals();
  });
  updateTotals();
}
$('#saveRound').onclick = async () => {
  if (state.lat == null) return toast('Espera al GPS 📡');
  if (!state.roundSel.size) return toast('Marca al menos a uno, invitarte a ti solo no cuenta 😄');
  try {
    const r = await api('/round', {
      method: 'POST',
      body: JSON.stringify({
        drink: state.roundDrink, lat: state.lat, lon: state.lon,
        place: $('#roundPlace').value.trim(), participants: [...state.roundSel], price: $('#roundPrice').value
      })
    });
    closeModal('mdRound');
    toast(r.totalCents ? `Ronda de ${r.size} · ${eur(r.totalCents)} 🤝` : `Ronda de ${r.size} pagada 🤝`);
    refresh();
  } catch (e) { toast(e.message); }
};

/* ===================== RANKING ===================== */
async function loadRanking() {
  const ev = $('#rankEvent').value;
  const activo = $('#rankSeg').querySelector('.seg-btn.active');
  const q = ev ? `?eventId=${encodeURIComponent(ev)}` : `?period=${activo ? activo.dataset.period : 'day'}`;
  try {
    const r = await api('/ranking' + q);
    const medals = ['🥇', '🥈', '🥉'];
    $('#rankList').innerHTML = r.list.length
      ? r.list.map((x, i) => `<div class="row"><div class="medal">${medals[i] || (i + 1)}</div>
          <div class="who"><b>${esc(x.nick)}${x.userId === me.userId ? ' (tú)' : ''}</b>
            <span>${x.sessions} ${x.sessions === 1 ? 'sesión' : 'sesiones'} · ${drink(x.favorite).em} ${drink(x.favorite).name}${x.roundsPaid ? ` · 🤝 ${x.roundsPaid}` : ''}</span></div>
          <div class="cnt">${x.total}${x.spentCents ? `<small>${eur(x.spentCents)}</small>` : '<small>copas</small>'}</div></div>`).join('')
      : `<div class="empty">Aún no hay nada en este periodo.</div>`;
  } catch (e) { $('#rankList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('#rankSeg').querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
  $('#rankSeg').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); $('#rankEvent').value = ''; loadRanking();
});
$('#rankEvent').onchange = loadRanking;

/* ===================== GASTO ===================== */
async function loadSpend() {
  const activo = $('#spendSeg').querySelector('.seg-btn.active');
  const period = activo ? activo.dataset.period : 'month';
  try {
    const d = await api('/spend?period=' + period);
    const nombre = { day: 'hoy', week: 'esta semana', month: 'este mes', year: 'este año' }[period];
    $('#spendHero').innerHTML = `<b class="money">${eur(d.mine.spentCents)}</b><span>te has dejado ${nombre}</span>`;
    $('#spendMine').innerHTML = `
      <div class="stat"><span>En lo tuyo</span><b class="money">${eur(d.mine.myOwnCents)}</b></div>
      <div class="stat"><span>En invitar</span><b class="money">${eur(d.mine.treatedCents)}</b></div>
      <div class="stat"><span>Te han invitado</span><b class="money">${eur(d.mine.savedCents)}</b></div>
      <div class="stat"><span>Tus consumiciones</span><b>${d.mine.drinks}</b></div>
      <div class="stat"><span>Total del grupo</span><b class="money">${eur(d.totalCents)}</b></div>`;
    $('#spendPeople').innerHTML = d.byPerson.length
      ? d.byPerson.map((x, i) => `<div class="row"><div class="medal">${i + 1}</div>
          <div class="who"><b>${esc(x.nick)}${x.userId === me.userId ? ' (tú)' : ''}</b>
            <span>${x.drinks} copas · media ${eur(x.avgPriceCents)}</span></div>
          <div class="cnt money">${eur(x.spentCents)}</div></div>`).join('')
      : `<div class="empty">Nadie ha puesto precios todavía.</div>`;
    $('#spendPlaces').innerHTML = d.byPlace.filter(p => p.cents).length
      ? d.byPlace.filter(p => p.cents).map(p => `<div class="row"><div class="em">🍺</div>
          <div class="who"><b>${esc(p.place)}</b><span>${p.drinks} copas · media ${eur(p.avgPriceCents)}</span></div>
          <div class="cnt money">${eur(p.cents)}</div></div>`).join('')
      : `<div class="empty">Sin datos de precio por bar.</div>`;
    $('#spendWarn').textContent = d.drinksWithoutPrice
      ? `⚠️ ${d.drinksWithoutPrice} consumiciones sin precio, no cuentan en el total.`
      : 'Todas las consumiciones tienen precio 👌';
  } catch (e) { $('#spendMine').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('#spendSeg').querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
  $('#spendSeg').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); loadSpend();
});

/* ===================== DEUDAS ===================== */
async function loadDebts() {
  try {
    const d = await api('/debts?days=90');
    const debo = d.mine.owes.reduce((a, x) => a + x.rounds, 0);
    const meDeben = d.mine.owed.reduce((a, x) => a + x.rounds, 0);
    const deboC = d.mine.owes.reduce((a, x) => a + x.cents, 0);
    const debenC = d.mine.owed.reduce((a, x) => a + x.cents, 0);
    const saldo = meDeben - debo, saldoC = debenC - deboC;
    $('#debtHero').innerHTML = `<b>${saldo >= 0 ? '+' : ''}${saldo}</b>
      <span>${saldo > 0 ? 'rondas a tu favor' : saldo < 0 ? 'rondas que debes, ve soltando' : 'estás en paz, qué aburrido'}${saldoC ? ` · ${eur(Math.abs(saldoC))}` : ''}</span>`;
    $('#debtList').innerHTML = d.debts.length
      ? d.debts.map(x => {
        const soyYo = x.fromId === me.userId, meDeben2 = x.toId === me.userId;
        return `<div class="row ${soyYo ? 'debt' : meDeben2 ? 'credit' : ''}">
          <div class="em">${soyYo ? '😬' : meDeben2 ? '🤑' : '🍺'}</div>
          <div class="who"><b>${esc(x.from)} → ${esc(x.to)}</b><span>${
            x.rounds === 0
              ? 'a la par en rondas, pero invitó más caro'
              : (soyYo ? 'le debes' : meDeben2 ? 'te debe' : 'entre ellos') + ` ${x.rounds} ${x.rounds === 1 ? 'ronda' : 'rondas'}`
          }</span></div>
          <div class="cnt">${x.cents ? eur(x.cents) : x.rounds}<small>${x.cents ? (x.rounds ? x.rounds + (x.rounds === 1 ? ' ronda' : ' rondas') : 'de diferencia') : 'rondas'}</small></div></div>`;
      }).join('')
      : `<div class="empty">Nadie debe nada. Sospechoso.</div>`;
    $('#balList').innerHTML = d.balance.length
      ? d.balance.map(b => `<div class="row"><div class="em">${b.balance > 0 ? '🏅' : b.balance < 0 ? '🐀' : '🤝'}</div>
          <div class="who"><b>${esc(b.nick)}</b><span>invitó a ${b.given} · le invitaron ${b.received} · ${b.paid} rondas puestas</span></div>
          <div class="cnt">${b.balance > 0 ? '+' : ''}${b.balance}${b.balanceCents ? `<small>${eur(b.balanceCents)}</small>` : ''}</div></div>`).join('')
      : `<div class="empty">Todavía no ha invitado nadie.</div>`;
  } catch (e) { $('#debtList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

/* ===================== HEATMAP ===================== */
function initHeat() {
  if (!heatMap) {
    heatMap = L.map('heatmap', { zoomControl: false }).setView(myPos ? [myPos.lat, myPos.lon] : [40.4168, -3.7038], 13);
    tiles().addTo(heatMap);
    $('#pg-heat').querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
      $('#pg-heat').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); loadHeat(b.dataset.scope);
    });
  }
  setTimeout(() => heatMap.invalidateSize(), 60);
  const a = $('#pg-heat').querySelector('.seg-btn.active');
  loadHeat(a ? a.dataset.scope : 'group');
}
async function loadHeat(scope) {
  try {
    const d = await api(`/heatmap?days=365&scope=${scope}`);
    if (heatLayer) heatMap.removeLayer(heatLayer);
    const max = Math.max(1, ...d.points.map(p => p.weight));
    heatLayer = L.heatLayer(d.points.map(p => [p.lat, p.lon, p.weight / max]), {
      radius: 28, blur: 20, maxZoom: 17,
      gradient: { 0.2: '#3ba3e8', 0.45: '#39d98a', 0.7: '#f5b301', 1: '#ff4d4d' }
    }).addTo(heatMap);
    if (d.points.length) heatMap.fitBounds(L.latLngBounds(d.points.map(p => [p.lat, p.lon])).pad(0.25), { maxZoom: 15 });
    $('#heatTop').innerHTML = d.top.length
      ? `<h3 class="h">Top bares · ${d.totalDrinks} copas${d.totalCents ? ' · ' + eur(d.totalCents) : ''}</h3>` + d.top.map((t, i) =>
        `<div class="row" data-i="${i}"><div class="medal">${i + 1}</div>
          <div class="who"><b>${esc(t.place)}</b><span>${t.visits} visitas · ${t.people} personas${t.avgPriceCents ? ' · media ' + eur(t.avgPriceCents) : ''}</span></div>
          <div class="cnt">${t.drinks}${t.cents ? `<small>${eur(t.cents)}</small>` : '<small>copas</small>'}</div></div>`).join('')
      : `<div class="empty">Todavía no hay historial suficiente.</div>`;
    $('#heatTop').querySelectorAll('.row').forEach(r => r.onclick = () => {
      const p = d.points.find(x => x.place === d.top[+r.dataset.i].place);
      if (p) heatMap.setView([p.lat, p.lon], 17);
    });
  } catch (e) { $('#heatTop').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

/* ===================== EVENTOS ===================== */
async function loadEvents() {
  try {
    const list = await api('/events');
    const activo = list.find(e => e.active);
    $('#eventChip').classList.toggle('hidden', !activo);
    if (activo) $('#eventChip').textContent = '🎪 ' + activo.name;
    $('#rankEvent').innerHTML = `<option value="">— Sin evento —</option>` +
      list.map(e => `<option value="${e.id}">${esc(e.name)}${e.active ? ' (en curso)' : ''}</option>`).join('');
    const el = $('#evList');
    if (el) {
      el.innerHTML = list.length
        ? list.map(e => `<div class="row" data-id="${e.id}">
            <div class="em">${e.active ? '🔴' : e.upcoming ? '🗓️' : '🏁'}</div>
            <div class="who"><b>${esc(e.name)}</b><span>${fmtDate(e.startsMs)} → ${fmtDate(e.endsMs)} · por ${esc(e.createdByNick)}</span></div>
            <div class="cnt">${e.active ? '🍺' : ''}</div></div>`).join('')
        : `<div class="empty">Sin eventos. Crea uno para la próxima feria.</div>`;
      el.querySelectorAll('.row').forEach(r => r.onclick = () => {
        location.hash = '#/ranking';
        setTimeout(() => { $('#rankEvent').value = r.dataset.id; loadRanking(); }, 60);
      });
    }
  } catch {}
}
$('#ev-save').onclick = async () => {
  const name = $('#ev-name').value.trim(), s = $('#ev-start').value, e = $('#ev-end').value;
  if (!name || !s || !e) return toast('Nombre y fechas, campeón');
  try {
    await api('/events', { method: 'POST', body: JSON.stringify({ name, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() }) });
    $('#ev-name').value = ''; toast('Evento creado 🎪'); loadEvents();
  } catch (err) { toast(err.message); }
};

/* ===================== PERFIL ===================== */
async function renderProfile() {
  const m = lastData.me;
  $('#mnu-nick').value = me.nick; $('#mnu-group').value = me.groupId;
  $('#mnu-price').value = fromCents(me.defaultPriceCents);
  if (m) {
    $('#mineStats').innerHTML = `
      <div class="hero"><b>${m.today}</b><span>consumiciones hoy${m.today > 6 ? ' · bebe agua, campeón 💧' : ''}</span></div>
      <div class="stat"><span>Gastado hoy</span><b class="money">${eur(m.spentToday)}</b></div>
      <div class="stat"><span>Esta semana</span><b>${m.week} · <span class="money">${eur(m.spentWeek)}</span></b></div>
      <div class="stat"><span>Este mes</span><b>${m.month} · <span class="money">${eur(m.spentMonth)}</span></b></div>
      <div class="stat"><span>Últimos 30 días</span><b class="money">${eur(m.spent30)}</b></div>
      <div class="stat"><span>Precio medio que pagas</span><b class="money">${eur(m.avgPriceCents)}</b></div>
      <div class="stat"><span>Media diaria</span><b>${m.avg30} copas</b></div>
      <div class="stat"><span>Tu favorita</span><b>${drink(m.favorite).em} ${drink(m.favorite).name}</b></div>
      <div class="stat"><span>Bar top</span><b>${esc(m.topPlace) || '—'}</b></div>
      <div class="stat"><span>Racha de días</span><b>${m.streak} 🔥</b></div>`;
  }
  try {
    const p = await api('/prices');
    $('#priceList').innerHTML = p.places.length
      ? p.places.map(x => `<div class="row"><div class="em">🍺</div>
          <div class="who"><b>${esc(x.place)}</b><span>${x.drinks} copas · ${x.visits} visitas</span></div>
          <div class="cnt money">${eur(x.avgPriceCents)}</div></div>`).join('')
      : `<div class="empty">Aún no hay precios registrados.<br>Ponlos al fichar y verás dónde te clavan.</div>`;
  } catch {}
}
$('#mnu-save').onclick = async () => {
  try {
    me = await api('/me', {
      method: 'POST',
      body: JSON.stringify({ nick: $('#mnu-nick').value.trim(), groupId: $('#mnu-group').value.trim().toLowerCase(), defaultPrice: $('#mnu-price').value })
    });
    $('#groupChip').textContent = '👥 ' + me.groupId;
    markers.forEach(mk => map && map.removeLayer(mk)); markers.clear();
    toast('Guardado ✅'); refresh(); loadEvents();
  } catch (e) { toast(e.message); }
};
$('#btnHome').onclick = async () => {
  try { await api('/home', { method: 'POST' }); toast('Avisados. Descansa 🏠'); refresh(); } catch (e) { toast(e.message); }
};
$('#btnClose').onclick = async () => {
  try { await api('/checkin', { method: 'DELETE' }); toast('Fuera del mapa 🚕'); refresh(); } catch (e) { toast(e.message); }
};

/* ===================== NOTIFICACIONES ===================== */
$('#notifToggle').onchange = async e => {
  if (e.target.checked) {
    const perm = await Notification.requestPermission();
    notifOn = perm === 'granted';
    e.target.checked = notifOn;
    if (!notifOn) toast('El navegador ha bloqueado los avisos');
  } else notifOn = false;
  localStorage.setItem('birramap_notif', notifOn ? '1' : '0');
  updateNotifState();
};
function updateNotifState() {
  const p = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  $('#notifState').textContent = p === 'unsupported'
    ? 'Tu navegador no soporta avisos.'
    : notifOn ? 'Activado: te avisamos cuando alguien fiche a menos de 500 m.'
      : 'Desactivado. Actívalo y no te perderás una ronda.';
}
function checkProximity(active) {
  const first = seenCheckins.size === 0;
  active.forEach(c => {
    const key = c.userId + '_' + c.tsMs;
    const isNew = !seenCheckins.has(key);
    seenCheckins.add(key);
    if (first || !isNew || !notifOn || !myPos || c.userId === me.userId) return;
    const dist = haversine(myPos.lat, myPos.lon, c.lat, c.lon);
    if (dist > NOTIF_RADIUS) return;
    notify(`${c.nick} está a ${fmtDist(dist)} 🍺`, `${drink(c.drink).name} en ${c.place || 'por ahí'}. Vete para allá.`);
  });
  if (seenCheckins.size > 400) seenCheckins = new Set([...seenCheckins].slice(-200));
}
function notify(title, body) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/badge.png', tag: 'birramap', data: { url: '/#/mapa' } };
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(() => {});
}

/* ===================== UTILES ===================== */
function haversine(a, b, c, d) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(c - a), dLon = r(d - b);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
const fmtDist = m => m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;

function locate(cb) {
  if (!navigator.geolocation) { const c = map ? map.getCenter() : { lat: 40.4168, lng: -3.7038 }; return cb(c.lat, c.lng); }
  navigator.geolocation.getCurrentPosition(
    p => { myPos = { lat: p.coords.latitude, lon: p.coords.longitude }; cb(myPos.lat, myPos.lon); },
    () => { const c = map ? map.getCenter() : { lat: 40.4168, lng: -3.7038 }; $('#geoStatus').textContent = '⚠️ sin GPS, uso el centro del mapa'; cb(c.lat, c.lng); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}
function trackPosition() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(p => { myPos = { lat: p.coords.latitude, lon: p.coords.longitude }; },
    () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 });
}
async function guessPlace(lat, lon) {
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`)).json();
    return r.name || (r.address && (r.address.bar || r.address.pub || r.address.cafe || r.address.restaurant || r.address.road)) || '';
  } catch { return ''; }
}

document.addEventListener('click', e => {
  const c = e.target.dataset && e.target.dataset.close;
  if (c) closeModal(c);
  if (e.target.classList && e.target.classList.contains('modal')) e.target.classList.add('hidden');
});
$('#sheetHandle').onclick = () => $('#sheet').classList.toggle('open');
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) refresh(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
