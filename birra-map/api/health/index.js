const T = require('../shared/tables');
module.exports = async function (context, req) {
  const out = { ok:false, time:new Date().toISOString(), runtime:{ node:process.version }, steps:{} };
  const paso = (n,ok,d) => { out.steps[n] = { ok, detail:d }; return ok; };
  let conn = null;
  try {
    conn = T.readConnection();
    paso('1-conexion', conn.ok, conn.ok ? `OK en "${conn.envName}" · cuenta ${conn.accountName}` : conn.error);
  } catch (e) { paso('1-conexion', false, e.message); }
  if (!conn || !conn.ok) { out.hint = 'Revisa STORAGE_CONNECTION_STRING en la Static Web App.';
    context.res = { status:200, headers:{'Content-Type':'application/json'}, body:out }; return; }
  try { require('@azure/data-tables'); paso('2-libreria', true, 'instalada'); }
  catch { paso('2-libreria', false, 'Falta @azure/data-tables'); out.hint = 'La API se desplegó sin npm install.';
    context.res = { status:200, headers:{'Content-Type':'application/json'}, body:out }; return; }
  const det = {}; let todo = true;
  for (const t of ['members','checkins','rounds','events','ratings']) {
    try { const c = T.getTableClient(t);
      try { await c.createTable(); det[t] = 'creada'; }
      catch (e) { if (e.statusCode === 409) det[t] = 'ya existía'; else throw e; }
    } catch (e) { todo = false; det[t] = `ERROR ${e.statusCode||''} ${e.message}`; }
  }
  paso('3-tablas', todo, det);
  if (!todo) {
    const txt = JSON.stringify(det);
    out.hint = /AuthenticationFailed|Signature/i.test(txt) ? 'Clave no válida: recopia la cadena de Access keys.'
      : /403|Forbidden|AuthorizationFailure/i.test(txt) ? 'Firewall: Storage account → Networking → Enabled from all networks.'
      : /ENOTFOUND/i.test(txt) ? 'AccountName incorrecto.'
      : 'Revisa el paso 3.';
  } else out.ok = true;
  const h = req.headers && req.headers['x-ms-client-principal'];
  if (h) { try { const p = JSON.parse(Buffer.from(h,'base64').toString('utf8'));
    paso('4-identidad', !!p.userId, `${p.userDetails} vía ${p.identityProvider}`); } catch {} }
  context.res = { status:200, headers:{'Content-Type':'application/json'}, body:out };
};
