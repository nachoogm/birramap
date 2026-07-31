/* ============================================================
   BirraMap · iconos SVG
   Nada de emojis: cada icono está dibujado, se ve igual en
   iPhone, Android y escritorio, y hereda el color del texto.
   ============================================================ */

const ICON = (() => {

  /* Trazo limpio, 24x24, currentColor */
  const S = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  /* Relleno sólido para los que quedan mejor macizos */
  const F = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="currentColor" ${extra}>${d}</svg>`;

  const P = {
    /* ---- bebidas ---- */
    cana: S(`<path d="M6 8h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8Z"/>
             <path d="M15 11h2.5a2.5 2.5 0 0 1 0 5H15"/>
             <path d="M6 8c0-1.7 1.3-3 3-3 .4-1.2 1.5-2 2.8-2 1.5 0 2.7 1 3 2.4 1.2.2 2.2 1.3 2.2 2.6H6Z"/>
             <path d="M9 12v5M12 12v5"/>`),
    tercio: S(`<path d="M7 3h10l-1 17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2L7 3Z"/>
               <path d="M7.3 9h9.4"/><path d="M10 13v4M14 13v4"/>`),
    ipa: S(`<path d="M6 8h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8Z"/>
            <path d="M15 11h2.5a2.5 2.5 0 0 1 0 5H15"/>
            <path d="M6 8c0-1.7 1.3-3 3-3 .4-1.2 1.5-2 2.8-2 1.5 0 2.7 1 3 2.4 1.2.2 2.2 1.3 2.2 2.6H6Z"/>
            <path d="M9.5 12c1.5 1.5 1.5 4 0 5.5M12.5 12c1.5 1.5 1.5 4 0 5.5"/>`),
    trigo: S(`<path d="M12 21V9"/>
              <path d="M12 9c0-2 1.5-3.5 3.5-3.5C15.5 7.5 14 9 12 9Z"/>
              <path d="M12 9c0-2-1.5-3.5-3.5-3.5C8.5 7.5 10 9 12 9Z"/>
              <path d="M12 13c0-2 1.5-3.5 3.5-3.5C15.5 11.5 14 13 12 13Z"/>
              <path d="M12 13c0-2-1.5-3.5-3.5-3.5C8.5 11.5 10 13 12 13Z"/>
              <path d="M12 17c0-2 1.5-3.5 3.5-3.5C15.5 15.5 14 17 12 17Z"/>
              <path d="M12 17c0-2-1.5-3.5-3.5-3.5C8.5 15.5 10 17 12 17Z"/>`),
    tostada: S(`<path d="M7 4h10l-1 16a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2L7 4Z"/>
                <path d="M7.4 10h9.2"/><path d="M7.7 15h8.6"/>`),
    sin: S(`<path d="M6 8h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8Z"/>
            <path d="M15 11h2.5a2.5 2.5 0 0 1 0 5H15"/>
            <path d="M4 4l16 16"/>`),
    vino: S(`<path d="M8 3h8l-.6 6a3.4 3.4 0 0 1-6.8 0L8 3Z"/>
             <path d="M12 12.5V19"/><path d="M8.5 21h7"/>`),
    tinto: S(`<path d="M5 6h14l-6 7v6"/><path d="M9 21h8"/>
              <path d="M8.5 9.5h7"/><circle cx="17" cy="5" r="2"/>`),
    copa: S(`<path d="M6 5h12v5a6 6 0 0 1-12 0V5Z"/>
             <path d="M6 9h12"/><path d="M9 20h6"/><path d="M12 16v4"/>`),
    gintonic: S(`<path d="M4 4h16l-8 9v6"/><path d="M8 21h8"/>
                 <path d="M15 8l3-4"/><circle cx="18.5" cy="3.5" r="1.4"/>`),
    sidra: S(`<path d="M12 7c-3 0-5 2.4-5 6.5S9 22 12 22s5-4.4 5-8.5S15 7 12 7Z"/>
              <path d="M12 7V4"/><path d="M12 4c1.6 0 3-1 3-2-1.6 0-3 .9-3 2Z"/>`),
    refresco: S(`<path d="M6 6h12l-1.2 13.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 6Z"/>
                 <path d="M6.4 11h11.2"/><path d="M14 3l-1 3"/>`),

    /* ---- navegación ---- */
    mapa: S(`<path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z"/>
             <path d="M9 4v13M15 7v13"/>`),
    trofeo: S(`<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/>
               <path d="M7 6H4.5A2.5 2.5 0 0 0 7 10M17 6h2.5A2.5 2.5 0 0 1 17 10"/>
               <path d="M12 14v4"/><path d="M8.5 21h7l-.7-3h-5.6l-.7 3Z"/>`),
    estrella: S(`<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8L12 3Z"/>`),
    estrellaLlena: F(`<path d="m12 2.5 2.8 6 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.7 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z"/>`),
    monedas: S(`<ellipse cx="9" cy="6.5" rx="6" ry="2.8"/>
                <path d="M3 6.5v4c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8v-4"/>
                <path d="M15 12.5c3.1.2 6 1.4 6 2.8v4c0 1.5-2.7 2.8-6 2.8s-6-1.3-6-2.8v-2"/>
                <ellipse cx="15" cy="15.3" rx="6" ry="2.8"/>`),
    persona: S(`<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>`),
    fuego: S(`<path d="M12 22c3.9 0 7-3 7-6.8 0-4.7-4-6.6-4-10.2 0 0-2.2 1-3 4-1-1-1.3-2.5-1.3-4C8.4 6.6 5 9 5 15.2 5 19 8.1 22 12 22Z"/>
              <path d="M12 22c1.7 0 3-1.4 3-3.1 0-2.1-2-2.9-2-4.9-1.3.8-2 2-2 3.4 0 .7.2 1.2.5 1.7-.9-.2-1.5-1-1.5-2C9 18.7 10.3 22 12 22Z"/>`),

    /* ---- acciones ---- */
    pin: S(`<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>`),
    pinLleno: F(`<path d="M12 22s7.5-6 7.5-11.5a7.5 7.5 0 0 0-15 0C4.5 16 12 22 12 22Zm0-8.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>`),
    mas: S(`<path d="M12 5v14M5 12h14"/>`),
    menos: S(`<path d="M5 12h14"/>`),
    manos: S(`<path d="M7 11 4.5 8.5a2 2 0 0 1 2.8-2.8L11 9.4"/>
              <path d="m17 11 2.5-2.5a2 2 0 0 0-2.8-2.8L13 9.4"/>
              <path d="M12 9.5 8.5 13a2.5 2.5 0 0 0 0 3.5l2 2a2.5 2.5 0 0 0 3.5 0l3.5-3.5"/>
              <path d="M9.5 14.5 12 17"/>`),
    casa: S(`<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.6"/>
             <path d="M9.5 21v-6h5v6"/>`),
    taxi: S(`<path d="M4 16.5V12l1.8-4.2A2 2 0 0 1 7.6 6.5h8.8a2 2 0 0 1 1.8 1.3L20 12v4.5"/>
             <path d="M3 16.5h18v2.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-.8H6.5v.8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5Z"/>
             <path d="M4.5 12h15"/><path d="M9.5 3.5h5v3h-5z"/>`),
    campana: S(`<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z"/>
                <path d="M13.7 20a2 2 0 0 1-3.4 0"/>`),
    reloj: S(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>`),
    grupo: S(`<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5"/>
              <path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.4"/><path d="M18 14.8c2.2.6 3.5 2.3 3.5 4.4"/>`),
    calendario: S(`<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/>
                   <path d="M8 3v4M16 3v4"/>`),
    ajustes: S(`<circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>`),
    ayuda: S(`<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.9-2.8 2.9"/>
              <path d="M12 17.5h.01"/>`),
    cerrar: S(`<path d="M6 6l12 12M18 6L6 18"/>`),
    flecha: S(`<path d="M9 6l6 6-6 6"/>`),
    check: S(`<path d="M4 12.5 9 17.5 20 6.5"/>`),
    aviso: S(`<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9.5v4.5"/><path d="M12 17.5h.01"/>`),
    satelite: S(`<path d="M12 12 6.5 6.5"/><path d="M9.2 3.8 3.8 9.2l3.4 3.4 5.4-5.4-3.4-3.4Z"/>
                 <path d="M16.5 11.1 11.1 16.5l3.4 3.4 5.4-5.4-3.4-3.4Z"/>
                 <path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.5 6.5a7.5 7.5 0 0 1 0 11"/>`),
    mover: S(`<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>`),
    rayo: S(`<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>`),
    corona: S(`<path d="M3 8l3.5 3L12 5l5.5 6L21 8l-1.8 10.5a1 1 0 0 1-1 .8H5.8a1 1 0 0 1-1-.8L3 8Z"/>`),
    salir: S(`<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>`),
    github: F(`<path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.2-4.6-5.1 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.2 9.2 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.8-4.6 5.1.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.3 10.3 0 0 0 22 12.3C22 6.6 17.5 2 12 2Z"/>`),
    microsoft: `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="9.2" height="9.2" fill="#f25022"/><rect x="12.8" y="2" width="9.2" height="9.2" fill="#7fba00"/><rect x="2" y="12.8" width="9.2" height="9.2" fill="#00a4ef"/><rect x="12.8" y="12.8" width="9.2" height="9.2" fill="#ffb900"/></svg>`,
    sol: S(`<circle cx="12" cy="12" r="4.2"/>
            <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>`),
    luna: S(`<path d="M20.5 14.5A8.6 8.6 0 0 1 9.5 3.5a8.6 8.6 0 1 0 11 11Z"/>`),
    automatico: S(`<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>
                   <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" opacity=".85"/>`),
    jarra: F(`<path d="M6 7h9v12a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 6 19V7Z" opacity=".9"/>
              <path d="M15 10h2.2a3 3 0 0 1 0 6H15v-2h2.2a1 1 0 0 0 0-2H15v-2Z"/>
              <path d="M5.6 7c-.2-1.9 1.2-3.4 3-3.4.5-1.3 1.8-2.1 3.2-2.1 1.7 0 3.1 1.1 3.4 2.7 1.3.3 2.3 1.4 2.3 2.8H5.6Z" opacity=".55"/>`)
  };

  /** Devuelve el SVG. tam en píxeles, clase opcional. */
  function get(nombre, tam = 24, clase = '') {
    const svg = P[nombre];
    if (!svg) return '';
    return svg.replace('<svg ', `<svg width="${tam}" height="${tam}" class="ico ${clase}" `);
  }

  /** Sustituye todos los [data-ico] del documento */
  function pintar(raiz = document) {
    raiz.querySelectorAll('[data-ico]').forEach(el => {
      const t = Number(el.dataset.tam || 24);
      el.innerHTML = get(el.dataset.ico, t);
      el.removeAttribute('data-ico');
    });
  }

  return { get, pintar, nombres: Object.keys(P) };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ICON;
