/* Prueba el diagnóstico contra los fallos típicos de configuración.
   Ejecutar: node tests/test-diagnostico.js */
const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
const out = [];
const check = (n, c, extra = '') => { c ? (passed++, out.push(`  ✅ ${n}`)) : (failed++, out.push(`  ❌ ${n} ${extra}`)); };
const group = t => out.push(`\n▶ ${t}`);

const ENVS = ['STORAGE_CONNECTION_STRING', 'STORE_CONNECTION_STRING', 'AZURE_STORAGE_CONNECTION_STRING', 'AzureWebJobsStorage', 'BIRRAMAP_FAKE_STORE'];
function limpiar() { ENVS.forEach(e => delete process.env[e]); }
function fresh() {
  for (const k of Object.keys(require.cache)) if (k.includes('/fix/api/')) delete require.cache[k];
  return require(path.join(__dirname, '../api/shared/tables.js'));
}

/* Llama a /api/health con la librería de Azure simulada */
async function health({ env = {}, tableError = null, principal = null } = {}) {
  limpiar();
  Object.assign(process.env, env);

  /* Intercepta require('@azure/data-tables') */
  const orig = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === '@azure/data-tables') {
      if (tableError === 'no-instalada') { const e = new Error("Cannot find module '@azure/data-tables'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
      return {
        TableClient: {
          fromConnectionString: () => ({
            createTable: async () => { if (tableError) throw tableError; },
            upsertEntity: async () => {}, getEntity: async () => ({ ok: 1 }), deleteEntity: async () => {}
          })
        }
      };
    }
    return orig.apply(this, arguments);
  };

  try {
    for (const k of Object.keys(require.cache)) if (k.includes('/fix/api/')) delete require.cache[k];
    const fn = require(path.join(__dirname, '../api/health/index.js'));
    const ctx = {};
    const headers = principal
      ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
      : {};
    await fn(ctx, { method: 'GET', headers, query: {} });
    return ctx.res.body;
  } finally { Module._load = orig; }
}

const err = (msg, extra = {}) => Object.assign(new Error(msg), extra);

/* store.js necesita un logic.js al lado. Se crea temporal y se borra al acabar,
   para que el parche NO incluya un logic.js que pisaría el tuyo. */
const fsx = require('fs');
const LOGIC = path.join(__dirname, '../api/shared/logic.js');
const habiaLogic = fsx.existsSync(LOGIC);
if (!habiaLogic) fsx.copyFileSync(path.join(__dirname, '_stub-logic.js'), LOGIC);
const limpiarStub = () => { if (!habiaLogic && fsx.existsSync(LOGIC)) fsx.unlinkSync(LOGIC); };
process.on('exit', limpiarStub);

