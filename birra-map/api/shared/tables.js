/* Fábrica de clientes de tabla, endurecida.
   - Acepta varios nombres de variable de entorno.
   - Valida la cadena de conexión y explica en cristiano qué le pasa.
   - En tests usa un Table Storage en memoria (BIRRAMAP_FAKE_STORE=1). */

const FAKE = process.env.BIRRAMAP_FAKE_STORE === '1';

/* Nombres aceptados, por orden de preferencia */
const ENV_NAMES = [
  'STORAGE_CONNECTION_STRING',
  'STORE_CONNECTION_STRING',
  'AZURE_STORAGE_CONNECTION_STRING',
  'AzureWebJobsStorage'
];

/* ---------- diagnóstico de la cadena de conexión ---------- */
function readConnection() {
  const found = ENV_NAMES.find(n => (process.env[n] || '').trim().length > 0);
  if (!found) {
    return {
      ok: false,
      envName: null,
      error: `No hay ninguna variable de conexión. Añade STORAGE_CONNECTION_STRING en la Static Web App (Settings → Environment variables). Buscadas: ${ENV_NAMES.join(', ')}.`
    };
  }

  /* Limpieza defensiva: comillas y saltos de línea al pegar en el portal */
  let raw = String(process.env[found]);
  const dirty = { quotes: false, whitespace: false };
  if (/^\s|\s$/.test(raw)) { dirty.whitespace = true; raw = raw.trim(); }
  if (/^["'].*["']$/s.test(raw)) { dirty.quotes = true; raw = raw.slice(1, -1).trim(); }

  if (raw === 'UseDevelopmentStorage=true') {
    return { ok: false, envName: found, error: 'La cadena es "UseDevelopmentStorage=true" (el emulador local). En Azure hay que poner la cadena real de la cuenta de almacenamiento.' };
  }
  if (raw.startsWith('http')) {
    return { ok: false, envName: found, error: 'Has puesto una URL, no una cadena de conexión. Copia la de Storage account → Access keys → Connection string (empieza por DefaultEndpointsProtocol=).' };
  }

  const parts = {};
  for (const p of raw.split(';')) {
    const i = p.indexOf('=');
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }

  const missing = ['AccountName', 'AccountKey'].filter(k => !parts[k]);
  if (missing.length && !parts.SharedAccessSignature) {
    return {
      ok: false, envName: found,
      error: `La cadena de conexión no tiene ${missing.join(' ni ')}. Cógela entera de Storage account → Access keys → Connection string.`
    };
  }

  return {
    ok: true,
    envName: found,
    value: raw,
    accountName: parts.AccountName || null,      // el nombre de la cuenta no es secreto
    hasKey: !!parts.AccountKey,
    isSas: !!parts.SharedAccessSignature,
    cleaned: dirty
  };
}

/* ---------- implementación en memoria (solo tests) ---------- */
const memory = new Map();

function matches(entity, filter) {
  if (!filter) return true;
  return filter.split(/\s+and\s+/i).every(part => {
    const m = part.trim().match(/^(\w+)\s+(eq|ne|le|lt|ge|gt)\s+'(.*)'$/);
    if (!m) return true;
    const [, field, op, raw] = m;
    const val = String(entity[field[0].toLowerCase() + field.slice(1)] ?? entity[field] ?? '');
    const target = raw.replace(/''/g, "'");
    switch (op) {
      case 'eq': return val === target;
      case 'ne': return val !== target;
      case 'le': return val <= target;
      case 'lt': return val < target;
      case 'ge': return val >= target;
      case 'gt': return val > target;
      default: return true;
    }
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
    const rows = [...this._t.values()]
      .filter(e => matches(e, filter))
      .sort((a, b) => (a.partitionKey + a.rowKey).localeCompare(b.partitionKey + b.rowKey));
    return (async function* () { for (const r of rows) yield { ...r }; })();
  }
}

/* ---------- selector ---------- */
const cache = {};
function getTableClient(name) {
  if (cache[name]) return cache[name];
  if (FAKE) { cache[name] = new FakeTableClient(name); return cache[name]; }

  const conn = readConnection();
  if (!conn.ok) { const e = new Error(conn.error); e.birramapConfig = true; throw e; }

  let TableClient;
  try { ({ TableClient } = require('@azure/data-tables')); }
  catch {
    const e = new Error('No está instalado @azure/data-tables en la API. Revisa que api/package.json lo tenga en dependencies y que el despliegue haya hecho npm install.');
    e.birramapConfig = true;
    throw e;
  }

  try { cache[name] = TableClient.fromConnectionString(conn.value, name); }
  catch (err) {
    const e = new Error(`La cadena de conexión no es válida: ${err.message}`);
    e.birramapConfig = true;
    throw e;
  }
  return cache[name];
}

const __resetMemory = () => { memory.clear(); Object.keys(cache).forEach(k => delete cache[k]); };

module.exports = { getTableClient, readConnection, ENV_NAMES, __resetMemory, FAKE };
