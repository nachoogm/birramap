/* Cliente de Table Storage. Acepta varios nombres de variable y
   explica en cristiano si algo falta. En tests usa memoria. */
const FAKE = process.env.BIRRAMAP_FAKE_STORE === '1';
const ENV_NAMES = ['STORAGE_CONNECTION_STRING','STORE_CONNECTION_STRING','AZURE_STORAGE_CONNECTION_STRING','AzureWebJobsStorage'];

function readConnection() {
  const found = ENV_NAMES.find(n => (process.env[n]||'').trim().length > 0);
  if (!found) return { ok:false, error:`No hay variable de conexión. Añade STORAGE_CONNECTION_STRING en la Static Web App. Buscadas: ${ENV_NAMES.join(', ')}.` };
  let raw = String(process.env[found]);
  const limpio = { comillas:false, espacios:false };
  if (/^\s|\s$/.test(raw)) { limpio.espacios = true; raw = raw.trim(); }
  if (/^["'].*["']$/s.test(raw)) { limpio.comillas = true; raw = raw.slice(1,-1).trim(); }
  if (raw === 'UseDevelopmentStorage=true') return { ok:false, envName:found, error:'La cadena es la del emulador local. En Azure hace falta la real.' };
  if (raw.startsWith('http')) return { ok:false, envName:found, error:'Has puesto una URL. Copia la cadena de Access keys → Connection string.' };
  const p = {};
  for (const t of raw.split(';')) { const i = t.indexOf('='); if (i>0) p[t.slice(0,i).trim()] = t.slice(i+1).trim(); }
  if (!p.AccountName || (!p.AccountKey && !p.SharedAccessSignature))
    return { ok:false, envName:found, error:'La cadena está incompleta: faltan AccountName o AccountKey.' };
  return { ok:true, envName:found, value:raw, accountName:p.AccountName, limpio };
}

const memory = new Map();
/* Latencia simulada, solo para los benchmarks: en Azure cada consulta
   a Table Storage son decenas de milisegundos de ida y vuelta. */
const LAT = parseInt(process.env.BIRRAMAP_FAKE_LATENCY_MS || '0', 10);
const latencia = () => LAT ? new Promise(r => setTimeout(r, LAT)) : null;
function matches(e, f) {
  if (!f) return true;
  return f.split(/\s+and\s+/i).every(part => {
    const m = part.trim().match(/^(\w+)\s+(eq|ne|le|lt|ge|gt)\s+'(.*)'$/);
    if (!m) return true;
    const [, fd, op, raw] = m;
    const v = String(e[fd[0].toLowerCase()+fd.slice(1)] ?? e[fd] ?? '');
    const t = raw.replace(/''/g, "'");
    return { eq:v===t, ne:v!==t, le:v<=t, lt:v<t, ge:v>=t, gt:v>t }[op];
  });
}
class Fake {
  constructor(n){ this.n=n; if(!memory.has(n)) memory.set(n,new Map()); }
  get _t(){ return memory.get(this.n); }
  async createTable(){ return true; }
  async createEntity(e){ const k=`${e.partitionKey}|${e.rowKey}`; if(this._t.has(k)){const x=new Error('exists');x.statusCode=409;throw x;} this._t.set(k,{...e}); }
  async upsertEntity(e,m='Merge'){ const k=`${e.partitionKey}|${e.rowKey}`; this._t.set(k, m==='Merge'?{...(this._t.get(k)||{}),...e}:{...e}); }
  async getEntity(pk,rk){ await latencia(); const v=this._t.get(`${pk}|${rk}`); if(!v){const x=new Error('404');x.statusCode=404;throw x;} return {...v}; }
  async deleteEntity(pk,rk){ this._t.delete(`${pk}|${rk}`); }
  listEntities(o={}){
    const espera = latencia();
    const f=o.queryOptions&&o.queryOptions.filter;
    const r=[...this._t.values()].filter(e=>matches(e,f)).sort((a,b)=>(a.partitionKey+a.rowKey).localeCompare(b.partitionKey+b.rowKey));
    return (async function*(){ if (espera) await espera; for(const x of r) yield {...x}; })();
  }
}
const cache = {};
function getTableClient(name) {
  if (cache[name]) return cache[name];
  if (FAKE) return (cache[name] = new Fake(name));
  const c = readConnection();
  if (!c.ok) { const e = new Error(c.error); e.birramapConfig = true; throw e; }
  let TableClient;
  try { ({ TableClient } = require('@azure/data-tables')); }
  catch { const e = new Error('Falta @azure/data-tables en la API. Revisa api_location en el workflow.'); e.birramapConfig = true; throw e; }
  try { cache[name] = TableClient.fromConnectionString(c.value, name); }
  catch (err) { const e = new Error(`Cadena de conexión no válida: ${err.message}`); e.birramapConfig = true; throw e; }
  return cache[name];
}
module.exports = { getTableClient, readConnection, ENV_NAMES, FAKE,
  __resetMemory: () => { memory.clear(); Object.keys(cache).forEach(k=>delete cache[k]); } };
