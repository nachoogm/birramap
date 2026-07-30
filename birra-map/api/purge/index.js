const S = require('../shared/store');
const L = require('../shared/logic');

/* POST /api/purge con cabecera x-purge-key */
module.exports = async function (context, req) {
  try {
    const key = req.headers && req.headers['x-purge-key'];
    if (!process.env.PURGE_KEY || key !== process.env.PURGE_KEY) return S.err(context, 403, 'Nope');

    const days = Math.max(parseInt(process.env.RETENTION_DAYS || '180', 10) || 180, 7);
    const cutoff = Date.now() - days * 86400000;
    const result = {};
    for (const name of [S.T.checkins, S.T.rounds]) {
      const t = await S.tbl(name);
      const victims = [];
      for await (const e of t.listEntities({ queryOptions: { filter: `RowKey ge '${L.invKey(cutoff)}'` } })) victims.push(e);
      for (const e of victims) await t.deleteEntity(e.partitionKey, e.rowKey);
      result[name] = victims.length;
    }
    S.ok(context, { deleted: result, olderThanDays: days });
  } catch (e) { S.err(context, 500, e.message); }
};
