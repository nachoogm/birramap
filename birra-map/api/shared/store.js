const { getTableClient } = require('./tables');
const L = require('./logic');

const T = { members: 'members', checkins: 'checkins', rounds: 'rounds', events: 'events' };
const ready = new Set();

async function tbl(name) {
  const c = getTableClient(name);
  if (!ready.has(name)) {
    try { await c.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
    ready.add(name);
  }
  return c;
}

function principal(req) {
  const h = (req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL'])) || null;
  if (!h) return null;
  try {
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    return p && p.userId ? { userId: p.userId, name: p.userDetails, provider: p.identityProvider } : null;
  } catch { return null; }
}

/* ---------- miembros ---------- */
async function getMember(userId) {
  const t = await tbl(T.members);
  try { return await t.getEntity('m', userId); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function saveMember(userId, data) {
  const t = await tbl(T.members);
  await t.upsertEntity({ partitionKey: 'm', rowKey: userId, ...data }, 'Merge');
  return getMember(userId);
}
async function membersOf(ids) {
  const out = {};
  for (const id of new Set(ids)) { const m = await getMember(id); if (m) out[id] = m; }
  return out;
}

/* ---------- check-ins ---------- */
async function listCheckins(groupId, sinceMs) {
  const t = await tbl(T.checkins);
  const filter = `PartitionKey eq '${groupId.replace(/'/g, "''")}' and RowKey le '${L.invKey(sinceMs)}'`;
  const out = [];
  for await (const e of t.listEntities({ queryOptions: { filter } })) out.push(e);
  return out;
}
async function addCheckin(groupId, e) {
  const t = await tbl(T.checkins);
  await t.createEntity({ partitionKey: groupId, rowKey: L.rowKeyFor(e.tsMs, e.userId), ...e });
}

/* ---------- rondas ---------- */
async function listRounds(groupId, sinceMs) {
  const t = await tbl(T.rounds);
  const filter = `PartitionKey eq '${groupId.replace(/'/g, "''")}' and RowKey le '${L.invKey(sinceMs)}'`;
  const out = [];
  for await (const e of t.listEntities({ queryOptions: { filter } })) out.push(e);
  return out;
}
async function addRound(groupId, e) {
  const t = await tbl(T.rounds);
  await t.createEntity({ partitionKey: groupId, rowKey: L.rowKeyFor(e.tsMs, e.payerId), ...e });
}

/* ---------- eventos ---------- */
async function listEvents(groupId) {
  const t = await tbl(T.events);
  const filter = `PartitionKey eq '${groupId.replace(/'/g, "''")}'`;
  const out = [];
  for await (const e of t.listEntities({ queryOptions: { filter } })) out.push(e);
  return out.sort((a, b) => b.startsMs - a.startsMs);
}
async function addEvent(groupId, e) {
  const t = await tbl(T.events);
  await t.createEntity({ partitionKey: groupId, rowKey: L.rowKeyFor(e.startsMs, e.id), ...e });
}
async function getEvent(groupId, id) {
  return (await listEvents(groupId)).find(e => e.id === id) || null;
}

const ok = (ctx, body, status = 200) => { ctx.res = { status, headers: { 'Content-Type': 'application/json' }, body }; };
const err = (ctx, status, msg) => { ctx.res = { status, headers: { 'Content-Type': 'application/json' }, body: { error: msg } }; };

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
      return err(context, 500, e.message || 'Error interno');
    }
  };
}

module.exports = {
  T, tbl, principal, getMember, saveMember, membersOf,
  listCheckins, addCheckin, listRounds, addRound,
  listEvents, addEvent, getEvent, ok, err, withMember
};
