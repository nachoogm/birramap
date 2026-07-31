const FAKE = process.env.BIRRAMAP_FAKE_STORE === '1';
const ENV_NAMES = ['STORAGE_CONNECTION_STRING','STORE_CONNECTION_STRING','AZURE_STORAGE_CONNECTION_STRING','AzureWebJobsStorage'];
const memory = new Map();
function matches(e, f) {
  if (!f) return true;
  return f.split(/\s+and\s+/i).every(p => {
    const m = p.trim().match(/^(\w+)\s+(eq|ne|le|lt|ge|gt)\s+'(.*)'$/);
    if (!m) return true;
    const [, fd, op, raw] = m;
    const v = String(e[fd[0].toLowerCase() + fd.slice(1)] ?? e[fd] ?? '');
    const t = raw.replace(/''/g, "'");
    return { eq: v === t, ne: v !== t, le: v <= t, lt: v < t, ge: v >= t, gt: v > t }[op];
  });
}
class Fake {
  constructor(n) { this.n = n; if (!memory.has(n)) memory.set(n, new Map()); }
  get _t() { return memory.get(this.n); }
  async createTable() { return true; }
  async createEntity(e) { const k = `${e.partitionKey}|${e.rowKey}`; if (this._t.has(k)) { const x = new Error('exists'); x.statusCode = 409; throw x; } this._t.set(k, { ...e }); }
  async upsertEntity(e, m = 'Merge') { const k = `${e.partitionKey}|${e.rowKey}`; this._t.set(k, m === 'Merge' ? { ...(this._t.get(k) || {}), ...e } : { ...e }); }
  async getEntity(pk, rk) { const v = this._t.get(`${pk}|${rk}`); if (!v) { const x = new Error('404'); x.statusCode = 404; throw x; } return { ...v }; }
  async deleteEntity(pk, rk) { this._t.delete(`${pk}|${rk}`); }
  listEntities(o = {}) {
    const f = o.queryOptions && o.queryOptions.filter;
    const r = [...this._t.values()].filter(e => matches(e, f)).sort((a, b) => (a.partitionKey + a.rowKey).localeCompare(b.partitionKey + b.rowKey));
    return (async function* () { for (const x of r) yield { ...x }; })();
  }
}
const cache = {};
function getTableClient(name) {
  if (cache[name]) return cache[name];
  if (FAKE) return (cache[name] = new Fake(name));
  const conn = ENV_NAMES.map(n => process.env[n]).find(v => v && v.trim());
  if (!conn) { const e = new Error('Falta STORAGE_CONNECTION_STRING'); e.birramapConfig = true; throw e; }
  const { TableClient } = require('@azure/data-tables');
  return (cache[name] = TableClient.fromConnectionString(conn.trim(), name));
}
module.exports = { getTableClient, ENV_NAMES, FAKE, __resetMemory: () => { memory.clear(); Object.keys(cache).forEach(k => delete cache[k]); } };
