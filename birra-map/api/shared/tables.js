/* Fábrica de clientes de tabla.
   En Azure usa @azure/data-tables. En tests usa un store en memoria
   (BIRRAMAP_FAKE_STORE=1) para probar la API entera sin nube. */

const FAKE = process.env.BIRRAMAP_FAKE_STORE === '1';
const memory = new Map();

/* Mini evaluador del subconjunto de OData que usamos */
function matches(entity, filter) {
  if (!filter) return true;
  return filter.split(/\s+and\s+/i).every(part => {
    const m = part.trim().match(/^(\w+)\s+(eq|ne|le|lt|ge|gt)\s+'(.*)'$/);
    if (!m) return true;
    const [, field, op, raw] = m;
    const val = String(entity[field[0].toLowerCase() + field.slice(1)] ?? entity[field] ?? '');
    const t = raw.replace(/''/g, "'");
    return { eq: val === t, ne: val !== t, le: val <= t, lt: val < t, ge: val >= t, gt: val > t }[op];
  });
}

class FakeTableClient {
  constructor(name) { this.name = name; if (!memory.has(name)) memory.set(name, new Map()); }
  get _t() { return memory.get(this.name); }
  async createTable() { return true; }
  async createEntity(e) {
    const k = `${e.partitionKey}|${e.rowKey}`;
    if (this._t.has(k)) { const err = new Error('exists'); err.statusCode = 409; throw err; }
    this._t.set(k, { ...e });
  }
  async upsertEntity(e, mode = 'Merge') {
    const k = `${e.partitionKey}|${e.rowKey}`;
    this._t.set(k, mode === 'Merge' ? { ...(this._t.get(k) || {}), ...e } : { ...e });
  }
  async getEntity(pk, rk) {
    const v = this._t.get(`${pk}|${rk}`);
    if (!v) { const err = new Error('not found'); err.statusCode = 404; throw err; }
    return { ...v };
  }
  async deleteEntity(pk, rk) { this._t.delete(`${pk}|${rk}`); }
  listEntities(opts = {}) {
    const filter = opts.queryOptions && opts.queryOptions.filter;
    const rows = [...this._t.values()].filter(e => matches(e, filter))
      .sort((a, b) => (a.partitionKey + a.rowKey).localeCompare(b.partitionKey + b.rowKey));
    return (async function* () { for (const r of rows) yield { ...r }; })();
  }
}

const cache = {};
function getTableClient(name) {
  if (cache[name]) return cache[name];
  if (FAKE) { cache[name] = new FakeTableClient(name); return cache[name]; }
  const { TableClient } = require('@azure/data-tables');
  const conn = process.env.STORAGE_CONNECTION_STRING || process.env.STORE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!conn) throw new Error('Falta STORAGE_CONNECTION_STRING en la configuración de la Static Web App');
  cache[name] = TableClient.fromConnectionString(conn, name);
  return cache[name];
}

const __resetMemory = () => { memory.clear(); Object.keys(cache).forEach(k => delete cache[k]); };

module.exports = { getTableClient, __resetMemory, FAKE };