(async () => {
  console.log('🔧 Diagnóstico de BirraMap — pruebas\n' + '='.repeat(56));

  /* ---------- lectura de la cadena de conexión ---------- */
  group('Lectura de la variable de conexión');
  const CS = 'DefaultEndpointsProtocol=https;AccountName=stbirramap01;AccountKey=abc123==;EndpointSuffix=core.windows.net';

  limpiar(); process.env.STORAGE_CONNECTION_STRING = CS;
  let r = fresh().readConnection();
  check('acepta STORAGE_CONNECTION_STRING', r.ok && r.envName === 'STORAGE_CONNECTION_STRING');
  check('extrae el nombre de la cuenta', r.accountName === 'stbirramap01', r.accountName);
  check('nunca devuelve la clave en el diagnóstico', !JSON.stringify({ ...r, value: undefined }).includes('abc123'));

  limpiar(); process.env.STORE_CONNECTION_STRING = CS;
  check('acepta también STORE_CONNECTION_STRING (el nombre de tu portal)', fresh().readConnection().ok);

  limpiar(); process.env.STORAGE_CONNECTION_STRING = `  "${CS}"  `;
  r = fresh().readConnection();
  check('limpia comillas y espacios al pegar en el portal', r.ok && r.cleaned.quotes && r.cleaned.whitespace);
  check('la cadena limpia es utilizable', r.value === CS);

  limpiar();
  r = fresh().readConnection();
  check('sin variable → error claro', !r.ok && /No hay ninguna variable/.test(r.error), r.error);

  limpiar(); process.env.STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  r = fresh().readConnection();
  check('detecta el emulador local puesto en Azure', !r.ok && /emulador/.test(r.error), r.error);

  limpiar(); process.env.STORAGE_CONNECTION_STRING = 'https://stbirramap01.table.core.windows.net';
  r = fresh().readConnection();
  check('detecta que has pegado una URL', !r.ok && /URL/.test(r.error), r.error);

  limpiar(); process.env.STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=x';
  r = fresh().readConnection();
  check('detecta cadena incompleta (sin AccountKey)', !r.ok && /AccountKey/.test(r.error), r.error);

  /* ---------- endpoint /api/health ---------- */
  group('Endpoint /api/health');

  let h = await health({ env: {} });
  check('sin configuración → paso 1 en rojo', h.steps['1-variable-de-conexion'].ok === false);
  check('y da la instrucción de dónde arreglarlo', /Environment variables/.test(h.hint), h.hint);
  check('no revienta, responde 200 con el informe', h.ok === false && !!h.time);

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS }, tableError: 'no-instalada' });
  check('librería ausente → paso 2 en rojo', h.steps['2-libreria-data-tables'].ok === false);
  check('y avisa del npm install', /npm install/.test(h.hint), h.hint);

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS }, tableError: err('Forbidden', { statusCode: 403, code: 'AuthorizationFailure' }) });
  check('403 → paso 3 en rojo', h.steps['3-tablas'].ok === false);
  check('403 → sugiere el firewall de la cuenta', /firewall|Networking/i.test(h.hint), h.hint);

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS }, tableError: err('AuthenticationFailed', { statusCode: 403, code: 'AuthenticationFailed' }) });
  check('clave inválida → sugiere recopiar la cadena', /Access keys/i.test(h.hint), h.hint);

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS }, tableError: err('getaddrinfo ENOTFOUND stmal.table.core.windows.net', { code: 'ENOTFOUND' }) });
  check('cuenta inexistente → sugiere revisar AccountName', /AccountName/i.test(h.hint), h.hint);

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS }, tableError: err('FeatureNotSupported', { statusCode: 400 }) });
  check('cuenta sin Tables → sugiere StorageV2', /StorageV2/i.test(h.hint), h.hint);

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS, PURGE_KEY: 'x', RETENTION_DAYS: '180' } });
  check('todo bien → ok true', h.ok === true, JSON.stringify(h.steps));
  check('prueba las 4 tablas', Object.keys(h.steps['3-tablas'].detail).length === 4);
  check('prueba escritura y lectura reales', h.steps['4-escritura-lectura'].ok === true);
  check('informa de las variables opcionales', h.steps['6-otras-variables'].ok === true);
  check('nunca filtra la clave de la cuenta', !JSON.stringify(h).includes('abc123'), 'FUGA DE SECRETO');
  check('sí muestra el nombre de la cuenta (no es secreto)', JSON.stringify(h).includes('stbirramap01'));

  h = await health({
    env: { STORAGE_CONNECTION_STRING: CS },
    principal: { userId: 'u1', userDetails: 'nachoogm', identityProvider: 'github' }
  });
  check('detecta la sesión iniciada', h.steps['5-identidad'].ok === true && /nachoogm/.test(h.steps['5-identidad'].detail));
  check('identifica el proveedor', h.user.provider === 'github');

  h = await health({ env: { STORAGE_CONNECTION_STRING: CS } });
  check('sin sesión no lo marca como error', h.steps['5-identidad'].ok === true && /Sin sesión/.test(h.steps['5-identidad'].detail));

  /* ---------- /api/me devuelve errores legibles ---------- */
  group('/api/me con errores legibles');
  limpiar();
  process.env.BIRRAMAP_FAKE_STORE = '1';
  for (const k of Object.keys(require.cache)) if (k.includes('/fix/api/')) delete require.cache[k];
  const me = require(path.join(__dirname, '../api/me/index.js'));
  let ctx = {};
  await me(ctx, { method: 'GET', headers: {}, query: {} });
  check('sin login → 401 (no 500)', ctx.res.status === 401);

  ctx = {};
  const hdr = Buffer.from(JSON.stringify({ userId: 'u1', userDetails: 'nacho', identityProvider: 'github' })).toString('base64');
  await me(ctx, { method: 'GET', headers: { 'x-ms-client-principal': hdr }, query: {} });
  check('con login y almacenamiento OK → 200', ctx.res.status === 200 && ctx.res.body.userId === 'u1');

  /* sin configuración: debe dar 503 explicativo, no un 500 pelado */
  limpiar();
  for (const k of Object.keys(require.cache)) if (k.includes('/fix/api/')) delete require.cache[k];
  const me2 = require(path.join(__dirname, '../api/me/index.js'));
  ctx = {};
  await me2(ctx, { method: 'GET', headers: { 'x-ms-client-principal': hdr }, query: {} });
  check('sin configuración → 503, no 500', ctx.res.status === 503, String(ctx.res.status));
  check('el mensaje explica qué falta', /STORAGE_CONNECTION_STRING/.test(ctx.res.body.error), ctx.res.body.error);
  check('y apunta a la página de diagnóstico', ctx.res.body.diagnostico === '/diag.html');

  /* ---------- ficheros del parche ---------- */
  group('Ficheros del parche');
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const ex = p => fs.existsSync(path.join(root, p));
  check('api/health/function.json', ex('api/health/function.json'));
  check('el parche NO trae logic.js (pisaría el tuyo con un stub)', !habiaLogic, 'BORRA api/shared/logic.js del paquete');
  check('la ruta de health es anónima', JSON.parse(fs.readFileSync(path.join(root, 'api/health/function.json'), 'utf8')).bindings[0].authLevel === 'anonymous');
  check('public/diag.html', ex('public/diag.html'));
  const diag = fs.readFileSync(path.join(root, 'public/diag.html'), 'utf8');
  check('diag.html consulta health, me y auth', diag.includes('/api/health') && diag.includes('/api/me') && diag.includes('/.auth/me'));
  check('diag.html detecta el caso "API no desplegada"', diag.includes('404'));

  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'staticwebapp.config.json'), 'utf8'));
  check('/api/health es accesible sin login', cfg.routes.some(r => r.route === '/api/health' && r.allowedRoles.includes('anonymous')));
  check('/diag.html es accesible sin login', cfg.routes.some(r => r.route === '/diag.html' && r.allowedRoles.includes('anonymous')));
  check('el resto de la API sigue protegida', cfg.routes.some(r => r.route === '/api/*' && r.allowedRoles.includes('authenticated')));
  const iHealth = cfg.routes.findIndex(r => r.route === '/api/health');
  const iApi = cfg.routes.findIndex(r => r.route === '/api/*');
  check('la regla de health va ANTES que la genérica (si no, no se aplica)', iHealth < iApi, `${iHealth} vs ${iApi}`);

  console.log(out.join('\n'));
  console.log('\n' + '='.repeat(56));
  console.log(`Resultado: ${passed} OK · ${failed} fallos`);
  process.exit(failed ? 1 : 0);
})();
