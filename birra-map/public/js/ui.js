/* ============================================================
   BirraMap · componentes de interfaz
   Estrellas, tour de bienvenida, ayuda y ubicación a prueba de iPhone.
   ============================================================ */

const UI = (() => {

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- estrellas ---------------- */

  /** Estrellas de solo lectura */
  function estrellas(valor, clase = '') {
    const v = Math.max(0, Math.min(5, Number(valor) || 0));
    let h = `<span class="estrellas ${clase}">`;
    for (let i = 1; i <= 5; i++) h += `<i class="${i <= Math.round(v) ? 'on' : ''}">★</i>`;
    return h + '</span>';
  }

  const TEXTOS_NOTA = {
    0: '☠️ Ni de broma',
    1: '😬 Flojito',
    2: '😐 Regulero',
    3: '👍 Cumple',
    4: '😍 Muy bueno',
    5: '🏆 Un templo'
  };

  /**
   * Selector de estrellas táctil.
   * onCambio(valor) se llama en cada toque.
   */
  function pickerEstrellas(contenedor, { valor = 0, onCambio = null } = {}) {
    const cont = typeof contenedor === 'string' ? $(contenedor) : contenedor;
    if (!cont) return { valor: () => 0 };
    let actual = valor;

    const pintar = () => {
      cont.innerHTML = `
        <div class="picker-estrellas">
          ${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" class="${i <= actual ? 'on' : ''}"
             aria-label="${i} estrella${i > 1 ? 's' : ''}">★</button>`).join('')}
        </div>
        <div class="nota-txt">${actual > 0 ? TEXTOS_NOTA[Math.round(actual)] : 'Toca para puntuar'}</div>`;
      cont.querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          const v = Number(b.dataset.v);
          /* volver a tocar la misma estrella la quita: así puedes poner 0 */
          actual = (actual === v) ? v - 1 : v;
          pintar();
          if (onCambio) onCambio(actual);
        };
      });
    };
    pintar();
    return { valor: () => actual, set: v => { actual = v; pintar(); } };
  }

  /** Barras del reparto de votos */
  function reparto(arr, total) {
    if (!total) return '';
    let h = '<div class="reparto">';
    for (let i = 5; i >= 1; i--) {
      const n = arr[i] || 0;
      const pct = Math.round((n / total) * 100);
      h += `<div class="reparto-fila"><b>${i} ★</b>
        <div class="reparto-barra"><i style="width:${pct}%"></i></div><span>${n}</span></div>`;
    }
    return h + '</div>';
  }

  /* ---------------- ubicación a prueba de iPhone ---------------- */

  /**
   * ⚠️ CLAVE: llama a esto DIRECTAMENTE dentro del onclick, sin await antes.
   * Si pones un await por delante, Safari en iOS pierde el gesto del usuario
   * y no responde nunca. Por eso esta función no es async.
   *
   * onOk(lat, lon, precision, manual)
   */
  function pedirUbicacionUI({ onOk, onFallo = null, statusSel = '#geoStatus' } = {}) {
    const st = $(statusSel);
    const pinta = (html) => { if (st) st.innerHTML = html; };

    pinta(`<span class="spin" style="display:inline-block;vertical-align:-4px"></span> buscando GPS…`);

    /* ← primera línea ejecutable: la petición al GPS. Nada antes. */
    const peticion = GEO.pedirUbicacion({
      onProgreso: (p, c) => {
        const pct = Math.max(6, Math.min(100, Math.round(100 - (Math.log10(Math.max(p.accuracy, 5)) / Math.log10(5000)) * 100)));
        pinta(`<span style="color:${c.color}">${c.em} ${c.txt}</span>
          <div class="gps-barra"><i style="width:${pct}%;background:${c.color}"></i></div>`);
      },
      onAviso: txt => pinta(`<span class="spin" style="display:inline-block;vertical-align:-4px"></span> ${esc(txt)}`)
    });

    peticion.promesa.then(pos => {
      const c = pos.calidad;
      pinta(`<span style="color:${c.color}">${c.em} ${c.txt}</span>` +
        (pos.accuracy > 55 ? ` · <a href="#" data-accion="ajustar" style="color:var(--oro);font-weight:600">ajustar 📍</a>` : ''));
      engancharAjuste(st, pos.lat, pos.lon, onOk);
      onOk(pos.lat, pos.lon, pos.accuracy, false);
    }).catch(e => {
      const ex = e.explicado || { titulo: 'Sin ubicación', texto: '', pasos: [] };
      pinta(`<span style="color:var(--mal)">⚠️ ${esc(ex.titulo)}</span> · <a href="#" data-accion="ajustar" style="color:var(--oro);font-weight:600">poner a mano 📍</a>`);
      const centro = (typeof map !== 'undefined' && map) ? map.getCenter() : { lat: 40.4168, lng: -3.7038 };
      engancharAjuste(st, centro.lat, centro.lng, onOk);
      if (onFallo) onFallo(ex);
    });

    return peticion;
  }

  function engancharAjuste(st, lat, lon, onOk) {
    if (!st) return;
    const a = st.querySelector('[data-accion="ajustar"]');
    if (a) a.onclick = ev => { ev.preventDefault(); selectorMapa(lat, lon, onOk); };
  }

  /* ---------------- selector manual en el mapa ---------------- */
  function selectorMapa(lat, lon, onOk) {
    let c = $('#pickerModal');
    if (!c) {
      c = document.createElement('div');
      c.id = 'pickerModal';
      c.style.cssText = 'position:fixed;inset:0;z-index:1300;background:var(--bg);display:flex;flex-direction:column';
      c.innerHTML = `
        <div style="padding:calc(14px + env(safe-area-inset-top)) 18px 12px;background:var(--surface);border-bottom:1px solid var(--line)">
          <h3 style="margin:0">📍 Coloca el punto</h3>
          <p class="mini" style="margin:4px 0 0">Mueve el mapa hasta tu bar. El pin del centro es donde fichas.</p>
        </div>
        <div id="pickerMap" style="flex:1;position:relative"></div>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-100%);z-index:500;
                    font-size:2.8rem;pointer-events:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.7))">📍</div>
        <div style="padding:14px 18px calc(16px + env(safe-area-inset-bottom));background:var(--surface);
                    border-top:1px solid var(--line);display:flex;gap:11px">
          <button class="btn btn-fantasma" id="pickerCancel" style="flex:1;margin:0">Cancelar</button>
          <button class="btn btn-oro" id="pickerOk" style="flex:2;margin:0">Es aquí ✓</button>
        </div>`;
      document.body.appendChild(c);
    }
    c.style.display = 'flex';

    if (!c._map) {
      c._map = L.map('pickerMap', { zoomControl: false }).setView([lat, lon], 18);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(c._map);
      L.control.zoom({ position: 'bottomleft' }).addTo(c._map);
    } else c._map.setView([lat, lon], 18);
    setTimeout(() => c._map.invalidateSize(), 90);

    $('#pickerCancel').onclick = () => { c.style.display = 'none'; };
    $('#pickerOk').onclick = () => {
      const p = c._map.getCenter();
      c.style.display = 'none';
      const st = $('#geoStatus');
      if (st) st.innerHTML = `<span style="color:var(--info)">📍 puesto a mano</span>`;
      onOk(p.lat, p.lng, 0, true);
    };
  }

  /* ---------------- tour de bienvenida ---------------- */
  const PASOS = [
    {
      em: '🍺', tit: '¡Bienvenido a BirraMap!',
      txt: 'La app para saber dónde está la peña, qué están bebiendo y cuántas llevan. Sin grupos de WhatsApp con 40 mensajes de "¿dónde estáis?".'
    },
    {
      em: '👥', tit: 'Todo gira en torno a tu grupo',
      txt: 'Te inventas un código, se lo pasas a tus colegas y listo. Solo os veis entre vosotros: nadie más existe en tu mapa.'
    },
    {
      em: '📍', tit: 'Ficha cuando pidas algo',
      lista: [
        { em: '🍺', t: 'Me tomo una', d: 'Eliges bebida, cantidad y el bar. Apareces en el mapa al instante.' },
        { em: '🤝', t: 'Invito yo', d: 'Pagas una ronda: se reparte entre los que estén cerca y queda anotado quién te debe.' },
        { em: '⭐', t: 'Puntúa el sitio', d: 'De 0 a 5 estrellas. Así el grupo sabe cuáles merecen la pena.' }
      ]
    },
    {
      em: '🗺️', tit: 'Qué hay en cada pestaña',
      lista: [
        { em: '🗺️', t: 'Mapa', d: 'Quién está fuera ahora y dónde.' },
        { em: '🏆', t: 'Ranking', d: 'Quién lleva más, por día, semana, mes o evento.' },
        { em: '⭐', t: 'Bares', d: 'Los mejores y peores sitios según vuestros votos.' },
        { em: '💸', t: 'Deudas', d: 'Quién debe rondas a quién, ya compensado.' },
        { em: '👤', t: 'Perfil', d: 'Tus estadísticas y ajustes.' }
      ]
    },
    {
      em: '🏠', tit: 'Y para acabar la noche',
      txt: 'Dale a "He llegado a casa" y el grupo se queda tranquilo. Tus estadísticas se conservan, pero sales del mapa.',
      final: true
    }
  ];

  function tour({ alTerminar = null, forzar = false } = {}) {
    const YA = 'birramap_tour_v1';
    if (!forzar && localStorage.getItem(YA) === '1') { if (alTerminar) alTerminar(); return; }

    let i = 0;
    const d = document.createElement('div');
    d.className = 'tour';
    document.body.appendChild(d);

    const cerrar = () => {
      localStorage.setItem(YA, '1');
      d.remove();
      if (alTerminar) alTerminar();
    };

    const pintar = () => {
      const p = PASOS[i];
      d.innerHTML = `
        <div class="tour-card">
          <span class="tour-em">${p.em}</span>
          <h2>${esc(p.tit)}</h2>
          ${p.txt ? `<p>${esc(p.txt)}</p>` : ''}
          ${p.lista ? `<ul class="tour-lista" style="list-style:none;padding:0">
            ${p.lista.map(x => `<li><span class="li-em">${x.em}</span>
              <div><b>${esc(x.t)}</b><span>${esc(x.d)}</span></div></li>`).join('')}
          </ul>` : ''}
          <div class="tour-puntos">
            ${PASOS.map((_, n) => `<div class="tour-punto ${n === i ? 'on' : ''}"></div>`).join('')}
          </div>
          <button class="btn btn-oro" id="tourNext">${p.final ? '¡Vamos allá! 🍻' : 'Siguiente'}</button>
          ${!p.final ? `<button class="btn btn-fantasma btn-sm" id="tourSkip" style="width:100%;margin-top:8px">Saltar</button>` : ''}
        </div>`;
      $('#tourNext').onclick = () => { if (i < PASOS.length - 1) { i++; pintar(); } else cerrar(); };
      const sk = $('#tourSkip');
      if (sk) sk.onclick = cerrar;
    };
    pintar();
  }

  /* ---------------- contenido de la ayuda ---------------- */
  const AYUDA = [
    {
      em: '🚀', tit: '¿Cómo empiezo?',
      html: `<ol>
        <li>Entra con tu cuenta de <b>GitHub</b> o <b>Microsoft</b>.</li>
        <li>Ponte un <b>mote</b> (el que quieras, lo verá tu grupo).</li>
        <li>Escribe un <b>código de grupo</b>. Invéntatelo: <i>lospavos2026</i>, <i>ladelviernes</i>…</li>
        <li>Pásaselo a tus colegas por WhatsApp. Quien tenga ese código entra en vuestro mapa.</li>
      </ol>
      <p>Si te equivocas de grupo, puedes cambiarlo en <b>Perfil → Ajustes</b> cuando quieras.</p>`
    },
    {
      em: '🍺', tit: 'Fichar una consumición',
      html: `<p>El botón dorado <b>"Me tomo una"</b> abajo a la derecha.</p>
      <ol>
        <li>Elige qué estás bebiendo entre las 12 opciones.</li>
        <li>Espera al GPS (verás la precisión en pantalla).</li>
        <li>El nombre del bar suele salir solo; si no, escríbelo.</li>
        <li>Indica cuántas llevas en esta ronda y, si quieres, el precio.</li>
        <li>Puedes dejar un mensajito tipo "vente que hay sitio".</li>
      </ol>
      <p><b>Truco:</b> si el GPS anda flojo, toca <b>"ajustar 📍"</b> y coloca el punto con el dedo.</p>`
    },
    {
      em: '🤝', tit: 'Rondas e invitaciones',
      html: `<p>El botón azul <b>"Invito yo"</b>.</p>
      <p>La app busca quién de tu grupo está <b>a menos de 500 m</b> y te los marca ya seleccionados. Quitas a quien no proceda, pones el precio de la consumición y confirmas.</p>
      <p>Qué pasa entonces:</p>
      <ul>
        <li>A cada uno se le suma una consumición.</li>
        <li>El gasto entero se te carga a ti.</li>
        <li>Queda anotado que te deben una ronda.</li>
      </ul>`
    },
    {
      em: '⭐', tit: 'Puntuar los bares',
      html: `<p>De <b>0 a 5 estrellas</b>. Puedes puntuar desde:</p>
      <ul>
        <li>La pantalla de fichar, justo después de indicar el bar.</li>
        <li>La pestaña <b>Bares</b>, tocando cualquier sitio.</li>
        <li>El botón morado <b>"Puntuar"</b> del mapa.</li>
      </ul>
      <p>Cada uno tiene <b>un voto por bar</b>: si vuelves a votar, se sustituye el anterior. Puedes añadir un comentario corto.</p>
      <p>El ranking usa media ponderada, así que un bar con un solo voto de 5 estrellas no adelanta a uno con veinte votos de 4,8.</p>`
    },
    {
      em: '💸', tit: 'Deudas y quién invita',
      html: `<p>En la pestaña <b>Deudas</b> se ve quién debe cuántas rondas a quién, <b>ya compensado</b>: si tú le pusiste 3 y él a ti 1, debes 1 y punto.</p>
      <p>También está el <b>balance de generosidad</b>: a cuánta gente has invitado frente a cuánta te ha invitado. El del 🏅 paga siempre; el del 🐀 ya sabes.</p>
      <p>Si has puesto precios, verás además la diferencia en euros. Útil cuando uno invita cañas y otro gin-tonics.</p>`
    },
    {
      em: '🏆', tit: 'Ranking y eventos',
      html: `<p>Clasificación del grupo por <b>día, semana, mes o año</b>.</p>
      <p>Los <b>eventos</b> sirven para ferias, Oktoberfest o una despedida: creas uno con fecha de inicio y fin, y tienes un ranking cerrado solo de esos días. Mientras está en curso aparece una chapa arriba.</p>`
    },
    {
      em: '🔥', tit: 'Mapa de calor',
      html: `<p>Los sitios donde más habéis parado en el último año, en degradado de azul a rojo.</p>
      <p>Puedes ver el del <b>grupo entero</b> o <b>solo el tuyo</b>. Debajo, el ranking de bares con visitas, consumiciones, cuánta gente distinta ha pasado y el precio medio.</p>`
    },
    {
      em: '📍', tit: 'Problemas con el GPS',
      html: `<p>Dentro de un bar el GPS sufre: paredes, sótanos, gente. La app espera unos segundos a que afine y te enseña la precisión real.</p>
      <p><b>Si en iPhone no va:</b></p>
      <ol>
        <li>Ajustes → Privacidad y seguridad → Localización → <b>activada</b></li>
        <li>Busca <b>Safari</b> (o BirraMap si la instalaste) → <b>"Al usar la app"</b></li>
        <li>Activa <b>"Ubicación precisa"</b> ← esta se queda apagada muchísimas veces</li>
      </ol>
      <p><b>En Android:</b> Ajustes → Ubicación → activada, y "Precisión de Google" encendida.</p>
      <p>Pase lo que pase, siempre puedes <b>colocar el punto a mano</b>. Toca "ajustar 📍" y mueve el mapa.</p>`
    },
    {
      em: '🔔', tit: 'Avisos de cercanía',
      html: `<p>Actívalos en <b>Perfil → Avisos</b>. Te llega una notificación cuando alguien de tu grupo ficha <b>a menos de 500 m de ti</b>.</p>
      <p>Solo saltan si tu propia ubicación es fiable, para no darte falsas alarmas.</p>`
    },
    {
      em: '🏠', tit: 'Terminar la noche',
      html: `<p>Dos opciones en <b>Perfil</b>:</p>
      <ul>
        <li><b>He llegado a casa 🏠</b> — sales del mapa y al grupo le sale un aviso verde de que llegaste bien.</li>
        <li><b>Cerrar la noche 🚕</b> — sales del mapa sin más.</li>
      </ul>
      <p>En los dos casos <b>tus estadísticas se conservan</b>. Si vuelves a fichar, reapareces.</p>`
    },
    {
      em: '🔒', tit: 'Privacidad',
      html: `<p>Tu ubicación solo la ve <b>la gente que tenga tu código de grupo</b>. No hay perfiles públicos ni buscador de usuarios.</p>
      <p>Solo se guarda la posición cuando fichas, nunca en segundo plano. Y en cuanto le das a "he llegado a casa", desapareces.</p>
      <p>Los datos se borran solos pasados 180 días.</p>`
    }
  ];

  function pintarAyuda(sel) {
    const c = typeof sel === 'string' ? $(sel) : sel;
    if (!c) return;
    c.innerHTML = AYUDA.map((a, i) => `
      <div class="ayuda-item" data-i="${i}">
        <div class="ayuda-cab">
          <div class="item-em">${a.em}</div>
          <b>${esc(a.tit)}</b>
          <span class="ayuda-fle">›</span>
        </div>
        <div class="ayuda-cuerpo"><div class="ayuda-txt">${a.html}</div></div>
      </div>`).join('');
    c.querySelectorAll('.ayuda-item').forEach(it => {
      it.querySelector('.ayuda-cab').onclick = () => {
        const abierto = it.classList.contains('abierto');
        c.querySelectorAll('.ayuda-item').forEach(x => x.classList.remove('abierto'));
        if (!abierto) it.classList.add('abierto');
      };
    });
  }

  /* ---------------- utilidades ---------------- */
  function toast(msg, ms = 2800) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._x);
    t._x = setTimeout(() => t.classList.add('hidden'), ms);
  }

  const vacio = (em, tit, txt) => `<div class="vacio"><span class="vacio-em">${em}</span><b>${esc(tit)}</b><span>${esc(txt)}</span></div>`;
  const cargando = (txt = 'Cargando…') => `<div class="cargando"><div class="jarra">🍺</div><p>${esc(txt)}</p></div>`;

  return {
    esc, estrellas, pickerEstrellas, reparto, TEXTOS_NOTA,
    pedirUbicacionUI, selectorMapa,
    tour, AYUDA, pintarAyuda, PASOS,
    toast, vacio, cargando
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
