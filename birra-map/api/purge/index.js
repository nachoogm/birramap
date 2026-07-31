const S = require('../shared/store');
const L = require('../shared/logic');
module.exports = async function (context, req) {
  try {
    const key = req.headers && req.headers['x-purge-key'];
    if (!process.env.PURGE_KEY || key !== process.env.PURGE_KEY) return S.err(context, 403, 'Nope');
    const days = Math.max(parseInt(process.env.RETENTION_DAYS||'180',10)||180, 7);
    const cutoff = Date.now() - days*86400000;
    const res = {};
    for (const name of [S.T.checkins, S.T.rounds, S.T.ratings]) {
      const t = await S.tbl(name);
      const victimas = [];
      for await (const e of t.listEntities({ queryOptions:{ filter:`RowKey ge '${L.invKey(cutoff)}'` } })) victimas.push(e);
      for (const e of victimas) await t.deleteEntity(e.partitionKey, e.rowKey);
      res[name] = victimas.length;
    }
    S.ok(context, { deleted:res, olderThanDays:days });
  } catch (e) { S.err(context, 500, e.message); }
};
