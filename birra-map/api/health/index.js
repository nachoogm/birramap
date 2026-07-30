const T = require('../shared/tables');

/* GET /api/health
   Diagnóstico. Dice exactamente qué falla sin revelar secretos.
   Cada paso se prueba por separado para saber DÓNDE se rompe. */
module.exports = async function (context, req) {
  const out = {
    ok: false,
    time: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform },
    steps: {}
  };
  const step = (name, ok, detail) => { out.steps[name] = { ok, detail }; return ok; };

  /* 1 · ¿está la variable de conexión? */
  let conn = null;
  try {
    conn = T.readConnection();
    step('1-variable-de-conexion', conn.ok, conn.ok
      ? `Encontrada en "${conn.envName}". Cuenta: ${conn.accountName}. Tipo: ${conn.isSas ? 'SAS' : 'clave de cuenta'}.${conn.cleaned.quotes ? ' ⚠️ Tenía comillas, se han quitado.' : ''}${conn.cleaned.whitespace ? ' ⚠️ Tenía espacios/saltos de línea, se han quitado.' : ''}`
      : conn.error);
    out.envPresent = T.ENV_NAMES.filter(n => (process.env[n] || '').trim().length > 0);
  } catch (e) {
    step('1-variable-de-conexion', false, e.message);
  }
  if (!conn || !conn.ok) { out.hint = 'Añade o corrige STORAGE_CONNECTION_STRING en Static Web App → Settings → Environment variables. Después dale a "Refresh" y recarga la web.'; context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: out }; return; }

  /* 2 · ¿está la librería? */
  let ok2 = false;
  try { require('@azure/data-tables'); ok2 = step('2-libreria-data-tables', true, 'Instalada.'); }
  catch (e) { step('2-libreria-data-tables', false, 'No se pudo cargar @azure/data-tables. El despliegue no hizo npm install en /api. Revisa que api_location apunte a la carpeta correcta.'); }
  if (!ok2) { out.hint = 'La API se desplegó sin hacer npm install. Comprueba que api_location del workflow apunte a la carpeta que contiene package.json y host.json.'; context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: out }; return; }

  /* 3 · ¿se puede crear/abrir cada tabla? */
  const tablas = ['members', 'checkins', 'rounds', 'events'];
  const detalle = {};
  let todasOk = true;
  for (const t of tablas) {
    try {
      const c = T.getTableClient(t);
      try { await c.createTable(); detalle[t] = 'creada'; }
      catch (e) {
        if (e.statusCode === 409) detalle[t] = 'ya existía';
        else throw e;
      }
    } catch (e) {
      todasOk = false;
      detalle[t] = `ERROR ${e.statusCode || ''} ${e.code || ''}: ${e.message}`.trim();
    }
  }
  step('3-tablas', todasOk, detalle);

  if (!todasOk) {
    const txt = JSON.stringify(detalle);
    /* El orden importa: un fallo de clave también viene con 403 */
    if (/AuthenticationFailed|Signature|InvalidAuthenticationInfo|AccountIsDisabled/i.test(txt))
      out.hint = 'La clave de la cadena de conexión no es válida, está caducada o se ha rotado. Vuelve a copiarla entera de Storage account → Access keys → Connection string.';
    else if (/AuthorizationFailure|Forbidden|403/i.test(txt))
      out.hint = 'La cuenta de almacenamiento rechaza la conexión: casi siempre es el firewall. Ve a Storage account → Networking y pon "Enabled from all networks" (o marca "Allow Azure services on the trusted services list").';
    else if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(txt))
      out.hint = 'No resuelve el nombre de la cuenta. Comprueba que AccountName de la cadena es el correcto.';
    else if (/FeatureNotSupported|TableNotFound|not supported/i.test(txt))
      out.hint = 'Esa cuenta de almacenamiento no soporta Tables. Tiene que ser StorageV2 (uso general v2), no BlockBlobStorage ni Premium.';
    else
      out.hint = 'Revisa el detalle del paso 3.';
    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: out };
    return;
  }

  /* 4 · escritura y lectura de prueba */
  try {
    const c = T.getTableClient('members');
    const rk = '__health__';
    await c.upsertEntity({ partitionKey: 'diag', rowKey: rk, at: new Date().toISOString() }, 'Replace');
    const back = await c.getEntity('diag', rk);
    await c.deleteEntity('diag', rk);
    step('4-escritura-lectura', !!back, 'Escribe, lee y borra correctamente.');
  } catch (e) {
    step('4-escritura-lectura', false, `${e.statusCode || ''} ${e.message}`.trim());
    out.hint = 'Puede leer la lista de tablas pero no escribir. Si la cadena es un SAS, comprueba que tenga permisos de escritura.';
    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: out };
    return;
  }

  /* 5 · ¿llega la identidad del usuario? */
  const h = req.headers && req.headers['x-ms-client-principal'];
  if (h) {
    try {
      const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
      step('5-identidad', !!p.userId, `Autenticado como "${p.userDetails}" vía ${p.identityProvider}.`);
      out.user = { provider: p.identityProvider, name: p.userDetails, hasId: !!p.userId };
    } catch (e) { step('5-identidad', false, 'La cabecera de identidad no se pudo leer: ' + e.message); }
  } else {
    step('5-identidad', true, 'Sin sesión iniciada (normal si abres /api/health sin login). El resto de comprobaciones sí son válidas.');
  }

  /* 6 · otras variables */
  step('6-otras-variables', true, {
    PURGE_KEY: process.env.PURGE_KEY ? 'definida' : 'sin definir (solo hace falta para la limpieza)',
    RETENTION_DAYS: process.env.RETENTION_DAYS || '180 (por defecto)'
  });

  out.ok = Object.values(out.steps).every(s => s.ok);
  out.hint = out.ok ? '✅ Todo correcto. Si la web sigue sin entrar, vacía la caché del navegador o prueba en incógnito.' : 'Mira qué paso está en false.';
  context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: out };
};
