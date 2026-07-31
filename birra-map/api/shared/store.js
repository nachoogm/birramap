const { getTableClient } = require('./tables');
const L = require('./logic');
const C = require('./cache');

const T = { members:'members', checkins:'checkins', rounds:'rounds', events:'events', ratings:'ratings' };
const listo = new Set();

async function tbl(name) {
  const c = getTableClient(name);
  if (!listo.has(name)) {
    try { await c.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
    listo.add(name);
  }
  return c;
}

function principal(req) {
  const h = (req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL'])) || null;
  if (!h) return null;
  try {
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    return p && p.userId ? { userId:p.userId, name:p.userDetails, provider:p.identityProvider } : null;
  } catch { return null; }
}

async function getMember(id) {
  return C.conCache(`_m:${id}`, 30, async () => {
    const t = await tbl(T.members);
    try { return await t.getEntity('m', id); }
    catch (e) { if (e.statusCode === 404) return null; throw e; }
  });
}
async function saveMember(id, data) {
  const t = await tbl(T.members);
  await t.upsertEntity({ partitionKey:'m', rowKey:id, ...data }, 'Merge');
  C.invalidar('_m', `:${id}`);
  C.set(`_m:${id}`, null, 0);
  const fresco = await (async () => {
    try { return await t.getEntity('m', id); } catch (e) { if (e.statusCode === 404) return null; throw e; }
  })();
  C.set(`_m:${id}`, fresco, 30);
  return fresco;
}
/* En paralelo: antes era un bucle secuencial y con 8 personas
   eran 8 viajes de ida y vuelta encadenados. */
async function membersOf(ids) {
  const unicos = [...new Set(ids)];
  const res = await Promise.all(unicos.map(id => getMember(id).catch(() => null)));
  const o = {};
  unicos.forEach((id, i) => { if (res[i]) o[id] = res[i]; });
  return o;
}

const filtroGrupo = (g, desde) => `PartitionKey eq '${String(g).replace(/'/g,"''")}' and RowKey le '${L.invKey(desde)}'`;

async function listar(tabla, groupId, desde) {
  const t = await tbl(tabla);
  const out = [];
  for await (const e of t.listEntities({ queryOptions: { filter: filtroGrupo(groupId, desde) } })) out.push(e);
  return out;
}
/* Listados con caché. La clave lleva el rango redondeado a minutos
   para que dos peticiones seguidas compartan resultado. */
const claveRango = (tipo, g, desde) => `${g}:${tipo}:${Math.floor(desde / 60000)}`;

const listCheckins = (g, d, ttl = 20) =>
  C.conCache(claveRango('checkins', g, d), ttl, () => listar(T.checkins, g, d));
const listRounds = (g, d, ttl = 45) =>
  C.conCache(claveRango('rounds', g, d), ttl, () => listar(T.rounds, g, d));
const listRatings = (g, d, ttl = 60) =>
  C.conCache(claveRango('ratings', g, d), ttl, () => listar(T.ratings, g, d));

/* Sin caché, para cuando hace falta el dato recién escrito */
const listCheckinsFresco = (g, d) => listar(T.checkins, g, d);
const listRatingsFresco = (g, d) => listar(T.ratings, g, d);

/* Al escribir se tira el caché de ese grupo: nada de datos rancios */
async function addCheckin(g, e) {
  await (await tbl(T.checkins)).createEntity({ partitionKey:g, rowKey:L.rowKeyFor(e.tsMs, e.userId), ...e });
  C.invalidar(g, 'checkins', 'agg');
}
async function addRound(g, e) {
  await (await tbl(T.rounds)).createEntity({ partitionKey:g, rowKey:L.rowKeyFor(e.tsMs, e.payerId), ...e });
  C.invalidar(g, 'rounds', 'checkins', 'agg');
}
async function addRating(g, e) {
  await (await tbl(T.ratings)).createEntity({ partitionKey:g, rowKey:L.rowKeyFor(e.tsMs, e.userId), ...e });
  C.invalidar(g, 'ratings', 'agg');
}

async function listEvents(g) {
  const t = await tbl(T.events);
  const out = [];
  for await (const e of t.listEntities({ queryOptions:{ filter:`PartitionKey eq '${String(g).replace(/'/g,"''")}'` } })) out.push(e);
  return out.sort((a,b) => b.startsMs - a.startsMs);
}
async function addEvent(g, e) { (await tbl(T.events)).createEntity({ partitionKey:g, rowKey:L.rowKeyFor(e.startsMs, e.id), ...e }); }
async function getEvent(g, id) { return (await listEvents(g)).find(e => e.id === id) || null; }

const ok = (ctx, body, status = 200) => { ctx.res = { status, headers:{'Content-Type':'application/json'}, body }; };
const err = (ctx, status, msg, extra = null) => { ctx.res = { status, headers:{'Content-Type':'application/json'}, body:{ error:msg, ...(extra||{}) } }; };

function withMember(handler) {
  return async function (context, req) {
    try {
      const p = principal(req);
      if (!p) return err(context, 401, 'No autenticado');
      const m = await getMember(p.userId);
      if (!m || !m.groupId) return err(context, 409, 'Sin grupo');
      return await handler(context, req, p, m);
    } catch (e) {
      (context.log && context.log.error ? context.log.error : console.error)(e);
      if (e.birramapConfig) return err(context, 503, e.message, { diagnostico:'/ayuda.html' });
      return err(context, 500, `Error al acceder al almacenamiento: ${e.message}`, { code:e.code||null, statusCode:e.statusCode||null });
    }
  };
}

module.exports = { T, tbl, principal, getMember, saveMember, membersOf,
  listCheckins, listRounds, listRatings, listCheckinsFresco, listRatingsFresco,
  addCheckin, addRound, addRating,
  listEvents, addEvent, getEvent, ok, err, withMember, cache: C };
