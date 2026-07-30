<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>BirraMap 🍺 — ¿dónde está la peña?</title>
<meta name="theme-color" content="#0b1b3a" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="/styles.css" />
</head>
<body>

<!-- ===== LOGIN ===== -->
<section id="login" class="screen hidden">
  <div class="login-card">
    <img src="/icons/icon-192.png" alt="BirraMap" class="logo" />
    <h1>BirraMap</h1>
    <p class="tag">Mira dónde está la peña y cuántas llevan.</p>
    <a class="btn btn-gh" href="/.auth/login/github?post_login_redirect_uri=/">Entrar con GitHub</a>
    <a class="btn btn-aad" href="/.auth/login/aad?post_login_redirect_uri=/">Entrar con Microsoft</a>
    <p class="mini">Solo verás a la gente de tu grupo. Nadie más te ve.</p>
  </div>
</section>

<!-- ===== ONBOARDING GRUPO ===== -->
<section id="onboarding" class="screen hidden">
  <div class="login-card">
    <h2>Tu grupo</h2>
    <label>Tu mote</label>
    <input id="ob-nick" maxlength="20" placeholder="Nacho" />
    <label>Código de grupo</label>
    <input id="ob-group" maxlength="24" placeholder="lospavos2026" />
    <button id="ob-save" class="btn btn-primary">Entrar al grupo</button>
    <p class="mini">Inventa un código y pásaselo a tus colegas. Quien lo tenga, entra.</p>
  </div>
</section>

<!-- ===== APP ===== -->
<section id="app" class="screen hidden">
  <header class="topbar">
    <div class="brand"><img src="/icons/icon-192.png" alt="" /><span>BirraMap</span></div>
    <div class="topright">
      <span id="groupChip" class="chip"></span>
      <button id="btnMenu" class="icon-btn" title="Menú">☰</button>
    </div>
  </header>

  <div id="map"></div>

  <!-- panel inferior -->
  <div id="sheet" class="sheet">
    <div class="sheet-handle" id="sheetHandle"></div>
    <div class="tabs">
      <button class="tab active" data-tab="live">🔴 En directo</button>
      <button class="tab" data-tab="rank">🏆 Ranking</button>
      <button class="tab" data-tab="mine">📊 Lo mío</button>
    </div>

    <div class="tab-body" id="tab-live"></div>
    <div class="tab-body hidden" id="tab-rank">
      <div class="seg">
        <button class="seg-btn active" data-period="day">Hoy</button>
        <button class="seg-btn" data-period="week">Semana</button>
        <button class="seg-btn" data-period="month">Mes</button>
      </div>
      <div id="rankList"></div>
    </div>
    <div class="tab-body hidden" id="tab-mine"></div>
  </div>

  <button id="fab" class="fab">🍺<span>Me tomo una</span></button>
</section>

<!-- ===== MODAL CHECK-IN ===== -->
<div id="modal" class="modal hidden">
  <div class="modal-card">
    <h3>¿Qué te estás metiendo?</h3>
    <div id="drinks" class="drinks"></div>

    <label>Local <span class="mini" id="geoStatus">buscando GPS…</span></label>
    <input id="placeName" placeholder="Bar Manolo" />

    <label>Cuántas <span class="mini">(en esta ronda)</span></label>
    <div class="qty">
      <button class="qty-btn" data-d="-1">−</button>
      <span id="qtyVal">1</span>
      <button class="qty-btn" data-d="1">+</button>
    </div>

    <label>Mensaje <span class="mini">opcional</span></label>
    <input id="note" maxlength="80" placeholder="Vente que hay sitio" />

    <div class="modal-actions">
      <button id="cancelCheckin" class="btn btn-ghost">Cancelar</button>
      <button id="saveCheckin" class="btn btn-primary">¡Fichar! 🍻</button>
    </div>
  </div>
</div>

<!-- ===== MENÚ ===== -->
<div id="menu" class="modal hidden">
  <div class="modal-card">
    <h3>Ajustes</h3>
    <label>Mote</label>
    <input id="mnu-nick" maxlength="20" />
    <label>Grupo</label>
    <input id="mnu-group" maxlength="24" />
    <button id="mnu-save" class="btn btn-primary">Guardar</button>
    <button id="mnu-close-session" class="btn btn-ghost">Cerrar sesión de esta noche 🚕</button>
    <a class="btn btn-ghost" href="/.auth/logout?post_logout_redirect_uri=/">Salir de la cuenta</a>
    <p class="mini">"Cerrar sesión de esta noche" te quita del mapa pero mantiene tus estadísticas.</p>
  </div>
</div>

<div id="toast" class="toast hidden"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="/app.js"></script>
</body>
</html>
