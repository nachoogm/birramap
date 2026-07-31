/* ============================================================
   BirraMap · componentes de interfaz
   Estrellas, tour, ayuda, ubicación y utilidades. Todo con SVG.
   ============================================================ */

const UI = (() => {

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- estrellas ---------------- */
  function estrellas(valor, clase = '') {
    const v = Math.max(0, Math.min(5, Number(valor) || 0));
    let h = `<span class="estrellas ${clase}">`;
    for (let i = 1; i <= 5; i++) {
      const on = i <= Math.round(v);
      h += ICON.get(on ? 'estrellaLlena' : 'estrella', 15, on ? 'on' : '');
    }
    return h + '</span>';
  }

  const TEXTOS_NOTA = {
    0: 'Ni de broma', 1: 'Flojito', 2: 'Regulero',
    3: 'Cumple', 4: 'Muy bueno', 5: 'Un templo'
  };

  function pickerEstrellas(cont, { valor = 0, onCambio = null } = {}) {
    const c = typeof cont === 'string' ? $(cont) : cont;
    if (!c) return { valor: () => 0, set() {} };
    let actual = valor;
    const pintar = () => {
      c.innerHTML = `<div class="picker-est">
          ${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" class="${i <= actual ? 'on' : ''}"
             aria-label="${i} estrella${i > 1 ? 's' : ''}">${ICON.get(i <= actual ? 'estrellaLlena' : 'estrella', 44)}</button>`).join('')}
        </div>
        <div class="nota-txt">${actual > 0 ? esc(TEXTOS_NOTA[Math.round(actual)]) : 'Toca para puntuar'}</div>`;
      c.querySelectorAll('button').forEach(b => b.onclick = () => {
        const v = Number(b.dataset.v);
        actual = (actual === v) ? v - 1 : v;   /* volver a tocar la misma la baja */
        pintar();
        if (onCambio) onCambio(actual);
      });
    };
    pintar();
    return { valor: () => actual, set: v => { actual = v; pintar(); } };
  }

  function reparto(arr, total) {
    if (!total) return '';
    let h = '<div class="reparto">';
    for (let i = 5; i >= 1; i--) {
      const n = (arr && arr[i]) || 0;
      h += `<div class="reparto-fila"><b>${i}</b>${ICON.get('estrellaLlena', 12)}
        <div class="reparto-barra"><i style="width:${Math.round((n / total) * 100)}%"></i></div>
        <span>${n}</span></div>`;
    }
    return h + '</div>';
  }

  /* ---------------- ubicación ---------------- */
  /* IMPORTANTE: no poner async ni awaits antes de pedirUbicacion. iOS lo exige. */
  function pedirUbicacionUI({ onOk, onFallo = null, statusSel = '#geoStatus' } = {}) {
    const st = $(statusSel);
    const pinta = h => { if (st) st.innerHTML = h; };
    pinta(`<span class="gps-estado"><span class="spin"></span> buscando GPS…</span>`);

    /* ← primera línea ejecutable */
    const pet = GEO.pedirUbicacion({
      onProgreso: (p, c) => {
        pinta(`<span class="gps-estado" style="color:${c.color}">${ICON.get('satelite', 15)} ${c.txt}</span>
               <div class="gps-barra"><i style="width:${c.pct}%;background:${c.color}"></i></div>`);
      },
      onAviso: t => pinta(`<span class="gps-estado"><span class="spin"></span> ${esc(t)}</span>`)
    });

    pet.promesa.then(pos => {
      const c = pos.calidad;
      pinta(`<span class="gps-estado" style="color:${c.color}">${ICON.get('satelite', 15)} ${c.txt}</span>
             <div class="gps-barra"><i style="width:${c.pct}%;background:${c.color}"></i></div>
             <a href="#" data-accion="ajustar" class="mini" style="color:var(--oro);font-weight:600">Ajustar a mano</a>`);
      engancha(st, pos.lat, pos.lon, onOk);
      onOk(pos.lat, pos.lon, pos.accuracy, false);
    }).catch(e => {
      const ex = e.explicado || { titulo: 'Sin ubicación', texto: '', pasos: [] };
      pinta(`<span class="gps-estado" style="color:var(--mal)">${ICON.get('aviso', 15)} ${esc(ex.titulo)}</span>
             <a href="#" data-accion="ajustar" class="btn btn-sm btn-fantasma" style="width:100%;margin-top:8px;text-decoration:none">
               ${ICON.get('mover', 16)} Poner el punto a mano</a>`);
      const centro = (window.__mapaCentro && window.__mapaCentro()) || { lat: 40.4168, lon: -3.7038 };
      engancha(st, centro.lat, centro.lon, onOk);
      if (onFallo) onFallo(ex);
    });
    return pet;
  }

  function engancha(st, lat, lon, onOk) {
    if (!st) return;
    const a = st.querySelector('[data-accion="ajustar"]');
    if (a) a.onclick = ev => { ev.preventDefault(); selectorMapa(lat, lon, onOk); };
  }

  /* ---------------- selector manual ---------------- */
  function selectorMapa(lat, lon, onOk) {
    let c = $('#pickerModal');
    if (!c) {
      c = document.createElement('div');
      c.id = 'pickerModal';
      c.style.cssText = 'position:fixed;inset:0;z-index:1300;background:var(--bg);display:flex;flex-direction:column';
      c.innerHTML = `
        <div style="padding:calc(14px + env(safe-area-inset-top)) 18px 12px;background:var(--surf);border-bottom:1px solid var(--line)">
          <h3>Coloca el punto</h3>
          <p class="mini" style="margin:4px 0 0">Mueve el mapa hasta tu bar. Fichas donde esté el pin central.</p>
        </div>
        <div id="pickerMap" style="flex:1;position:relative"></div>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-100%);z-index:500;
                    pointer-events:none;color:var(--oro);filter:drop-shadow(0 4px 10px rgba(0,0,0,.8))">
          ${ICON.get('pinLleno', 46)}
        </div>
        <div style="padding:14px 18px calc(16px + env(safe-area-inset-bottom));background:var(--surf);
                    border-top:1px solid var(--line);display:flex;gap:11px">
          <button class="btn btn-fantasma" id="pickerCancel" style="flex:1;margin:0">Cancelar</button>
          <button class="btn btn-oro" id="pickerOk" style="flex:2;margin:0">${ICON.get('check', 18)} Es aquí</button>
        </div>`;
      document.body.appendChild(c);
    }
    c.style.display = 'flex';

    if (!c._map) {
      c._map = L.map('pickerMap', { zoomControl: false }).setView([lat, lon], 18);
      capaMapa().addTo(c._map);
      L.control.zoom({ position: 'bottomleft' }).addTo(c._map);
    } else c._map.setView([lat, lon], 18);
    setTimeout(() => c._map.invalidateSize(), 90);

    $('#pickerCancel').onclick = () => { c.style.display = 'none'; };
    $('#pickerOk').onclick = () => {
      const p = c._map.getCenter();
      c.style.display = 'none';
      const st = $('#geoStatus');
      if (st) st.innerHTML = `<span class="gps-estado" style="color:var(--info)">${ICON.get('pinLleno', 15)} puesto a mano</span>`;
      onOk(p.lat, p.lng, 0, true);
    };
  }

  /* Teselas oscuras de verdad (CartoDB, gratis y sin clave) */
  function capaMapa() {
    return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd',
      attribution: '© OpenStreetMap © CARTO'
    });
  }

  /* ---------------- tour ---------------- */
  const PASOS = [
    { ico: 'jarra', tit: '¡Bienvenido a BirraMap!',
      txt: 'Para saber dónde está la peña, qué beben y cuántas llevan. Sin 40 mensajes de "¿dónde estáis?".' },
    { ico: 'grupo', tit: 'Todo gira en torno a tu grupo',
      txt: 'Te inventas un código, se lo pasas a tus colegas y listo. Solo os veis entre vosotros.' },
    { ico: 'pin', tit: 'Ficha cuando pidas algo',
      lista: [
        { ico: 'cana', t: 'Me tomo una', d: 'Bebida, cantidad y bar. Apareces en el mapa al instante.' },
        { ico: 'manos', t: 'Invito yo', d: 'La ronda se reparte entre los que estén cerca y queda anotada.' },
        { ico: 'estrella', t: 'Puntúa el sitio', d: 'De 0 a 5 estrellas, para saber qué bares merecen la pena.' }
      ] },
    { ico: 'mapa', tit: 'Qué hay en cada pestaña',
      lista: [
        { ico: 'mapa', t: 'Mapa', d: 'Quién está fuera ahora y dónde.' },
        { ico: 'trofeo', t: 'Ranking', d: 'Quién lleva más, por día, semana o mes.' },
        { ico: 'estrella', t: 'Bares', d: 'Los mejores y peores según vuestros votos.' },
        { ico: 'monedas', t: 'Deudas', d: 'Quién debe rondas a quién, ya compensado.' },
        { ico: 'persona', t: 'Perfil', d: 'Tus estadísticas y ajustes.' }
      ] },
    { ico: 'casa', tit: 'Y para acabar la noche',
      txt: 'Dale a "He llegado a casa" y el grupo se queda tranquilo. Sales del mapa pero tus estadísticas se conservan.',
      final: true }
  ];

  function tour({ alTerminar = null, forzar = false } = {}) {
    const KEY = 'birramap_tour_v4';
    if (!forzar && localStorage.getItem(KEY) === '1') { if (alTerminar) alTerminar(); return; }
    let i = 0;
    const d = document.createElement('div');
    d.className = 'tour';
    document.body.appendChild(d);
    const cerrar = () => { localStorage.setItem(KEY, '1'); d.remove(); if (alTerminar) alTerminar(); };
    const pintar = () => {
      const p = PASOS[i];
      d.innerHTML = `<div class="tour-card">
        <div class="tour-ico">${ICON.get(p.ico, 62)}</div>
        <h2>${esc(p.tit)}</h2>
        ${p.txt ? `<p>${esc(p.txt)}</p>` : ''}
        ${p.lista ? `<ul class="tour-lista">${p.lista.map(x => `<li>
            <span class="li-ico">${ICON.get(x.ico, 20)}</span>
            <div><b>${esc(x.t)}</b><span>${esc(x.d)}</span></div></li>`).join('')}</ul>` : ''}
        <div class="tour-puntos">${PASOS.map((_, n) => `<div class="tour-punto ${n === i ? 'on' : ''}"></div>`).join('')}</div>
        <button class="btn btn-oro" id="tourNext">${p.final ? 'Vamos allá' : 'Siguiente'}</button>
        ${!p.final ? `<button class="btn btn-fantasma btn-sm" id="tourSkip" style="width:100%;margin-top:8px">Saltar</button>` : ''}
      </div>`;
      $('#tourNext').onclick = () => { i < PASOS.length - 1 ? (i++, pintar()) : cerrar(); };
      const sk = $('#tourSkip'); if (sk) sk.onclick = cerrar;
    };
    pintar();
  }

  /* ---------------- ayuda ---------------- */
  const AYUDA = [
    { ico: 'rayo', tit: '¿Cómo empiezo?', html: `<ol>
        <li>Entra con tu cuenta de <b>GitHub</b> o <b>Microsoft</b>.</li>
        <li>Ponte un <b>mote</b>, el que verá tu grupo.</li>
        <li>Escribe un <b>código de grupo</b>. Invéntatelo: <i>lospavos2026</i>, <i>ladelviernes</i>…</li>
        <li>Pásaselo a tus colegas. Quien lo tenga entra en vuestro mapa.</li></ol>
        <p>Puedes cambiar de grupo cuando quieras en <b>Perfil → Ajustes</b>.</p>` },
    { ico: 'cana', tit: 'Fichar una consumición', html: `<p>Botón dorado <b>Me tomo una</b>, abajo a la derecha.</p><ol>
        <li>Elige qué bebes entre las 12 opciones.</li>
        <li>Espera al GPS: verás la precisión real en pantalla.</li>
        <li>El nombre del bar suele salir solo; si no, escríbelo.</li>
        <li>Indica cuántas y, si quieres, el precio.</li></ol>
        <p><b>Truco:</b> si el GPS anda flojo, dale a <b>Ajustar a mano</b> y coloca el punto con el dedo.</p>` },
    { ico: 'manos', tit: 'Rondas e invitaciones', html: `<p>Botón azul <b>Invito yo</b>.</p>
        <p>Busca quién de tu grupo está <b>a menos de 500 m</b> y te los marca ya seleccionados. Quitas a quien no proceda y confirmas.</p>
        <ul><li>A cada uno se le suma una consumición.</li>
        <li>El gasto entero se te carga a ti.</li>
        <li>Queda anotado que te deben una ronda.</li></ul>` },
    { ico: 'estrella', tit: 'Puntuar los bares', html: `<p>De <b>0 a 5 estrellas</b>. Puedes puntuar desde:</p>
        <ul><li>Justo después de fichar, te lo ofrece.</li>
        <li>La pestaña <b>Bares</b>, tocando cualquier sitio.</li>
        <li>El botón morado del mapa.</li></ul>
        <p>Cada uno tiene <b>un voto por bar</b>: si revotas, se sustituye. Puedes dejar un comentario corto.</p>
        <p>El ranking usa media ponderada, así que un bar con un solo voto de 5 no adelanta a otro con veinte de 4,8.</p>` },
    { ico: 'monedas', tit: 'Deudas y quién invita', html: `<p>En <b>Deudas</b> se ve quién debe cuántas rondas a quién, <b>ya compensado</b>: si tú le pusiste 3 y él a ti 1, debes 1.</p>
        <p>También el <b>balance de generosidad</b>: a cuánta gente has invitado frente a cuánta te ha invitado.</p>
        <p>Si has puesto precios, verás además la diferencia en euros.</p>` },
    { ico: 'trofeo', tit: 'Ranking y eventos', html: `<p>Clasificación por <b>día, semana, mes o año</b>.</p>
        <p>Los <b>eventos</b> sirven para ferias o despedidas: creas uno con fechas y tienes un ranking cerrado de esos días.</p>` },
    { ico: 'fuego', tit: 'Mapa de calor', html: `<p>Los sitios donde más habéis parado en el último año.</p>
        <p>Puedes ver el del <b>grupo</b> o <b>solo el tuyo</b>, con el ranking de bares y su precio medio.</p>` },
    { ico: 'satelite', tit: 'Problemas con el GPS', html: `<p>Dentro de un bar el GPS sufre. La app espera unos segundos a que afine y te enseña la precisión real.</p>
        <p><b>En iPhone, si no va:</b></p><ol>
        <li>Ajustes → Privacidad y seguridad → Localización → <b>activada</b></li>
        <li>Busca <b>Safari</b> (o BirraMap si la instalaste) → <b>Al usar la app</b></li>
        <li>Activa <b>Ubicación precisa</b> ← esta se queda apagada muchísimas veces</li></ol>
        <p><b>En Android:</b> Ajustes → Ubicación → activada, y "Precisión de Google" encendida.</p>
        <p>Pase lo que pase, siempre puedes <b>colocar el punto a mano</b>.</p>` },
    { ico: 'campana', tit: 'Avisos de cercanía', html: `<p>Se activan en <b>Perfil → Avisos</b>. Te llega una notificación cuando alguien ficha <b>a menos de 500 m de ti</b>.</p>
        <p>Solo saltan si tu ubicación es fiable, para no darte falsas alarmas.</p>` },
    { ico: 'casa', tit: 'Terminar la noche', html: `<p>Dos opciones en <b>Perfil</b>:</p>
        <ul><li><b>He llegado a casa</b> — sales del mapa y al grupo le sale aviso de que llegaste bien.</li>
        <li><b>Cerrar la noche</b> — sales del mapa sin más.</li></ul>
        <p>En los dos casos <b>tus estadísticas se conservan</b>. Si vuelves a fichar, reapareces.</p>` },
    { ico: 'ajustes', tit: 'Privacidad', html: `<p>Tu ubicación solo la ve <b>quien tenga tu código de grupo</b>. No hay perfiles públicos ni buscador.</p>
        <p>Solo se guarda la posición cuando fichas, nunca en segundo plano.</p>
        <p>Los datos se borran solos pasados 180 días.</p>` }
  ];

  function pintarAyuda(sel) {
    const c = typeof sel === 'string' ? $(sel) : sel;
    if (!c) return;
    c.innerHTML = AYUDA.map(a => `<div class="ayuda-item">
      <div class="ayuda-cab"><div class="item-ico">${ICON.get(a.ico, 20)}</div>
        <b>${esc(a.tit)}</b><span class="ayuda-fle">${ICON.get('flecha', 16)}</span></div>
      <div class="ayuda-cuerpo"><div class="ayuda-txt">${a.html}</div></div></div>`).join('');
    c.querySelectorAll('.ayuda-item').forEach(it => {
      it.querySelector('.ayuda-cab').onclick = () => {
        const ab = it.classList.contains('abierto');
        c.querySelectorAll('.ayuda-item').forEach(x => x.classList.remove('abierto'));
        if (!ab) it.classList.add('abierto');
      };
    });
  }

  /* ---------------- utilidades ---------------- */
  function toast(msg, ms = 2900) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._x); t._x = setTimeout(() => t.classList.add('hidden'), ms);
  }
  const vacio = (ico, tit, txt) => `<div class="vacio"><div class="vacio-ico">${ICON.get(ico, 54)}</div>
    <b>${esc(tit)}</b><span>${esc(txt)}</span></div>`;
  const cargando = (txt = 'Cargando…') => `<div class="cargando">${ICON.get('jarra', 46)}<p>${esc(txt)}</p></div>`;

  return {
    esc, estrellas, pickerEstrellas, reparto, TEXTOS_NOTA,
    pedirUbicacionUI, selectorMapa, capaMapa,
    tour, PASOS, AYUDA, pintarAyuda, toast, vacio, cargando
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
